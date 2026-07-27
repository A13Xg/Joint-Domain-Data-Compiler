# Joint Domain Data Compiler — Product and Engineering Roadmap

**Plan ID:** `JDDC-ROADMAP-2026-02`  
**Supersedes:** `JDDC-ROADMAP-2026-01`  
**Repository:** `A13Xg/Joint-Domain-Data-Compiler`  
**Active execution plan:** `.hermes/plans/2026-07-26_223300-full-roadmap-execution.md`  
**Authority:** This document is the canonical product and implementation roadmap.

## Product definition

JDDC is a **single-user, local-first trajectory and TSPI engineering workbench** for importing, normalizing, validating, analyzing, correcting, comparing, visualizing, saving and exporting time-space-position-information data.

The primary workflow is:

`Import → Normalize → Inspect quality → Derive/analyze → Select → Transform → Compare/visualize → Save project → Export/report`

All data processing must remain available without a cloud service. Optional online resources, such as the default OpenStreetMap basemap, must be clearly identified and must not prevent local data processing.

## Near-term non-goals

- cloud accounts or collaborative editing;
- real-time telemetry ingest;
- general-purpose GIS editing;
- unrestricted runtime third-party plugins;
- Cesium/globe work before the existing map and 3D workflows are complete;
- broad vendor-format accumulation without representative fixtures and a user need;
- branch protection as an implementation or release requirement.

## Status model

- **COMPLETE** — intended feature scope is wired into the product, tested and accepted.
- **FUNCTIONAL** — a usable product workflow exists, but material correctness, UX, scale or release work remains.
- **FOUNDATION** — tested lower-level capability exists but is not fully wired into the normal product workflow.
- **ACTIVE** — current corrective or implementation focus.
- **PLANNED** — accepted future scope with no complete implementation.
- **DEFERRED** — intentionally outside the current priority sequence.

## Definition of done

A feature is complete only when it is:

1. reachable through the product or a deliberately public API;
2. deterministic and documented;
3. covered by focused automated tests and representative fixtures;
4. validated for malformed and boundary inputs;
5. reflected accurately in README and roadmap documentation;
6. included in the full lint, regression and production-build gate;
7. accompanied by progress/cancellation for genuinely long-running work;
8. free of known blocking correctness defects.

---

# Stage 0 — Correctness, truth and workspace-state stabilization

**Status:** ACTIVE

This stage resolves the correctness findings identified during the 2026-07-26 full project review before additional feature breadth.

## Required work

- Replace process-local sequential dataset IDs with collision-resistant IDs that remain safe after project restore.
- Separate “clear selected point” from “clear all point/range/time/segment state.”
- Preserve the last working tab when saving from the Project tab.
- Centralize durable workspace state for chart, map, 3D and comparison controls.
- Validate every `WorkspaceSelection` field during manifest/archive loading.
- Add decompressed-byte limits before project JSON parsing.
- Preserve or infer semantic channel definitions after transforms and derivations.
- Reconcile altitude references before 3D or relative analysis; visibly block or warn on incompatible/unknown references.
- Reconcile time references before alignment and timestamp-sensitive operations.
- Keep public documentation synchronized with verified product behavior; the 2026-07-26 truth correction is complete.
- Add direct regression coverage for each correction.

## Acceptance target

No known high-priority state, metadata or persistence defect remains, and every public capability claim matches the product exactly.

---

# Stage 1 — Ingestion and normalized data integrity

**Status:** FUNCTIONAL

## Delivered

- CSV/TSV mapping with sample analysis in a Worker.
- DMS, decimal-comma and multiple timestamp representations.
- GPX tracks, routes, waypoints and extension leaves.
- GeoJSON points, LineStrings, MultiLineStrings and geometry collections.
- KML points, LineStrings and `gx:Track`.
- NMEA GGA/RMC/GLL with checksum handling.
- JDDC GPB numeric binary import.
- Normalized `Dataset`/`TrackPoint` model with channel definitions, source metadata, provenance and quality flags.
- User-visible parser warnings.

