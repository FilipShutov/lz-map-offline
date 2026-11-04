// Copies the browser libraries from node_modules into www/vendor so the app needs no CDN.
import { cpSync, mkdirSync } from 'node:fs';

const out = 'www/vendor';
mkdirSync(out, { recursive: true });
cpSync('node_modules/leaflet/dist/leaflet.js', `${out}/leaflet.js`);
cpSync('node_modules/leaflet/dist/leaflet.css', `${out}/leaflet.css`);
cpSync('node_modules/leaflet/dist/images', `${out}/images`, { recursive: true });
cpSync('node_modules/protomaps-leaflet/dist/protomaps-leaflet.js', `${out}/protomaps-leaflet.js`);
console.log('vendor libs copied to', out);
