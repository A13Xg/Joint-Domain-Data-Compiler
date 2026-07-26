# Joint Domain Data Compiler — Implementation Roadmap

**Plan ID:** `JDDC-ROADMAP-2026-01`  
**Status:** Active development authority  
**Repository:** `A13Xg/Joint-Domain-Data-Compiler`

## Product objective

Evolve the local-first TSPI conversion utility into a robust engineering workbench for:

- ingestion and normalization;
- data-quality assessment;
- correction and signal processing;
- synchronized chart, map, table and 3D inspection;
- multi-dataset comparison;
- reproducible project persistence;
- high-confidence export and reporting.

The application must remain offline-capable, deterministic, auditable, format-agnostic and suitable for browser and desktop distribution.

## Repository policy

Branch protection and GitHub rulesets are optional administration choices. They are not implementation, acceptance, merge or release requirements.

## Delivery rules

Every meaningful increment must include:

1. real implementation reachable through the UI or a documented API;
2. focused tests and representative fixtures;
3. malformed and boundary-case handling;
4. lint, typecheck, complete regression and production-build validation;
5. visible warnings and failure states;
6. undo and provenance for data mutations;
7. a concise implementation and audit summary.

Long-running user operations must expose progress and cancellation. Visualizations must downsample when display resolution cannot represent all source points.

---

## Phase 0 — Baseline stabilization

**Status:** PARTIAL

### Complete

- CI lint, tests, GPX XSD validation and production build.
- Windows, Linux and macOS packaging workflows.
- Windows installer and portable targets.
- Runtime dependency audit.
- CycloneDX SBOM generation.
- SHA-256 release manifests.
- Semgrep production-source static analysis.
- Consolidated default regression command.

### Remaining

- Manual packaged-binary inspection on supported platforms.
- Windows code signing.
- macOS signing and notarization.
- Stable and prerelease channel policy.

---

## Phase 1 — Shared selection and synchronization

**Status:** PARTIAL

### Complete

- Shared point and index-range selection state.
- Chart point selection and range brushing.
- Linked chart, map, table and 3D point selection.
- Map selected-range path and point highlighting.
- Map fit-to-range control.
- Table selected-range highlighting and range-only filtering.
- 3D selected-range highlighting.
- Selection-scoped statistics and transforms.
- Clear point and range actions.

### Remaining

- Shared hover cursor.
- Time-range and segment selection.
- Keyboard selection navigation.
- Broader linked-component integration tests.

### Acceptance target

A selected point or range is visibly synchronized across chart, map, table, statistics, transform scope and 3D.

---

## Phase 2 — Derived analytics and segmentation

**Status:** DONE

### Complete

- Versioned derivation registry.
- Distance and cumulative distance.
- Ground speed.
- Vertical speed.
- Heading and turn rate.
- Sample interval and sample frequency.
- Flight-state segmentation.
- Data-gap and quality segmentation.
- Focused analytical tests.

---

## Phase 3 — Time-series workspace

**Status:** PARTIAL

### Complete

- Chart presets.
- Time and cumulative-distance axes.
- Extrema-preserving dense-series downsampling.
- Point selection and range brushing.
- Selected-range statistics.

### Remaining

- Multi-chart layouts.
- Synchronized crosshairs.
- Independent Y axes.
- Raw-versus-processed overlays.
- Event and anomaly overlays.
- Histograms, scatter plots, box plots and correlation matrix.
- PNG and SVG export.
- Canvas, uPlot or WebGL renderer evaluation.

---

## Phase 4 — Data-massaging pipeline

**Status:** PARTIAL

### Complete

- Undo and redo.
- Versioned operation and recipe contracts.
- Coordinate swap.
- Invalid-point removal.
- Deduplication.
- Decimation and simplification.
- Moving-average smoothing.
- Time and elevation offsets.
- Elevation-outlier removal.
- Derived-channel operation.
- Fixed-rate linear and step resampling.
- Gap-aware resampling.
- Selection-scoped safe transforms.

### Remaining

- Before-and-after previews.
- Impact summaries.
- Median, Hampel and Savitzky–Golay filters.
- Exponential moving average.
- Butterworth filters.
- Rolling statistics.
- Derivative and integral operations.
- Distance-based resampling.
- Monotone cubic interpolation.
- Timestamp de-jitter and clock-drift correction.
- Saved transform presets and recipe UI.

---

## Phase 5 — Workers and large-data architecture

**Status:** PARTIAL

### Complete

- Typed compute protocol.
- Worker host and browser client.
- Production Worker entrypoint.
- Progress reporting and cancellation.
- Worker-based fixed-rate resampling.
- Worker-based dense chart preparation.

### Remaining