## Remaining

- Explicit per-format file-size and record-count budgets.
- Progressive full CSV import without retaining both complete row and point representations.
- Content sniffing and mismatch warnings beyond filename extensions.
- Source checksums on import.
- Direct automated parser fixtures for CSV, GPX, KML and NMEA, including malformed cases.
- Strong GPB bounds validation and format revision planning.
- Metadata editor for coordinate, altitude and time references.
- Unit normalization audit for imported extension channels.
- Import summary showing dropped/changed records and source lineage.

## Acceptance target

Every supported input has authoritative valid and malformed fixtures, explicit limits, predictable metadata mapping and a complete import-quality summary.

---

# Stage 2 — Shared selection and synchronized inspection

**Status:** COMPLETE

## Delivered

- Dataset-scoped persistent point selection.
- Transient synchronized data cursor.
- Index-range and time-range selection.
- Segment-to-range selection.
- Chart brushing and point picking.
- Map point/cursor/range rendering and fit-to-range.
- Virtualized table point/cursor/range rendering and range filtering.
- 3D point/cursor/playback/range rendering.
- Selection-scoped statistics and supported transforms.
- Keyboard navigation with arrows, Shift+arrows, Home, End, Enter and Escape.
- Dataset-change stale-state protection.
- Focused state regression tests and independent Phase 1 audit.

## Cross-cutting follow-up

Rendered browser behavior is covered by the future Stage 11 end-to-end test suite rather than reopening this feature stage.

---

# Stage 3 — Analytics, quality and segmentation

**Status:** FUNCTIONAL + FOUNDATION

## Delivered

- Overview statistics and basic quality checks.
- Basic UI transform for cumulative distance, speed and heading.
- Tested versioned standard-kinematics engine for distance, ground speed, vertical speed, heading, turn rate, horizontal acceleration, sample interval and sample frequency.
- Tested flight/data-state segmentation engine.
- Segment selection in the Overview UI using default configuration.
- Quality flags for missing, duplicate and non-monotonic timestamps.

## Remaining

- Wire the versioned standard-kinematics engine into the normal UI and operation history.
- Remove or consolidate the duplicate basic derivation implementation.
- Expose segmentation thresholds and segment summaries in the UI.
- Add gap, spike, flatline, saturation and coordinate-jump detection.
- Add altitude/time-reference-aware analytical guards.
- Add anomaly/event overlays consumable by charts, map and reports.
- Add analysis provenance: engine ID, version, parameters and source hash.

## Acceptance target

All analytical results are produced by versioned operations, carry provenance, respect metadata references and are directly usable in linked views and reports.

---

# Stage 4 — Transform pipeline and reproducibility

**Status:** FUNCTIONAL

## Delivered

- Undo/redo using dataset snapshots.
- Sort, coordinate swap, invalid removal, dedupe, decimation and Douglas–Peucker simplification.
- Moving-average coordinate/elevation smoothing.
- Time and elevation offsets.
- Local elevation-outlier removal.
- Selection-scoped safe transforms.
- Fixed-rate linear/step resampling with gap protection in a Worker.
- Tested versioned operation, recipe, registry, hashing and replay foundations.

## Remaining

- Before/after preview with point-count, bounds, timing and quality impact.
- Operation records attached to dataset history.
- Recipe capture, save, load, replay and compatibility UI.
- Descriptor-driven transform controls and validation.
- Median, Hampel, Savitzky–Golay and exponential moving average filters.
- Butterworth filters after sampling assumptions are explicit.
- Rolling statistics, derivatives and integrals.
- Distance-based resampling and monotone cubic interpolation.
- Timestamp de-jitter, duplicate-time policies and clock-drift correction.
- Memory-efficient history using deltas/checkpoints rather than unlimited complete snapshots.
- Explicit handling of selections after transforms that reorder or remove points.

