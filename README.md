# Joint Domain Data Compiler

A **single-user trajectory and TSPI engineering workbench** for importing, normalizing, inspecting, transforming, comparing, visualizing, saving and exporting time-space-position-information data.

JDDC runs as a browser application and an Electron desktop application. Data parsing and processing are local and do not require a cloud service. The default OpenStreetMap basemap does require network access; the local dataset workflows continue to work without it.

## Current product state

JDDC is a functional engineering workbench with a strong deterministic core. It is not yet production-complete. The canonical roadmap and active execution plan are:

- `docs/IMPLEMENTATION_ROADMAP.md` — product/stage status and definition of done.
- `.hermes/plans/2026-07-26_223300-full-roadmap-execution.md` — the tranche-by-tranche implementation plan currently being executed.

## Import

| Format | Extensions | Current behavior |
|---|---|---|
| CSV / TSV | `.csv .tsv .txt` | Header analysis, field mapping, type inference, DMS coordinates, decimal-comma handling and multiple timestamp forms. |
| GPX | `.gpx` | Tracks, routes, waypoints and extension-leaf channels. |
| GeoJSON | `.geojson .json` | Points, LineStrings, MultiLineStrings and supported geometry collections. |
| KML | `.kml` | Points, LineStrings and Google `gx:Track`. |
| NMEA 0183 | `.nmea .gps .log` | GGA, RMC and GLL with checksum handling. |
| GPB | `.gpb .bin` | Compact JDDC numeric binary transport. GPB is not a complete lossless workspace format. |

All supported inputs normalize into a shared dataset model with source metadata, channel definitions, provenance fields, warnings and quality flags.

## Analysis and linked inspection

- Overview statistics and basic data-quality checks.
- A basic UI derivation operation for cumulative distance, speed and heading.
- A tested versioned standard-kinematics engine for additional channels; full UI integration remains roadmap work.
- Default flight/data-state segmentation with linked segment selection.
- Dataset-scoped persistent point selection.
- Synchronized transient data cursor across chart, map, table and 3D.
- Index-range, time-range and segment selection.
- Selection-scoped statistics and supported transforms.
- Keyboard navigation for selection and cursor movement.

## Visualization

### Charts

- One multi-channel SVG time-series surface.
- Time, source-index and cumulative-distance axes.
- Built-in presets and extrema-preserving source-index-aware downsampling.
- Linked cursor, point selection, range brushing and selected-range statistics.

Multi-pane layouts, explicit per-series scales, zoom/pan, statistical plots and image export remain roadmap work.

### Map

- Leaflet path and bounded point rendering.
- Channel-based coloring, linked cursor/selection/range emphasis and fit-to-range.
- Default OpenStreetMap tiles are online; an offline/no-basemap mode remains roadmap work.

### 3D

- Local ENU trajectory geometry rendered through a custom Canvas perspective/orthographic viewer.
- Orbit, pan, zoom, reset, fit, point picking, channel coloring, altitude exaggeration, ground grid, vertical curtain and linked cursor/selection/ranges.
- Fraction-based playback and speed controls.

Timestamp-accurate playback, follow/chase behavior, multi-track rendering, persisted camera state and performance validation remain roadmap work.

### Comparison

- Two-dataset reference/target comparison.
- Nearest-time alignment with tolerance and manual target time offset.
- Local-ENU relative position, horizontal/slant range, bearing, vertical separation, closure rate and closest approach.

Interpolation, time-reference reconciliation, drift estimation, multi-track visualization and reports remain roadmap work.

## Transforms

- Sort by time.
- Swap coordinates.
- Remove invalid or duplicate points.
- Decimate and simplify.
- Moving-average smoothing.
- Shift timestamps and elevation.
- Remove local elevation outliers.
- Fixed-rate linear or step resampling with gap protection in a Worker.
- Selection-scoped safe transforms.
- Undo and redo using dataset snapshots.

Transform previews, durable operation records, recipe UI, advanced filters and memory-efficient history remain roadmap work.

## Projects

JDDC can save and reopen a self-contained gzip `.jddc-project` v1 archive containing:

- embedded datasets;
- dataset fingerprints;
- undo/redo dataset snapshots;
- active dataset;
- basic tab and point/index-range selection fields.

The current archive is not yet complete workspace persistence. Chart layouts, map controls, 3D camera state, comparison settings, operation recipes, schema migrations, compact history and reports remain roadmap work.

## Export

- GPX 1.1 with schema validation.
- CSV.
- GeoJSON.
- KML.
- GPB compact numeric binary.

Project archives currently provide higher-fidelity JDDC persistence than the individual interchange formats.

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

Configured targets:

- Windows: NSIS installer and portable executable.
- Linux: AppImage and DEB.
- macOS: DMG and ZIP.

The release workflow also produces SBOMs and SHA-256 checksums. Code signing, macOS notarization, provenance attestations and automated packaged-application smoke tests are not yet complete.

## Testing

The default suite currently includes 20 deterministic TypeScript regression harnesses covering core analytics, selection, transforms, resampling, compute protocol/runtime, project archives, recipes/plugins, geodesy, 3D geometry and exports.

The repository does not yet have a rendered-component suite, browser end-to-end suite, packaged Electron launch tests, performance regression suite or parser fuzzing. These are explicit roadmap priorities.

## Test data

`file-test/` contains a documented USGS-derived sample corpus in CSV, GeoJSON and GPX forms, comparison inputs and a malformed negative CSV fixture.

## Branch workflow

- `main` is the validated integration and release history.
- `agent/roadmap-integration` is the active roadmap-development branch.
- PR #25 is the current integration pull request.
- Branch protection and GitHub rulesets are optional administration choices, not implementation or release requirements.
