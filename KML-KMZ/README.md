# Persistent KML/KMZ Library

This directory supplies the Electron desktop app's development-time KML/KMZ library and packaged seed content.

- In the Electron app, open **Map** to upload, browse, and manage stored KML/KMZ files. The Map tab is available even before importing a normal dataset.
- **Import as data** reads a stored KML/KMZ as a normal immutable trajectory dataset for table, chart, 3D, comparison, and export workflows.
- **Add overlay** renders KML/KMZ geometry as a separate, non-dataset Map layer. Its visibility and opacity are persisted with the workspace; missing library files remain as disabled, auditable references until removed.
- `Special_Use_Airspace.kml` is packaged as an immutable application resource. On first run, it is copied into the user-writable library only when absent; existing user copies are never overwritten.
- Where each build gets these files:
  - **Dev (`npm run dev`, `npm run dev:desktop`)** — read straight out of this directory.
  - **Web build** — copied to `dist/kml-library/` and served over HTTP by the
    `jddc-bundled-kml-library` plugin in `vite.config.ts`, which also serves them from the dev
    server. Only `.kml` is published: the browser has no unzipper for `.kmz`.
  - **Linux packages** — copied to `resources/kml-seed` via `build.linux.extraResources`, then
    seeded into the user-writable library by `electron/kml-seed.cjs`.
  - **Windows packages** — not bundled, to keep the installer small; `REMOTE_KML_OVERLAYS` in
    `electron/main.cjs` fetches them on demand instead.
  The `!dist/kml-library/**` entry in `build.files` keeps the web build's copy out of every
  installer, so adding files here never inflates the Windows download.
- Overlays named in `BUNDLED_KML_SEED_NAMES` (`src/state/mapOverlays.ts`) are drawn on the map
  automatically when a session starts with no overlays of its own. A restored project keeps its
  own overlay list untouched.
- Packaged builds use the Electron user-data directory for the writable library rather than this repository checkout.
- Keep only representative, non-sensitive sample overlay files in git.