## Acceptance target

Every mutation is previewable, versioned, reproducible and explainable, with bounded history memory and deterministic recipe replay.

---

# Stage 5 — Time-series and statistical workspace

**Status:** FUNCTIONAL

## Delivered

- One multi-channel SVG time-series surface.
- Time, index and cumulative-distance axes.
- Built-in presets.
- Extrema-preserving source-index-aware downsampling.
- Linked cursor, point selection and range brushing.
- Selected-range readouts and statistics.
- Tested chart-series extraction and an unused Worker task foundation.

## Remaining

- Multi-pane chart layouts.
- Synchronized crosshairs across visible panes.
- Explicit independent/shared Y-axis controls and visible scales for every series.
- Zoom, pan and range reset.
- Raw-versus-processed overlays.
- Segment, gap, anomaly and event overlays.
- Histograms, scatter plots, box plots and correlation matrix.
- PNG and SVG export.
- Persisted chart layouts in projects.
- Move chart preparation to Workers only after payload/benchmark work proves a benefit.
- Evaluate uPlot/Canvas/WebGL using measured datasets rather than replacing SVG preemptively.

## Acceptance target

Users can build, synchronize, save and export trustworthy multi-chart analytical layouts without ambiguous scaling.

---

# Stage 6 — Map and spatial workspace

**Status:** FUNCTIONAL

## Delivered

- Leaflet path and bounded point rendering.
- Channel-based point coloring.
- Point, cursor and selected-range synchronization.
- Fit-all and fit-range controls.
- Tooltips with source values.
- Gap-aware path splitting and an offline/no-basemap grid mode.
- Persistent desktop KML/KMZ library import path for stored overlays/tracks.

## Remaining

- Clearer network status for online basemap failures.
- More comprehensive antimeridian-safe path rendering.
- Multi-track visibility, colors and ordering.
- Timestamp-driven playback synchronized with chart and 3D.
- Segment/anomaly overlays.
- Map image export for reports.
- Optional local tile source/cache configuration for Electron.
- deck.gl evaluation only after benchmarked Leaflet limits are reached.
- Cesium globe remains deferred until a validated globe-specific use case exists.

## Acceptance target

The map remains useful without network access, represents gaps/dateline crossings correctly, and participates in multi-track playback and reporting.

---

# Stage 7 — 3D trajectory workspace

**Status:** FUNCTIONAL

## Delivered

- WGS84/ECEF/local-ENU geometry foundation.
- Software Canvas perspective and orthographic projection.
- Orbit, pan, zoom, reset and fit behavior.
- Source-index-preserving bounded geometry.
- Point picking, cursor, persistent selection and selected-range emphasis.
- Channel coloring, altitude exaggeration, ground grid and vertical curtain.
- Start/end and playback markers.
- Fraction-based playback and speed controls.
- Gap-aware 3D path splitting and top/side camera presets.

## Remaining

- Stable render-loop ownership independent from React effect recreation per playback frame.
- Timestamp-accurate playback and richer gap annotations.
- Follow/chase camera and automatic rotation if still desired.
- Multi-track rendering.
- Separation vectors and closest-approach visualization.
- Persisted camera/render settings in projects.
- 3D image export.
- Altitude-reference compatibility checks and conversion.
- Performance benchmark for 20k, 100k and larger rendered geometry.
- Three.js/WebGL migration only if profiling shows the Canvas renderer cannot meet requirements.

## Acceptance target

3D playback is time-accurate, metadata-correct, multi-track capable, persistable and reportable at validated performance targets.

---

# Stage 8 — Multi-dataset comparison

**Status:** FUNCTIONAL

## Delivered

- Multiple loaded datasets.
- Reference and target selection.
- Nearest-time alignment with tolerance and manual target offset.
- Local-ENU relative position.
- Horizontal/slant range, bearing, vertical separation and closure rate.
- Closest-approach summary and bounded aligned-sample table.

