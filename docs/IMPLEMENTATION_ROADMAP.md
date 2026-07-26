# Joint Domain Data Compiler — Implementation Roadmap

**Plan ID:** `JDDC-ROADMAP-2026-01`  
**Status:** Active development authority  
**Repository:** `A13Xg/Joint-Domain-Data-Compiler`

## Product objective

Evolve the local-first TSPI conversion utility into a deterministic engineering workbench for ingestion, quality assessment, correction, synchronized inspection, comparison, reproducible projects, export and reporting. The application must remain offline-capable, auditable, format-agnostic and suitable for browser and desktop distribution.

## Repository policy

Branch protection and GitHub rulesets are optional administration choices. They are not implementation, acceptance, merge or release requirements.

## Delivery rules

Every meaningful increment requires reachable implementation, focused tests, representative and malformed fixtures, explicit failure handling, lint/typecheck/regression/build validation, undo/provenance for mutations, and an implementation audit. Long-running work must expose progress and cancellation. Visualizations must downsample when necessary.

---

## Phase 0 — Baseline stabilization

**Status:** PARTIAL

Complete: CI, lint, tests, GPX validation, production build, platform packaging workflows, Windows installer/portable targets, dependency audits, SBOMs, checksums, Semgrep and consolidated regression execution.

Remaining: packaged-binary inspection, Windows signing, macOS signing/notarization, stable/prerelease channel policy.

---

## Phase 1 — Shared selection and synchronization

**Status:** DONE

Complete:

- Dataset-scoped persistent point selection.
- Transient synchronized data cursor across chart, map, table and 3D.
- 3D playback-driven cursor synchronization.
- Chart point selection and range brushing.
- Index-range and time-range synchronization.
- Flight-segment selection mapped to source intervals.
- Map selected point, cursor, path/range highlighting and fit-to-range.
- Table selected point, cursor, range highlighting, range-only filtering and linked scrolling.
- 3D selected point, cursor, playback and selected-range rendering.
- Selection-scoped statistics and transforms.
- Keyboard navigation: arrows, Shift+arrows, Home, End, Enter and Escape.
- Dataset-change stale-state protection.
- Focused linked-selection regression coverage.
- Independent acceptance audit in `docs/PHASE1_AUDIT.md`.

Acceptance result: a cursor, point, time/index range or segment selection is consistently represented by all applicable linked views without mutating source data.

---

## Phase 2 — Derived analytics and segmentation

**Status:** DONE

Complete: versioned derivations, cumulative distance, ground/vertical speed, heading, turn rate, sample interval/frequency, flight-state segmentation, gap/quality segmentation and focused tests.

---

## Phase 3 — Time-series workspace

**Status:** PARTIAL

Complete: presets, time/index/distance axes, extrema-preserving downsampling, linked cursor, point/range selection and selected-range statistics.

Remaining: multi-chart layouts, synchronized crosshairs between simultaneous charts, independent Y axes, overlays, statistical plots, image export and higher-performance renderer evaluation.

---

## Phase 4 — Data-massaging pipeline

**Status:** PARTIAL

Complete: undo/redo, versioned recipes, coordinate swap, invalid removal, dedupe, decimation, simplification, moving average, offsets, elevation outlier removal, derived channels, fixed-rate gap-aware resampling and selection-scoped transforms.

Remaining: previews, impact summaries, median/Hampel/Savitzky–Golay/EMA/Butterworth filters, rolling statistics, derivatives/integrals, distance resampling, cubic interpolation, timestamp repair and recipe UI.

---

## Phase 5 — Workers and large-data architecture

**Status:** PARTIAL

Complete: typed protocol, Worker host/client, production Worker, progress, cancellation, Worker resampling and dense chart preparation.

Remaining: transferable columnar storage, Worker pool, Worker range statistics, progressive import, memory budgets and 100k/500k/1M benchmarks.

---

## Phase 6 — Multi-dataset comparison

**Status:** PARTIAL

Complete: multiple datasets, reference/target selection, nearest-time alignment, manual offset, local-ENU relative analytics, range/bearing/vertical separation/closure, closest approach and aligned table.

Remaining: interpolation, cross-correlation/event alignment, clock drift, along/cross-track errors, residual charts, multi-track comparison and report export.

---

## Phase 7 — Local 3D trajectory workspace

**Status:** PARTIAL

Complete: WGS84/ECEF/ENU geometry, bounded source-index retention, perspective/orthographic projection, orbit/pan/zoom, camera reset/fit, point picking, linked cursor, channel coloring, selected-range emphasis, start/end/selected/playback markers, playback controls, grid, curtain and altitude exaggeration.

Remaining: multi-track rendering, separation vectors, closest-approach visualization, chase camera, timestamp-accurate playback, camera persistence, screenshot export and optional WebGL/Three.js migration if profiling requires it.

---

## Phase 8 — GPU map and globe

**Status:** READY

Complete: Leaflet map, bounded point rendering, channel coloring and linked point/range/cursor state.

Remaining: deck.gl GPU layers, optional Cesium globe, multi-track styling, playback and screenshot export.

---

## Phase 9 — Format expansion

**Status:** PARTIAL

Complete imports: CSV/TSV, GPX, GeoJSON, KML, NMEA and GPB.

Remaining priority: Arrow, Parquet, CZML, KMZ, IGC, FIT, TCX, MAVLink, ADS-B layouts and SQLite. Each format requires representative/malformed fixtures, metadata and unit mapping, size limits and round-trip tests where applicable.

---

## Phase 10 — Projects, reproducibility and reports

**Status:** PARTIAL

Complete: versioned manifest, compressed `.jddc-project`, embedded datasets, fingerprints, undo/redo persistence, active dataset/tab, point/range selection and archive limits.

Remaining: migrations, captured recipes, bookmarks/annotations, chart layouts, map/3D camera state, comparison settings, HTML/PDF-ready reports and embedded images.

---

## Phase 11 — Extensibility boundaries

**Status:** DONE

Complete: compile-time parser, exporter, operation, derivation, chart-preset and report-section contracts plus atomic registry. Runtime third-party discovery remains intentionally excluded pending a secure sandbox/signing model.

---

## Phase 12 — Release and security hardening

**Status:** ACTIVE

Complete: dependency audit, SBOM, checksums, Semgrep, malformed fixtures, project limits and CI artifacts.

Remaining: signing/notarization, Electron fuse review, parser fuzzing, future archive bomb protections, provenance attestations, crash-report export and packaged-binary smoke tests.

## Current priority sequence

1. Phase 3 multi-chart workspace and synchronized crosshairs.
2. Phase 4 transform previews and filter family.
3. Phase 5 transferable columnar Worker payloads and benchmarks.
4. Phase 6 interpolated comparison and multi-track visualization.
5. Phase 10 project migrations, recipe capture, bookmarks and reports.
6. Phase 12 signing, fuzzing and provenance hardening.

## Definition of done

A task is complete only when reachable, tested, documented, independently reviewed, validated by CI and free of known blocking defects. Partial foundations remain `PARTIAL` rather than `DONE`.