- Transferable typed-array or columnar data representation.
- Worker pool and task scheduling.
- Worker-based large-range statistics.
- Progressive import.
- Memory budgets and telemetry.
- Benchmarks at 100k, 500k and 1M points.

---

## Phase 6 — Multi-dataset comparison

**Status:** PARTIAL

### Complete

- Multiple loaded datasets.
- Reference and target selection.
- Nearest-time alignment.
- Manual time offset.
- Relative local-ENU analytics.
- Slant range, horizontal range, bearing, vertical separation and closure rate.
- Closest-approach summary.
- Aligned-sample table.

### Remaining

- Interpolated alignment.
- Cross-correlation and event-based alignment.
- Clock-drift estimation.
- Along-track and cross-track error.
- Residual charts.
- More than two simultaneous comparison tracks.
- Comparison report export.

---

## Phase 7 — Local 3D trajectory workspace

**Status:** PARTIAL

### Complete

- WGS84 to ECEF to local ENU conversion.
- Bounded source-index-preserving geometry.
- Perspective and orthographic projection.
- Orbit, pan and zoom controls.
- Camera reset and fit controls.
- Point picking synchronized with other views.
- Channel-based trajectory coloring.
- Selected-range highlighting.
- Start, end, selected and playback markers.
- Playback timeline and speed controls.
- Playback follow mode.
- Ground grid.
- Vertical curtain.
- Altitude exaggeration.
- Auto rotation.

### Remaining

- Multi-track rendering.
- Separation vectors and closest-approach visualization.
- Chase camera.
- Time-accurate playback using timestamps.
- Camera-state persistence in project archives.
- 3D screenshot export.
- Optional WebGL/Three.js renderer if Canvas performance becomes insufficient.

---

## Phase 8 — GPU map and globe

**Status:** READY

### Complete

- Leaflet map with bounded point rendering.
- Channel coloring.
- Linked point and range selection.
- Fit-all and fit-range controls.

### Remaining

- deck.gl GPU path and point layers.
- Optional Cesium globe.
- Multi-track visibility and styling.
- Selection-aware map playback.
- Map screenshot export.

---

## Phase 9 — Format expansion

**Status:** PARTIAL

### Complete imports

- CSV and TSV.
- GPX.
- GeoJSON.
- KML.
- NMEA.
- GPB.

### Remaining priority formats

- Apache Arrow.
- Parquet.
- CZML.
- KMZ.
- IGC.
- FIT and TCX.
- MAVLink telemetry logs.
- ADS-B layouts.
- SQLite.

Each format requires representative and malformed fixtures, metadata mapping, explicit unit behavior, size limits and round-trip tests where applicable.

---

## Phase 10 — Projects, reproducibility and reports

**Status:** PARTIAL

### Complete

- Versioned project manifest.
- Compressed `.jddc-project` archives.
- Embedded datasets.
- Dataset fingerprint verification.
- Undo and redo history persistence.
- Active dataset and tab persistence.
- Point and range selection persistence.
- Archive safety limits.

### Remaining

- Project schema migrations.
- Captured operation recipes.
- Bookmarks and annotations.
- Chart layouts.
- Map and 3D camera state.
- Multi-dataset alignment settings.
- HTML analysis report.
- PDF-ready report output.
- Chart, map and 3D images in reports.

---

## Phase 11 — Extensibility boundaries

**Status:** DONE

### Complete

- Compile-time parser contracts.
- Exporter contracts.
- Operation contracts.
- Derivation contracts.
- Chart-preset contracts.
- Report-section contracts.
- Atomic plugin registry.

Runtime third-party code discovery remains intentionally excluded until a secure sandbox and signing model are defined.

---

## Phase 12 — Release and security hardening

**Status:** ACTIVE

### Complete

- Production dependency audit.
- Full dependency audit reporting.
- SBOM generation.
- Release checksums.
- Semgrep static analysis.
- Malformed input fixtures.
- Project archive limits.
- CI artifacts and audit reports.

### Remaining

- Windows signing.
- macOS signing and notarization.
- Electron fuse review.
- Parser fuzz testing.
- Decompression-bomb protections for future archive formats.
- Build provenance attestations.
- Crash-report export.
- Packaged-binary smoke tests on each platform.

---

## Current priority sequence

1. Validate linked map, table and enhanced 3D behavior.
2. Implement shared hover cursor and timestamp-accurate playback.
3. Add transform previews and the next filter family.
4. Introduce transferable columnar Worker payloads.
5. Add multi-chart layouts and statistical charts.
6. Expand multi-dataset visualization and reports.
7. Add project migrations, recipe capture and bookmarks.
8. Complete signing, fuzzing and provenance hardening.

## Definition of done

A task is complete only when its implementation is reachable, tested, documented, validated by CI and free of known blocking defects. Partial foundations are recorded as PARTIAL rather than DONE.