## Remaining

- Reconcile stale selector state when datasets change.
- Interpolated target position at reference times.
- Event and cross-correlation alignment.
- Clock offset and drift estimation.
- Along-track/cross-track error.
- Residual charts and distribution summaries.
- More than two visible comparison tracks.
- Linked comparison selection across chart, map and 3D.
- Separation vectors and closest-approach graphics.
- Saved alignment settings and comparison report export.
- Time/altitude reference compatibility validation.

## Acceptance target

Comparison is metadata-safe, interpolation-aware, visually linked, reproducible and capable of producing an auditable report.

---

# Stage 9 — Projects, bookmarks and reporting

**Status:** FUNCTIONAL

## Delivered

- Versioned project manifest and archive schema v1.
- Self-contained gzip `.jddc-project` archive.
- Embedded datasets and fingerprint verification.
- Undo/redo snapshot persistence.
- Active dataset and basic tab/selection fields.
- Compressed file, dataset and point-count validation.
- Archive round-trip and corruption tests.

## Remaining

- Stage 0 correctness fixes for IDs, view state and decompressed-size limits.
- Project schema migration framework and compatibility tests.
- Persist recipes and operation records.
- Persist chart layouts, map state, 3D camera state and comparison settings.
- Persist time-range/segment semantics rather than only the derived index range.
- Bookmarks, annotations and notes UI.
- Save/open dirty-state indication and recovery behavior.
- Compact history storage and optional history exclusion.
- HTML analysis report with source, metadata, quality, transforms, selections, charts, map and 3D images.
- Print/PDF-ready report styling after HTML reports are stable.

## Acceptance target

A project reopens into the same meaningful analytical workspace across supported schema versions and can generate a complete evidence-backed report.

---

# Stage 10 — Workers, memory and large-data architecture

**Status:** FOUNDATION + one functional Worker operation

## Delivered

- Versioned request/progress/success/failure/cancel protocol.
- Worker host, browser client and production runtime.
- Worker-based fixed-rate resampling.
- Tested chart-series Worker task foundation.
- Bounded chart/map/3D rendering.

## Remaining

- Cooperative task yielding/cancellation and meaningful incremental progress.
- Transferable typed-array or columnar dataset representation.
- Conversion adapters between product `TrackPoint[]` and compute columns.
- Worker-based chart preparation and selected-range statistics where benchmarks justify it.
- Progressive import and export.
- Worker pool/task scheduler with memory budgets.
- Replace spread-based large-array extrema operations.
- Benchmarks at 100k, 500k and 1M points covering import, memory, transforms, charts, comparison, project save/open and export.
- Visible memory/size warnings and graceful refusal thresholds.

## Acceptance target

Defined large datasets complete supported workflows within documented time/memory budgets, with responsive cancellation and no renderer lockups.

---

# Stage 11 — Automated product verification

**Status:** PLANNED

## Delivered

- 20 deterministic Node regression harnesses.
- GPX XSD validation.
- Lint, TypeScript, Vite build, Semgrep, audit, SBOM and focused workflow gates.
- Documented manual fixture corpus.

## Remaining

- Browser component-test framework.
- Playwright end-to-end workflow tests for import, mapping, selection, transforms, Worker resampling, projects and export.
- Automated fixture matrix for every supported parser and exporter.
- Visual smoke tests for chart, map, table and 3D.
- Electron packaged-launch tests on Windows, Linux and macOS.
- Performance regression suite.
- Property-based and fuzz tests for parsers, archive validation and transforms.
- Consolidate redundant focused workflows after equivalent diagnostics exist in the main suite.

## Acceptance target

Critical user workflows and packaged applications are automatically exercised, not inferred solely from core-unit tests and successful compilation.

---

# Stage 12 — Formats and interoperability

**Status:** FUNCTIONAL baseline; expansion planned

