// Unpacks a local .pmtiles file into www/tiles/{z}/{x}/{y}.mvt (uncompressed vector tiles).
// Usage: node scripts/extract-tiles.mjs bulgaria.pmtiles www/tiles
// Plain files are used because the Android WebView asset server can't serve byte ranges reliably.
import { openSync, readSync, mkdirSync, writeFileSync, fstatSync } from 'node:fs';
import { PMTiles } from 'pmtiles';

const [, , input, outDir = 'www/tiles'] = process.argv;
if (!input) { console.error('usage: extract-tiles.mjs <file.pmtiles> [outDir]'); process.exit(1); }

class FileSource {
  constructor(path) { this.path = path; this.fd = openSync(path, 'r'); this.size = fstatSync(this.fd).size; }
  getKey() { return this.path; }
  async getBytes(offset, length) {
    const len = Math.min(length, this.size - offset);
    const buf = Buffer.alloc(len);
    readSync(this.fd, buf, 0, len, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + len) };
  }
}

const p = new PMTiles(new FileSource(input));
const h = await p.getHeader();
console.log(`bounds ${h.minLon},${h.minLat} → ${h.maxLon},${h.maxLat}, zoom ${h.minZoom}-${h.maxZoom}`);

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

let count = 0, bytes = 0;
for (let z = h.minZoom; z <= h.maxZoom; z++) {
  const x0 = lon2x(h.minLon, z), x1 = lon2x(h.maxLon, z);
  const y0 = lat2y(h.maxLat, z), y1 = lat2y(h.minLat, z);
  for (let x = x0; x <= x1; x++) {
    let dirMade = false;
    for (let y = y0; y <= y1; y++) {
      const t = await p.getZxy(z, x, y);
      if (!t || !t.data || t.data.byteLength === 0) continue;
      if (!dirMade) { mkdirSync(`${outDir}/${z}/${x}`, { recursive: true }); dirMade = true; }
      writeFileSync(`${outDir}/${z}/${x}/${y}.mvt`, Buffer.from(t.data));
      count++; bytes += t.data.byteLength;
    }
  }
  console.log(`z${z}: total ${count} tiles, ${(bytes / 1048576).toFixed(1)} MB`);
}
writeFileSync('www/data/meta.json', JSON.stringify({ maxzoom: h.maxZoom, built: new Date().toISOString(), tiles: count }));
console.log('done');
