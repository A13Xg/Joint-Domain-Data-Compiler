# Joint Domain Data Compiler

A local-first **TSPI flight-data engineering workbench** for importing, validating, visualizing, correcting, comparing, and exporting time-space-position-information data. It runs offline in the browser or as an Electron desktop application.

> The application uses a normalized dataset model, semantic channel metadata, source provenance, and quality flags so supported input formats can flow through the same analysis and export pipeline.

## Current capabilities

### Import

| Format | Extensions | Notes |
| --- | --- | --- |
| CSV / TSV | `.csv .tsv .txt` | Header-aware mapping, type inference, DMS and comma-decimal handling. |
| GPX | `.gpx` | Tracks, routes, waypoints, extension-channel preservation. |
| GeoJSON | `.geojson .json` | RFC 7946 features and property channels. |
| KML | `.kml` | `LineString`, `Point`, and Google `gx:Track`. |
| NMEA 0183 | `.nmea .gps .log` | GGA/RMC/GLL, checksum checks, satellite/HDOP/speed/heading fields. |
| GPB | `.gpb .bin` | Self-describing binary container for lossless high-rate round trips. |

### Export

- GPX 1.1 with schema-valid ordering, bounds, deterministic UTC timestamps, namespaced extensions, and optional UTF-8 BOM.
- CSV with normalized and derived channels.
- GeoJSON FeatureCollection.
- KML track output.
- GPB binary output.

### Analysis and visualization

- Overview statistics and data-quality reporting.
- Leaflet map with point/path modes, channel coloring, selected-range highlighting, and fit-to-range controls.
- Dense multi-channel charts with altitude, speed, vertical-speed, heading, sample-timing, and altitude-distance presets.
- Extrema-preserving chart downsampling with source-index retention.
- Linked point selection across chart, map, virtualized table, and local 3D view.
- Linked selected-range highlighting across map, table, transform scope, statistics, and 3D.
- Table selected-range filtering and automatic selected-point scrolling.
- Chart range brushing with selected-range duration, distance, and channel min/max/mean statistics.
- Derived channels including distance, ground speed, vertical speed, heading, turn rate, acceleration, sample interval, and sample frequency.
- Configurable stationary, climb, level, descent, gap, and unknown segmentation.
- Interactive local ENU 3D trajectory workspace with perspective/orthographic projection, orbit, pan, zoom, channel coloring, point picking, ground grid, vertical curtain, playback, speed controls, follow mode, selected-range highlighting, and altitude exaggeration.
- Multi-dataset comparison workspace using nearest-time alignment, manual time offset, relative range, bearing, vertical separation, closest approach, and closure rate.

### Transforms

- Sort by time, swap coordinates, drop invalid points, deduplicate, decimate, simplify, smooth, derive channels, shift time, offset elevation, and remove elevation outliers.
- Selection-scoped safe transforms that preserve records outside the selected range.
- Fixed-rate linear or step interpolation with configurable gap protection.
- Worker-based resampling with progress reporting and cancellation.
- Undo and redo.

### Projects

- Complete compressed `.jddc-project` save and restore.
- Embedded datasets, undo/redo histories, active dataset and tab, point/range selection, fingerprints, and archive safety limits.

## Development

```bash
npm ci
npm run dev
```

Run the complete validation suite:

```bash
npm run lint
npm test
npm run build
```

Desktop development:

```bash
npm run dev:desktop
```

## Packaging

```bash
npm run build:desktop
npm run build:desktop:win
npm run build:desktop:linux
```

Windows packaging produces both an NSIS installer and a portable executable. Linux packaging produces AppImage and DEB outputs. macOS targets DMG and ZIP.

## Test data

`file-test/` contains a curated and documented USGS-derived corpus in CSV, GeoJSON, and GPX forms, comparison fixtures, and malformed negative data for manual import and smoke testing.

## Branch workflow

- `main` is the validated integration and release history.
- `agent/roadmap-integration` is the sole active roadmap-development branch.
- PR #25 is the canonical integration pull request.
- Branch protection and GitHub rulesets are optional and are not merge or release requirements.

See:

- `docs/IMPLEMENTATION_ROADMAP.md`
- `docs/EXECUTION_STATUS.md`
- `docs/INTEGRATION_BRANCH_AUDIT.md`
- `docs/BRANCH_STRATEGY.md`
