# LZ Репитери – офлайн

An Android app that shows the Bulgarian amateur radio repeaters on a map and in a list, **without internet**.

- The whole Bulgaria map (OpenStreetMap data via Protomaps) is built into the app.
- Repeater data comes from [api.varna.radio](https://api.varna.radio/v1/), the same source as [lz-map.org](https://lz-map.org/). It is bundled at build time and refreshed automatically whenever the phone is online.
- Features: search, filter by mode (Analog / DMR / D-Star / Fusion / NXDN / Parrot), nearest repeaters by GPS with distance and direction, frequencies / shift / CTCSS / DMR talkgroups, coverage overlays.

## Getting the APK

GitHub Actions builds it automatically on every push to `main` and every Monday (fresh data).
Download `lz-repeaters.apk` from the **Releases → latest** page on your phone and open it.
Android will ask you to allow installing apps from your browser – allow it once.

To rebuild by hand: **Actions → Build Android APK → Run workflow**. The `maxzoom` input sets how detailed the offline map is (13 by default; 14 is more detailed but makes the APK much bigger).

## Run locally

```bash
npm install
npm run vendor
npm run offline-data   # needs curl, jq, gh
npm run serve          # http://localhost:8080
```

## Credits

Map data © OpenStreetMap contributors, tiles by Protomaps. Repeater data: varna.radio, repeaters.bg, repeaters.lz1ny.net, lz-map.org.
