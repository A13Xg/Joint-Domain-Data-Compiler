# Joint Domain Data Compiler

[![Quality Gates](https://github.com/A13Xg/Joint-Domain-Data-Compiler/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/A13Xg/Joint-Domain-Data-Compiler/actions/workflows/ci.yml)
[![Windows package](https://img.shields.io/github/actions/workflow/status/A13Xg/Joint-Domain-Data-Compiler/release.yml?branch=main&label=Windows)](https://github.com/A13Xg/Joint-Domain-Data-Compiler/actions/workflows/release.yml)
[![macOS package](https://img.shields.io/github/actions/workflow/status/A13Xg/Joint-Domain-Data-Compiler/release.yml?branch=main&label=macOS)](https://github.com/A13Xg/Joint-Domain-Data-Compiler/actions/workflows/release.yml)
[![Linux package](https://img.shields.io/github/actions/workflow/status/A13Xg/Joint-Domain-Data-Compiler/release.yml?branch=main&label=Linux)](https://github.com/A13Xg/Joint-Domain-Data-Compiler/actions/workflows/release.yml)
[![Runtime audit](https://img.shields.io/badge/runtime_audit-0_high%2Fcritical-15803d)](docs/dependency-policy.md)

A **single-user trajectory and TSPI engineering workbench** for importing, normalizing, inspecting, transforming, comparing, visualizing, saving and exporting time-space-position-information data.

JDDC runs as a browser application and an Electron desktop application. Data parsing and processing are local and do not require a cloud service. The default OpenStreetMap basemap does require network access; the local dataset workflows continue to work without it.

## Current product state

JDDC is a functional engineering workbench with a strong deterministic core. It is not yet production-complete.

- `futureConsiderations.md` — known open items and deferred work.
- `CHANGELOG.md` — user-visible changes grouped by release.

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
- A versioned standard-kinematics derivation for distance, speed, vertical speed, heading,
  turn rate, acceleration and sample timing, wired into the normal transform workflow.
- Quality-event detection and linked overlays for timestamp gaps/duplicates, coordinate jumps,
  invalid coordinates, elevation spikes and elevation flatlines.
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
- Zoom, pan and range reset, plus accessible patterned quality-event overlays.

Multi-pane layouts, explicit per-series scales, statistical plots and image export remain roadmap work.

### Map

- Leaflet path and bounded point rendering.
- Channel-based coloring, linked cursor/selection/range emphasis and fit-to-range.
- Simultaneous, individually styled multi-source tracks.
- Default OpenStreetMap tiles are online; an offline/no-basemap mode is available for local work.

### 3D

- Local ENU trajectory geometry rendered through a custom Canvas perspective/orthographic viewer.
- Orbit, pan, zoom, reset, fit, point picking, channel coloring, altitude exaggeration, ground grid, vertical curtain and linked cursor/selection/ranges.
- Fraction-based playback and speed controls.

Timestamp-accurate playback, follow/chase behavior, multi-track rendering and performance validation remain roadmap work.

### Comparison

- Two-dataset reference/target comparison.
- Nearest-time or interpolated alignment with tolerance/gap controls and manual target time offset.
- Local-ENU relative position, horizontal/slant range, bearing, vertical separation, closure rate and closest approach.

Time/altitude-reference compatibility guards are applied before sensitive analysis. Drift
estimation, multi-track comparison visualization and richer reports remain roadmap work.

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
- Before/after previews for destructive operations and in-session versioned operation history.
- Median and Hampel elevation filters.

Recipe UI, additional advanced filters and memory-efficient history remain roadmap work.

## Projects

JDDC can save and reopen a bounded, self-contained gzip `.jddc-project` archive containing:

- embedded datasets;
- dataset fingerprints;
- undo/redo dataset snapshots;
- active dataset;
- durable chart, map, 3D, comparison and multi-source display settings;
- linked point/range selection state;
- bookmarks.
- validated transform/operation history.

The Project tab can also export a self-contained, print-ready HTML analysis report with dataset
statistics, source/reference metadata, quality-event evidence, warnings, bookmarks and recorded
transform history. Its light VectorPunk/HUD visual system is designed for economical printing
and browser-based PDF export.

Archive schema migration infrastructure is in place. Operation recipes, annotations, compact
history and richer reports remain roadmap work.

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

The release workflow also produces SBOMs, SHA-256 checksums, and GitHub/Sigstore build-provenance
attestations; enforces a reviewed Electron fuse set; signs Windows artifacts when repository
certificate secrets are available (otherwise producing and verifying an unsigned fallback); and
runs a native packaged-renderer smoke gate on Linux, Windows and macOS. Follow
[`docs/release-checklist.md`](docs/release-checklist.md) for a release and
[`docs/rollback.md`](docs/rollback.md) for recovery. Linux is locally proven; native Windows and
macOS execution awaits an available GitHub-hosted runner. macOS signing/notarization still
requires owner-provided credentials.

## Testing

The default suite currently includes 42 deterministic TypeScript regression harnesses covering
analytics, linked visualization helpers, selection, transforms, fusion, resampling, compute
protocol/runtime, project archives/migrations, diagnostics, recipes/plugins, geodesy, 3D
geometry, parsers, bounded property/fuzz cases and exports.

The repository includes a Chromium end-to-end smoke test for the primary local workflow:
GPX import, linked table/chart/map/3D selection, transform, project save/open, report and
diagnostic export, and GPX export. Bounded property/fuzz coverage exercises transforms, parsers,
structured GeoJSON and archive corruption. It does not yet have a broader rendered-component or
visual-snapshot suite. A reproducible benchmark harness and recorded baseline exist, but broader
performance coverage remains a roadmap priority.

## Test data

`file-test/` contains a documented USGS-derived sample corpus with valid and malformed fixtures
for every supported import format, plus comparison inputs.

## Branch workflow

- `main` is the validated integration and release history.
- Branch protection and GitHub rulesets are optional administration choices, not implementation or release requirements.
