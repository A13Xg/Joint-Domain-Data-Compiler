# Joint Domain Data Compiler

A local-first **TSPI flight-data workbench** for technical data engineers. Import a wide
variety of time-space-position-information formats, **visualize, correct, and massage** the
data, and export to any supported format — all offline, in the browser or as a desktop app.

> Conversion is built around a single normalized point model, so every input format can be
> exported to every output format (an N-to-M conversion matrix), and the GPX writer is
> validated against the official GPX 1.1 XSD for maximum downstream compatibility.

## Capabilities

### Import (auto-detected by extension)
| Format | Extensions | Notes |
| --- | --- | --- |
| CSV / TSV | `.csv .tsv .txt` | Header-aware, column-mapping UI with type inference. DMS + comma decimals. |
| GPX | `.gpx` | Tracks, routes, waypoints (GPX 1.0/1.1), extension channels preserved. |
| GeoJSON | `.geojson .json` | RFC 7946 LineString/Point/Multi*/Polygon; properties → channels. |
| KML | `.kml` | `LineString`/`Point` coordinates and Google `gx:Track` with timestamps. |
| NMEA 0183 | `.nmea .gps .log` | GGA/RMC/GLL decoding, checksum validation, sats/HDOP/speed/heading. |
| GPB | `.gpb .bin` | Self-describing binary container for lossless high-rate round-trips. |

### Export
- **GPX 1.1** — schema-valid, time-sorted, correct child ordering, `<bounds>`, namespaced extensions, optional UTF-8 BOM.
- **CSV** — flat table including every derived/extension channel.
- **GeoJSON** — RFC 7946 FeatureCollection (track + named waypoints).
- **KML** — Google Earth track with timestamps and altitude.
- **GPB** — lossless binary container.

### Analyze & visualize
- Overview dashboard: distance, duration, sample rate, speed, elevation gain/range, bounding box.
- **Data-quality report**: coordinate validity, time monotonicity, duplicates, channel stats.
- **Interactive map** (Leaflet) with path/points modes and gradient coloring by any channel.
- **Multi-channel time-series charts** (elevation, speed, heading, custom…) with hover readout.
- **Windowed data grid** (sortable, searchable) that stays smooth at hundreds of thousands of points.

### Correct & massage (stackable, with undo/redo)
Sort by time · swap lat/lon · drop invalid · dedupe (distance tolerance) · decimate ·
Douglas–Peucker simplify · moving-average smoothing (position/elevation) · derive
distance/speed/heading · shift time · offset elevation · MAD-based elevation outlier rejection.

### Engineering ergonomics
- Structured **logging console** (levels, filter, search, export) capturing every pipeline action.
- Global **error boundary** and `window` error/rejection capture — nothing fails silently.
- Spinners, progress bars, and animated feedback throughout.

## Why the GPX output is more compatible

The original converter produced GPX that strict parsers (Garmin BaseCamp, `gpsbabel -x validate`,
XSD loaders) rejected. This version fixes the root causes:

1. **Schema-valid child ordering** — `<ele> → <time> → <name> → <cmt> → <desc> → … → <extensions>`
   (the old output put `<desc>` before `<cmt>`, which is invalid).
2. **Deterministic UTC timestamps** — explicit format parsing instead of engine-dependent `Date`.
3. **Chronological sorting on export** (the preview used to sort but the export did not).
4. **`<bounds>` metadata** so importers fit/zoom correctly.
5. **Pretty-printed** output for naive line-based importers.

Correctness is enforced by an automated test that validates generated GPX against the bundled
official **GPX 1.1 XSD** (`test/schemas/gpx.xsd`) via `xmllint`.

## Quick start (web)

```bash
npm install
npm run dev      # http://localhost:5173
```

Requires **Node 22+** (Vite 8 / rolldown).

## Desktop (Electron)

```bash
npm run dev:desktop          # Vite + Electron, live reload
npm run build:desktop        # package for the current OS into release/
npm run build:desktop:linux  # AppImage + .deb
npm run build:desktop:win    # NSIS .exe (run on Windows or with wine)
```

## Tests

```bash
npm run lint
npm test     # conversion + GPX XSD validation (xmllint optional; skipped if absent)
```

## Releases (CI)

`.github/workflows/release.yml` builds installers on Linux, Windows, and macOS for any pushed
`v*` tag, runs lint + tests as a gate, and attaches artifacts (`.deb`, `.AppImage`, `.exe`,
`.dmg`, `.zip`) to the GitHub Release.

```bash
git tag v0.2.0 && git push origin v0.2.0
```

## Architecture

```
src/core/            Format-agnostic engine (no React)
  model.ts           Unified TrackPoint / Dataset model + geo helpers
  format.ts          Robust number/coordinate/timestamp parsing
  logger.ts          Structured pub/sub logger
  stats.ts           Statistics & quality profiling
  transforms.ts      Pure data-massaging operations
  parsers/           csv, gpx, geojson, kml, nmea, gpb + registry
  exporters/         gpx (XSD-valid), csv, geojson, kml + registry
src/ui/              Presentational components (map, charts, table, panels, logs)
src/workers/         CSV analyzer Web Worker (off-main-thread profiling)
src/App.tsx          Tabbed workspace orchestrator
electron/            Desktop shell
test/validate.ts     Conversion correctness + XSD validation harness
```

## Extending

- **New input format**: add a parser under `src/core/parsers/`, register it in
  `parsers/index.ts` (`INPUT_FORMATS`), returning a `ParseResult`.
- **New export format**: add a writer under `src/core/exporters/` and register it in
  `EXPORTERS`.
- **New transform**: add a pure function to `src/core/transforms.ts` and an `Op` card in
  `src/ui/TransformPanel.tsx`.
