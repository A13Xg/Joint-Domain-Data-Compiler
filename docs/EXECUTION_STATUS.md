# JDDC Roadmap Execution Status

**Roadmap:** `JDDC-ROADMAP-2026-01`  
**Active integration PR:** #25 (`agent/roadmap-integration` → `main`)

## Status key

- `DONE` — implemented and validated on the integration branch or already merged.
- `PARTIAL` — usable vertical slices exist; roadmap scope remains.
- `ACTIVE` — current implementation focus.
- `READY` — dependencies are available.

## Phases

| Phase | Status | Completed work / remaining boundary |
|---|---|---|
| 0 — Baseline stabilization | PARTIAL | CI, consolidated regression suite, packaging workflows, SBOM and checksums done. Manual cross-platform package inspection and signing remain. Branch protection is intentionally not a release requirement. |
| 1 — Shared selection | PARTIAL | Point/range state, chart brushing, linked point selection, statistics, selection-scoped transforms, and map/table/3D range highlighting are done. Shared hover cursor and deeper integration tests remain. |
| 2 — Derived analytics | DONE | Versioned derivation registry, standard kinematics, flight-state and data-quality segmentation are implemented and tested. |
| 3 — Time-series workspace | PARTIAL | Presets, distance axis, extrema-preserving downsampling and brushing done. Multi-chart layouts, synchronized crosshairs, statistical plots and image export remain. |
| 4 — Data-massaging pipeline v2 | PARTIAL | Versioned recipes, undo/redo, fixed-rate linear/step resampling and scoped transforms done. Additional filters, previews and recipe UI remain. |
| 5 — Workers and large-data architecture | PARTIAL | Typed protocol, host, browser client, production worker, progress and cancellation done. Transferable columnar storage and worker pool remain. |
| 6 — Multi-dataset comparison | PARTIAL | Nearest-time alignment, ENU relative metrics and Compare UI done. Interpolation, cross-correlation, residual charts and reports remain. |
| 7 — Local 3D trajectory viewer | PARTIAL | WGS84/ECEF/ENU geometry plus perspective/orthographic rendering, orbit/pan/zoom, point picking, channel coloring, selected-range highlighting, playback, follow mode, ground grid and vertical curtain are done. Multi-track vectors, chase camera and image export remain. |
| 8 — GPU map and optional globe | READY | Current map is functional and range-linked; deck.gl/Cesium evaluation and GPU implementation remain. |
| 9 — Format expansion | PARTIAL | CSV/TSV, GPX, GeoJSON, KML, NMEA and GPB import plus current exporters are available. Arrow, Parquet, CZML, IGC, FIT and other roadmap formats remain. |
| 10 — Projects, reproducibility, reports | PARTIAL | Complete compressed project save/restore with embedded datasets, histories and selection is done. Recipe capture, migrations, bookmarks and report generation remain. |
| 11 — Extensibility boundaries | DONE | Compile-time plugin contracts and atomic registry exist for parsers, exporters, operations, derivations, chart presets and report sections. Runtime discovery remains intentionally excluded. |
| 12 — Release and security hardening | ACTIVE | Runtime audit, SBOM, checksums, Semgrep, malformed fixtures and archive limits done. Signing, notarization, fuzzing and attestations remain. |

## Current verified increment

- Highlight chart-selected index ranges on the map, including fit-to-range controls.
- Highlight and optionally isolate selected ranges in the virtualized table.
- Replace the basic SVG 3D preview with an interactive perspective/orthographic trajectory workspace.
- Add 3D orbit, pan, zoom, playback, follow mode, point picking, channel coloring, grid, curtain, selection and range synchronization.
- Remove branch protection from the merge and release requirements.

## Merge discipline

Each increment must pass the consolidated CI suite, production build, static analysis, security checks, and relevant focused checks before PR #25 is marked ready.
