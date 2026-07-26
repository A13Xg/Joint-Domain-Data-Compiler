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
- Leaflet map with point/path modes and channel coloring.
- Dense multi-channel charts with altitude, speed, vertical-speed, heading, sample-timing, and altitude-distance presets.
- Extrema-preserving chart downsampling with source-index retention.
- Linked point selection across chart, map, virtualized table, and local 3D view.
- Chart range brushing with selected-range duration, distance, and channel min/max/mean statistics.
- Derived channels including distance, ground speed, vertical speed, heading, turn rate, acceleration, sample interval, and sample frequency.
- Configurable stationary, climb, level, descent, gap, and unknown segmentation.
- Interactive local ENU trajectory preview with yaw, pitch, altitude exaggeration, source-point selection, and channel coloring.
- Multi-dataset comparison workspace using nearest-time alignment, manual time offset, relative range, bearing, vertical separation, closest approach, and closure rate.

### Data correction and massaging

All transforms use immutable point arrays and the UI maintains undo/redo history.

- Sort by time.
- Swap latitude and longitude.
- Drop invalid coordinates.
- Deduplicate and decimate.
- Meter-based Douglas–Peucker simplification.
- Antimeridian-safe moving-average smoothing.
- Rolling-MAD elevation outlier rejection.
- Time and elevation offsets.
- Derived kinematics.
- Fixed-rate resampling with linear or step interpolation and maximum-gap protection.
- Selection-scoped execution for point-count-preserving transforms.
- Versioned operation records, dataset fingerprints, recipe construction, and guarded replay.
- Fixed-rate resampling executes through the production compute Worker with progress and cancellation controls.

### Projects, compute, and extensibility

- Export and validate versioned `.jddc-project` manifest JSON.
- Persist dataset fingerprints, source references, active dataset, active tab, and workspace-selection schema.
- Typed compute protocol with progress, cancellation, success, and failure messages.
- Browser compute client and production Worker runtime.
- Worker tasks for dense chart-series preparation and fixed-rate resampling.
- Compile-time plugin contracts for parsers, exporters, operations, derivations, chart presets, and report sections.
- Dataset-payload embedding, ZIP project archives, full recipe capture, and project rehydration remain planned increments.

## Quick start

Requires **Node.js 22 or newer**.

```bash
npm ci
npm run dev
```

The development server is normally available at `http://localhost:5173`.

## Desktop application

```bash
npm run dev:desktop
npm run build:desktop
npm run build:desktop:linux
npm run build:desktop:win
```

Windows packaging produces both:

- `Joint Domain Data Compiler-<version>-Windows-x64-Setup.exe`
- `Joint Domain Data Compiler-<version>-Windows-x64-Portable.exe`

The portable build can run without installation, although Electron may still use the user's profile for cache and application data.

## Validation

```bash
npm run lint
npm test
npm run build
```

`npm test` discovers and executes every TypeScript regression harness under `test/`. The suite covers conversion, GPX XSD validation, transforms, recipes, selection, analytics, segmentation, chart-series preparation, resampling, geodesy, relative analytics, project manifests, plugins, compute protocol/client/worker behavior, range statistics, and 3D trajectory geometry.

Pull-request CI performs:

- deterministic `npm ci` installation;
- ESLint validation;
- the complete regression suite;
- TypeScript and Vite production builds;
- mandatory GPX 1.1 XSD validation on Linux;
- CodeQL JavaScript/TypeScript security-and-quality analysis;
- runtime dependency audit, SBOM generation, and release checksum validation.

## Releases

`.github/workflows/release.yml` builds native Linux, Windows, and macOS artifacts for matching `v*` tags. It verifies that the tag matches `package.json`, generates platform SBOMs and SHA-256 manifests, and attaches validated artifacts to GitHub Releases.

Manual workflow runs create downloadable Actions artifacts but do not publish a GitHub Release.

```bash
git tag v0.1.0
git push origin v0.1.0
```

Windows and macOS signing are not configured yet, so operating-system reputation warnings may appear.

## Repository workflow

- `main` is the validated integration source of truth.
- `agent/roadmap-integration` is the sole active development branch.
- Pull request [#25](https://github.com/A13Xg/Joint-Domain-Data-Compiler/pull/25) is the current integration PR.
- Historical `agent/*` branches are superseded and should not receive new commits.

See:

- `docs/IMPLEMENTATION_ROADMAP.md`
- `docs/BRANCH_STRATEGY.md`
- `docs/INTEGRATION_BRANCH_AUDIT.md`

## Architecture

```text
src/core/            Normalized model, parsers, exporters, transforms, analytics,
                     recipes, plugins, geodesy, and comparison logic
src/compute/         Compute protocol, client, task host, Worker runtime, and tasks
src/state/           Shared point/range selection state
src/visualization/   Dense chart-series and local 3D geometry preparation
src/persistence/     Project-manifest schema and validation
src/ui/              Import, map, charts, table, comparison, 3D, project, transform,
                     export, statistics, and logging workspaces
src/workers/         Worker entrypoints
electron/            Hardened desktop shell
test/                Regression harnesses and GPX schema
scripts/             Cross-platform test orchestration
docs/                Roadmap, branch strategy, and integration audit
```

## Extending

- Add input formats through parser contracts and registration.
- Add output formats through exporter contracts and registration.
- Add deterministic transforms through operation definitions and recipe records.
- Add derived channels through the derivation registry.
- Add chart presets and report sections through compile-time plugin contracts.

New functionality should include fixtures, malformed-input coverage, explicit units and null behavior, and a focused regression harness included in the consolidated `npm test` run.