## Delivered imports

- CSV/TSV, GPX, GeoJSON, KML, NMEA and GPB.

## Delivered exports

- GPX, CSV, GeoJSON, KML and GPB numeric binary.

## Accuracy notes

- GPB is compact numeric transport, not complete lossless workspace persistence.
- GeoJSON/KML/GPX exports do not preserve every normalized metadata/provenance field.
- Project archives, not GPB, are the current highest-fidelity JDDC persistence format.

## Priority expansion after Stage 10

1. Apache Arrow for columnar interchange and internal architecture alignment.
2. Parquet for analytical storage.
3. CZML or IGC only with a concrete workflow.
4. FIT/TCX for consumer activity data if demand exists.
5. MAVLink, ADS-B or SQLite through explicit profile specifications.

KMZ, HDF5, MAT, NetCDF, LAS/LAZ and vendor binaries remain deferred until a user workflow and representative licensed fixtures exist.

## Acceptance target

A new format is accepted only with authoritative fixtures, malformed cases, explicit units/metadata, size limits and round-trip expectations.

---

# Stage 13 — Extensibility boundaries

**Status:** FOUNDATION; runtime discovery deferred

## Delivered

- Compile-time parser, exporter, operation, derivation, chart-preset and report-section contracts.
- Atomic plugin registry with duplicate validation and rollback behavior.
- Versioned recipe/operation/derivation contracts.
- Focused tests.

## Remaining

- Connect internal registries to the actual application menus and execution paths where this reduces hard-coded duplication.
- Define compatibility/version policy for first-party extensions.
- Do not load third-party runtime code until sandboxing, signing, permissions and support policy exist.

## Acceptance target

First-party capabilities register through one coherent internal extension path. Third-party runtime plugins remain deferred unless a secure product requirement emerges.

---

# Stage 14 — Release, security and operational readiness

**Status:** FUNCTIONAL pipeline; production hardening incomplete

## Delivered

- Browser and Electron builds.
- Windows NSIS and portable targets.
- Linux AppImage and DEB targets.
- macOS DMG and ZIP targets.
- Electron context isolation, sandboxing, disabled Node integration and navigation restrictions.
- CSP.
- Runtime dependency audit and full audit report.
- CycloneDX SBOMs.
- Semgrep production-source analysis.
- Release checksums.
- Tag/version verification and GitHub Release workflow.

## Remaining

- Pin Actions and scanner containers to immutable revisions.
- Windows code signing.
- macOS signing and notarization.
- Electron fuse review.
- Build provenance attestations.
- Packaged-application launch/smoke tests.
- Parser and archive fuzzing.
- Crash/diagnostic bundle export.
- Stable, prerelease and migration policy.
- Release checklist and rollback procedure.

## Acceptance target

Signed, reproducible and automatically smoke-tested packages can be released with traceable provenance, migration guidance and diagnostic support.

---

# Ordered execution plan

## Immediate tranche — correctness before breadth

1. Complete Stage 0 corrections.
2. Establish Stage 11 browser/E2E testing for current critical workflows.
3. Wire standard kinematics and metadata guards from Stage 3.
4. Add transform previews and operation records from Stage 4.

## Product-depth tranche

5. Build Stage 5 multi-chart layouts and explicit axes.
6. Add Stage 7 timestamp-accurate playback and Stage 6 offline map behavior.
7. Add Stage 8 interpolated, visually linked comparison.
8. Build Stage 9 project migrations, durable workspace state and HTML reports.

## Scale and interoperability tranche

9. Implement Stage 10 columnar Worker architecture and benchmarks.
10. Add Arrow/Parquet only after the internal scale architecture is stable.
11. Complete Stage 14 packaged-app verification, signing and provenance.

## Deferred until justified

- Cesium globe;
- unrestricted runtime plugins;
- real-time telemetry;
- cloud collaboration;
- broad vendor-format expansion.
