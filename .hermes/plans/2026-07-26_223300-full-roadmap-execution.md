# JDDC Full Roadmap Execution Plan

> **For Hermes:** Execute one tranche at a time with strict RED → GREEN → refactor cycles. Keep a single writer in this checkout, preserve unrelated user changes, and do not commit or push unless explicitly requested.

**Goal:** Turn Joint Domain Data Compiler into a reliable local-first, multi-source TSPI workbench with metadata-safe analytics, durable project state, complete linked visualization, reproducible transforms/fusion, scalable processing, and verifiable Electron releases—without claiming or shipping features that have not been exercised.

**Architecture:** Complete correctness and persistence contracts before adding breadth. Keep source tracks immutable; represent visibility, operations, quality, comparisons, fused tracks, and notional output as explicit state/provenance rather than hidden mutation. Build pure, typed core modules first, attach them to one durable workspace state model, then expose them in map/chart/table/3D UI with linked selection and project persistence.

**Tech Stack:** TypeScript 6, React 19, Vite 8, Electron 42, electron-builder 26, Leaflet/react-leaflet, Canvas 2D local-ENU 3D, browser Workers, Node/esbuild regression harnesses, GitHub Actions.

---

## Baseline and audit (2026-07-26)

### Repository state

- Branch/head: `main` at `3271fb2`.
- Canonical roadmap: `docs/IMPLEMENTATION_ROADMAP.md`.
- Prior focused feature plan `.hermes/plans/2026-07-26_214511-next-workbench-features.md` (Phases 1-4: quality events, multi-source display, fusion, notional smoothing) has been superseded and folded into Tranches 4-6 below; it has been removed to keep one active plan.
- **Pre-existing uncommitted WIP:** `src/core/quality/events.ts`, `test/quality-events.ts`, and `src/ui/StatsPanel.tsx`. It adds an event core and overview summary; the initial focused test, lint, full regression suite, and build passed before this plan was written. Treat it as **partial** until its table/map/3D integration and final clean-tree gate are complete.
- Current app remains functional for single active-dataset map/chart/table/3D workflows, project archive v1, basic transforms, comparison, KML/KMZ desktop library, and desktop packaging.

### Requirements classified by implementation status

| Area | Status | Execution treatment |
| --- | --- | --- |
| Linked active-dataset selection | Implemented and verified | Preserve while replacing state boundaries; cover regressions. |
| Quality event core | Partial, uncommitted | Finish one end-to-end vertical slice before dependent visual work. |
| Stage 0 IDs, selection semantics, durable workspace, metadata guards, archive limits | Completed and locally verified | Tranche 1 delivered; retain regression coverage. |
| Parser limits/fixtures/checksums/metadata editor | Functional ingestion, missing integrity hardening | Follow immediately after Stage 0 contracts. |
| Analytics/transform provenance and preview | Foundation/partial | Wire existing versioned engines instead of creating duplicate algorithms. |
| Map/3D/compare experience | Functional single-track | Build shared multi-source workspace only after metadata guards. |
| Fusion and notional output | Planned | Implement only after multi-source state, quality events, and references are durable. |
| Worker scale architecture | Foundation | Benchmark before replacing `TrackPoint[]` or rendering libraries. |
| Browser/Electron E2E | Missing | Establish before broad high-risk UI/persistence changes. |
| Dependency/Electron-builder maintenance | Functional but high-risk dev dependency chain | Controlled upgrades and release parity tests; do not use forced audit downgrades. |
| Cloud, collaboration, real-time ingest, unrestricted plugins, Cesium | Deferred | Explicitly out of this plan. |

### Global rules

1. **Raw datasets are immutable.** A transform, derivation, fused track, or smoother must create a new output or versioned operation record; it cannot overwrite source provenance.
2. **Reference metadata is authoritative.** Unknown/incompatible altitude or time references must block sensitive 3D/comparison/fusion operations or present a clear, testable warning—not silently compare values.
3. **Evidence before completion.** A plan checkbox is not proof. Every task needs a focused test and tranche gate output after its final edit.
4. **No silent audit workaround.** Keep runtime audit at zero high/critical. Resolve Electron-builder dev-chain findings through a tested upgrade/pinning decision, not `npm audit fix --force`.
5. **One writer, stable verification.** Do not run final tests while other processes edit the checkout. Re-run affected gates after any change.
6. **Controlled schema evolution.** Archive/manifest versions require migration adapters, corruption tests, compatibility fixtures, and documented upgrade behavior.

---

# Tranche 0 — Stabilize current WIP and establish execution baseline

### Task 0.1: Record a fresh, reproducible baseline

**Objective:** Capture the actual starting state without overwriting the existing quality-event WIP.

**Files:**
- Inspect: `package.json`, `package-lock.json`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Inspect: `docs/IMPLEMENTATION_ROADMAP.md` (the 2026-07-26 project review that originally informed Stage 0 has since been folded into the roadmap and removed)
- Do not modify product files in this task.

**Steps:**
1. Record branch, HEAD, upstream, dirty paths, Node/npm versions, and current workflow count.
2. Run `npm ci`, `npm run lint`, `npm test`, `npm run build`, and `npm run build:desktop:win` on the stable tree.
3. Run `npm audit --omit=dev --audit-level=high`; separately record dev-only audit findings.
4. Confirm the published GitHub workflow definitions parse as YAML and artifact patterns match electron-builder output.

**Acceptance:** Baseline evidence distinguishes runtime security from development packaging debt and records all pre-existing user work.

### Task 0.2: Complete or revert the current quality-event WIP as one vertical feature

**Objective:** Avoid carrying an ambiguous partial feature into state/persistence work.

**Files:**
- Keep/finish: `src/core/quality/events.ts`, `test/quality-events.ts`, `src/ui/StatsPanel.tsx`
- Modify: `src/ui/DataTable.tsx`, `src/ui/MapView.tsx`, `src/ui/Trajectory3dPanel.tsx`, `src/analysis.css`, `src/index.css`
- Test: `test/quality-events.ts`, `test/trajectory-3d.ts`

**Steps:**
1. Extend the existing test first for time-range selection, event-to-source-index mapping, invalid threshold rejection, and dateline-safe jump behavior.
2. Split selectors into `src/core/quality/eventSelectors.ts` only if a second consumer needs them; do not create an empty abstraction.
3. Add a flagged-rows filter and event jump action to `DataTable`; reuse `usePointSelection` rather than creating a second selection mechanism.
4. Replace duplicated gap logic in map/3D only after pure helpers have focused tests. Render gap/jump markers with labels/shapes in addition to color.
5. Preserve behavior for untimed tracks and invalid points; do not connect misleading segments.

**Validation:** focused esbuild harness, `npm run lint`, `npm test`, `npm run build`.

---

# Tranche 1 — Stage 0 correctness, IDs, references, and durable workspace contracts

> **Completed 2026-07-26:** collision-safe IDs, explicit selection clearing, controlled/persisted map/3D/comparison workspace controls, compatibility guards, bounded archive decoding, and metadata inference all passed the Tranche 1 gate.

### Task 1.1: Replace process-local dataset IDs

**Objective:** Make IDs collision-resistant across reloads, restores, multi-file import, and Electron/browser sessions.

**Files:**
- Modify: `src/core/parsers/index.ts:44-82`
- Create: `src/core/ids.ts`
- Modify: `src/persistence/project/archive.ts`, `src/persistence/project/manifest.ts`
- Test: `test/dataset-ids.ts`, `test/project-archive.ts`, `test/project-manifest.ts`

**Steps:**
1. Write a failing test that imports, restores an archive containing an existing ID, then imports again without collision.
2. Add a browser/Electron-safe ID generator using `crypto.randomUUID()` with a constrained fallback only when unavailable.
3. Validate archive IDs as non-empty and unique; preserve pre-existing archived IDs unchanged.
4. Update import/restore paths to reject duplicate runtime insertion rather than silently overwriting histories.

**Acceptance:** IDs do not depend on process-local sequencing and duplicate datasets cannot corrupt `datasets` or `histories`.

### Task 1.2: Separate point clearing from range/state clearing

**Objective:** Fix selection semantics without regressing keyboard navigation or linked views.

**Files:**
- Modify: `src/state/pointSelection.ts`, `src/core/selection.ts`
- Modify: `src/ui/DataTable.tsx`, `src/ui/StatsPanel.tsx`, `src/ui/MapView.tsx`, `src/ui/TimeSeriesChart.tsx`, `src/ui/Trajectory3dPanel.tsx`
- Test: `test/linked-selection.ts`, `test/selection.ts`

**Steps:**
1. Add a failing test showing `clearPoint` preserves index/time/segment range and `clearAllSelection` clears all fields.
2. Replace ambiguous UI action names with explicit `clearPointSelection`, `clearRangeSelection`, and `clearAllSelection`.
3. Verify Escape semantics deliberately: either remains global clear or becomes documented dual-stage clear; test the chosen behavior.

### Task 1.3: Introduce typed durable workspace state

**Objective:** Move chart/map/3D/compare controls from unmounted panel-local state into one serializable, validated model.

**Files:**
- Create: `src/state/workspace.ts`, `src/state/workspaceSchema.ts`
- Modify: `src/App.tsx`, `src/ui/TimeSeriesChart.tsx`, `src/ui/MapView.tsx`, `src/ui/Trajectory3dPanel.tsx`, `src/ui/ComparisonPanel.tsx`
- Modify: `src/persistence/project/manifest.ts`, `src/persistence/project/archive.ts`, `src/ui/ProjectPanel.tsx`
- Test: `test/workspace-state.ts`, `test/project-manifest.ts`, `test/project-archive.ts`

**Steps:**
1. Define a minimal typed workspace contract: last non-project tab, chart configuration, map display options, 3D camera/render options, comparison selection, and dataset display settings.
2. Write restore validation tests for missing IDs, invalid numeric limits, unknown tabs, invalid enum values, and stale comparison IDs.
3. Update `App.tsx` to own the state while panels receive controlled props/callbacks; do not rewrite every UI control at once.
4. Make Project save use the last working tab instead of the Project tab, and restore the original workspace safely.

### Task 1.4: Enforce altitude/time compatibility guards

**Objective:** Prevent misleading ENU geometry, playback, comparison, or fusion from incompatible metadata.

**Files:**
- Create: `src/core/metadataCompatibility.ts`
- Modify: `src/core/model.ts`, `src/ui/Trajectory3dPanel.tsx`, `src/ui/ComparisonPanel.tsx`, `src/core/relativeAnalytics.ts`
- Test: `test/metadata-compatibility.ts`, `test/relative-analytics.ts`, `test/trajectory-3d.ts`

**Steps:**
1. Define typed compatibility outcomes (`compatible`, `warning`, `blocked`) for altitude/time references and documented safe defaults.
2. Test MSL/HAE/AGL/PRESSURE/UNKNOWN combinations and UTC/GPS/TAI/LOCAL/UNKNOWN combinations.
3. Surface a non-color-only warning or block before 3D/comparison/fusion computation; preserve single-track browsing.
4. Add a metadata editor only after the guard behavior is covered, with explicit user-confirmed values and provenance.

### Task 1.5: Harden archive decoding and metadata preservation

**Objective:** Bound decompressed payloads and preserve/infer semantic channel definitions after transforms.

**Files:**
- Modify: `src/persistence/project/archive.ts:75-93`, `src/core/transforms.ts`, `src/core/analytics/registry.ts`
- Test: `test/project-archive.ts`, `test/analytics.ts`, `test/rangeTransform.ts`

**Steps:**
1. Add a streaming/reader decompressed-byte limit before JSON decoding; test a gzip expansion bomb fixture or controlled mocked stream.
2. Cap depth/records only where the validation boundary can enforce it deterministically.
3. Update `withPoints` and versioned derivation outputs to preserve retained `ChannelDefinition`s and infer definitions for new channels.
4. Add analysis operation provenance: engine ID, version, parameters, input fingerprint, and generated channel definitions.

**Tranche 1 gate:** `npm run lint && npm test && npm run build && npm run build:desktop:win`.

---

# Tranche 2 — Ingestion integrity and parser evidence

> **Completed 2026-07-27:** all three tasks landed and passed the tranche gate
> (`npm run lint && npm test && npm run build`, plus `npm audit --omit=dev
> --audit-level=high` and a clean Semgrep scan). See commits `6298b77`,
> `0f22f4b`, `1e98364` on `main`.

### Task 2.1: Add source budgets, checksums, and content mismatch warnings — done

**Files:** `src/core/parsers/index.ts`, `src/core/parsers/{limits,contentSignature}.ts` (new), `src/core/checksum.ts` (new), `src/App.tsx`, `src/ui/StatsPanel.tsx`, `test/parser-limits.ts`.

Delivered: per-format byte/point budgets with actionable rejection messages; SHA-256 source
checksums (Web Crypto, no new runtime dependency) recorded in `dataset.metadata.source.checksum`;
content-signature sniffing for GPX/KML/GeoJSON/NMEA/GPB/CSV with a non-blocking mismatch warning;
an "Import summary" block in the Overview tab showing accepted/warning counts, checksum, parser
version, and declared coordinate/altitude/time references.

### Task 2.2: Establish authoritative parser fixtures — done

**Files:** `file-test/` (used instead of the originally-sketched `sampleFiles/`, matching the
fixture directory already established in this repo), `test/parser-fixtures.ts`,
`test/helpers/linkedomShim.ts`.

Delivered: a valid + malformed fixture pair for every supported format (CSV/GPX/KML/GeoJSON/
NMEA/GPB), all built from the same real, licensed 8-event USGS sequence already used by the
existing CSV/GeoJSON/GPX fixtures. `test/parser-fixtures.ts` exercises every parser against both
fixtures and documents the actual malformed-input behavior per format (explanatory warning +
zero points for GPX/KML/NMEA, a hard throw for GeoJSON/GPB). Found and documented a real gap:
papaparse's row-level parse errors aren't surfaced to `buildPointsFromCsvRows`, so a row salvaged
from an unterminated quote is still emitted with corrupted trailing columns — left as a tracked,
documented gap rather than expanding this task's scope.

Known limitation: `linkedom` (the Node DOM shim used to exercise GPX/KML parsing outside a
browser) does not resolve namespaced element names the way a real `DOMParser` does, so the KML
`gx:Track` code path is verified only by manual/browser testing, not by the automated suite.

### Task 2.3: Make CSV import memory-aware before format expansion — done

**Files:** `src/core/parsers/csv.ts`, `src/App.tsx`, `test/csv-import-limits.ts`,
`test/helpers/nodeFileReaderShim.ts`.

Delivered: `streamCsvFileToPoints` maps each row to a `TrackPoint` directly inside papaparse's
chunk callback, so only the point array is held for the life of an import — the prior
`parseCsvFile` (collect all rows) + `buildPointsFromCsvRows` (map all rows) flow held both
representations at once. Added two per-chunk checkpoints: a point-budget abort (reusing Task
2.1's CSV budget) and a user-triggered cancellation wired to a new Cancel button shown during CSV
building. `buildPointsFromCsvRows` is retained for `MappingPanel`'s live sample preview and the
Task 2.2 fixture tests. Benchmarking against real 100k/500k fixtures (per the original step 1)
was not done — deferred to Tranche 8's benchmark harness, which is the plan's designated home for
sized performance measurement.

---

# Tranche 3 — Reproducible analytics, operations, and transforms

> **Completed 2026-07-27:** all three tasks landed and passed the tranche gate
> (lint, full regression suite, build, `npm audit --omit=dev
> --audit-level=high`, clean Semgrep scan). See commits `8e7f71b`, `a9afc34`,
> `cd19fdf` on `main`. Task 3.2 and 3.3 shipped a deliberately scoped-down
> slice of their original step lists; see the notes under each task for
> exactly what was deferred and why.

### Task 3.1: Wire the versioned kinematics engine into the normal workflow — done

**Files:** `src/core/analytics/{registry,bootstrap}.ts`, `src/ui/TransformPanel.tsx`, `src/App.tsx`, `test/analytics.ts`, `test/validate.ts`.

Delivered: `standardKinematicsDerivation` is now registered once from `App.tsx` via a new
`bootstrap.ts` and invoked from the "Derive kinematics" button through `runDerivation`. The
duplicate `deriveKinematics`/`bearing`/`addQualityFlag` in `transforms.ts` were removed after
confirming (by direct code comparison, then by pinning independently-computed distance/heading
values in `test/analytics.ts`) that both used identical haversine/bearing formulas. Users now get
vertical speed, turn rate, acceleration, and sample interval/frequency in addition to the
previous distance/speed/heading, plus per-point quality-flag provenance.

### Task 3.2: Add operation preview and durable recipe/history records — done (scoped)

**Files:** `src/core/recipes/preview.ts` (new), `src/ui/TransformPanel.tsx`, `src/App.tsx`,
`test/operation-preview.ts`.

Delivered: `computeOperationPreview` (pure, before/after point count, bounds, duration,
quality-event, and selected-range impact) gates any transform that would shrink the point count
behind a confirmation dialog; `App.tsx` now builds and retains an `OperationRecord` per applied
transform (dataset fingerprints, timestamp, summary), shown as a collapsible history list in the
Transform tab.

**Deferred to Tranche 7** (the plan's designated home for project-persistence schema work):
persisting operation records/recipes into the project archive/manifest, and a full recipe
save/load/replay UI (`src/ui/ProjectPanel.tsx`, `src/persistence/project/*`, `test/recipes.ts`,
`test/project-archive.ts` were not touched). The underlying recipe executor/replay/fingerprint
primitives already existed pre-Tranche-3 and are unaffected.

### Task 3.3: Expand transforms only behind explicit sampling/metadata rules — done (first tier)

**Files:** `src/core/transforms.ts`, `src/ui/TransformPanel.tsx`, `test/transform-filters.ts`.

Delivered the first item of the plan's priority list: `medianFilterElevation` and
`hampelFilterElevation` (MAD-based outlier replacement rather than removal, preserving point
count, with `hampel_corrected` provenance flags). Both are index-window based, matching the
plan's Butterworth-deferral rationale (no uniform-sampling assumption).

**Deferred**, per the plan's own priority ordering, to a future pass: exponential moving average,
rolling statistics/derivatives/integrals, timestamp de-jitter/clock-drift correction, and
distance-based resampling/monotone interpolation. Butterworth remains deferred as originally
specified.

---

# Tranche 4 — Quality, chart, map, and 3D linked visualization

> **Status 2026-07-27:** Task 4.1 done (scoped). Tasks 4.2 and 4.3 **not started** —
> stopped here at a clean, fully-green checkpoint rather than spreading further
> across an already-large remaining surface (this tranche's remaining two tasks,
> plus all of Tranches 5-9, realistically represent weeks of further work). See
> the session report for the full rationale and recommended next steps.

### Task 4.1: Finish event overlays and configurable segmentation — done (scoped)

**Files:** `src/core/quality/events.ts`, `src/ui/{StatsPanel,TimeSeriesChart}.tsx`, `test/quality-events.ts`.

Delivered: `elevation-spike` (single-sample deviation that reverses on the next sample) and
`elevation-flatline` (a run of bit-identical elevation values ≥ a configurable minimum length)
quality-event kinds, plus event rendering in `TimeSeriesChart.tsx` (the one linked view — of
StatsPanel/DataTable/MapView/Trajectory3dPanel/TimeSeriesChart — that had no quality-event
integration at all), using severity-based dash patterns rather than color alone.

**Deferred:** saturation detection (needs per-channel calibration bounds not present in the
current channel-definition model) and UI-exposed thresholds for the separate flight/data-state
segmentation engine (`src/core/analytics/segments.ts`) — a settings-panel-sized task on its own.

### Task 4.2: Upgrade the chart workspace without misleading scales — not started

**Files:** `src/state/workspace.ts`, `src/ui/TimeSeriesChart.tsx`, `src/visualization/chart/*`, `test/chart-series.ts`, `test/chart-layout.ts`.

**Steps:**
1. Add pane model, visible independent/shared Y axes, crosshairs, zoom/pan/reset, and raw-vs-processed overlays.
2. Persist chart layouts only after pure layout validation is tested.
3. Add histogram/scatter/box/correlation views after shared selection and scale semantics are established.
4. Add SVG/PNG export with source/selection metadata.

### Task 4.3: Complete offline-aware map and time-driven 3D behavior — not started

**Files:** `src/ui/{MapView,Trajectory3dPanel}.tsx`, `src/visualization/{map,scene3d}/*`, `src/state/workspace.ts`, `test/map-track-layers.ts`, `test/trajectory-3d.ts`, `test/playback.ts`.

**Steps:**
1. Show basemap network state and preserve usable offline/no-basemap behavior.
2. Finish antimeridian/gap-safe path helpers and derive markers from shared quality events.
3. Refactor 3D draw-loop ownership so playback does not recreate React effects per frame.
4. Replace fraction-only playback with timestamp-aware playback that synchronizes chart/map/3D and gives gap annotations.
5. Add persisted camera/render state, image exports, and 20k/100k performance measurements before considering WebGL.

---

# Tranche 5 — Multi-source workspace and comparison

> **Status 2026-07-27:** Not started.

### Task 5.1: Add multi-dataset display state and Sources panel

**Files:** `src/state/workspace.ts`, `src/ui/SourcesPanel.tsx`, `src/App.tsx`, `src/persistence/project/{manifest,archive}.ts`, `test/workspace-display.ts`.

**Steps:**
1. Define per-track visibility, color, label, ordering, opacity, raw/derived role, and source quality status.
2. Use deterministic fallback colors; validate restored display entries and strip stale dataset IDs.
3. Add accessible toggles/controls without mutating `Dataset` or raw points.
4. Persist the source workspace model in the migration-capable project schema.

### Task 5.2: Render multiple tracks in map and 3D

**Files:** `src/visualization/map/trackLayers.ts`, `src/visualization/scene3d/multiTrack.ts`, `src/ui/{MapView,Trajectory3dPanel}.tsx`, `test/map-track-layers.ts`, `test/multi-track-3d.ts`.

**Steps:**
1. Use a shared reference origin only after compatibility guards approve it.
2. Keep active-track selection while rendering color-coded visible tracks in order.
3. Provide fit-visible/focus-active controls, legend, source emphasis, and bounded rendering per source.
4. Add separation vectors and closest-approach graphics after multi-track geometry tests pass.

### Task 5.3: Make comparison durable and interpolation-aware

**Files:** `src/core/relativeAnalytics.ts`, `src/ui/ComparisonPanel.tsx`, `src/state/workspace.ts`, `src/persistence/project/*`, `test/relative-analytics.ts`, `test/comparison-workspace.ts`.

**Steps:**
1. Reconcile selectors when datasets disappear/change; test stale-state removal.
2. Add optional interpolation at reference times with clear derived status.
3. Add event/correlation alignment, clock offset/drift estimation, along/cross-track errors, residual distributions, and report export in separate tested operations.
4. Persist comparison settings and link selected comparison samples across all views.

---

# Tranche 6 — Auditable fusion and notional output

> **Status 2026-07-27:** Not started. Depends on Tranche 5's multi-source workspace state.

### Task 6.1: Define entity, source, candidate, and decision contracts

**Files:** `src/core/fusion/model.ts`, `src/core/model.ts`, `test/fusion-model.ts`.

**Steps:**
1. Add entity fields (display name, optional callsign, platform type, description) without ranking/categorization.
2. Define source registrations, candidate groups, source scores, manual interval overrides, and point-level decision provenance.
3. Test validation, serialization, compatibility guards, and raw source immutability.

### Task 6.2: Implement deterministic candidate grouping and source scoring

**Files:** `src/core/fusion/{grouping,scoring}.ts`, `test/fusion-grouping.ts`.

**Steps:**
1. Group candidates by configured time/spatial tolerance and compatible metadata.
2. Score real candidates using known accuracy/HDOP/satellite/timing/gap inputs plus explicit source priority.
3. Make ties deterministic and explainable. Never synthesize a fused point in this MVP.

### Task 6.3: Build Auto-Combine, audit report, and timeline overrides

**Files:** `src/core/fusion/{autoCombine,report}.ts`, `src/ui/{FusionPanel,FusionTimeline}.tsx`, `src/App.tsx`, `src/persistence/project/*`, `test/fusion-auto-combine.ts`.

**Steps:**
1. Output a new fused track while retaining all raw sources visibly color-coded.
2. Record selected/skipped candidates by source/time/reason/score.
3. Add manual interval selection snapped to candidate group boundaries; overrides survive recombination until reset.
4. Default exports to fused output and provide provenance/report export.

### Task 6.4: Add non-destructive notional smoothing

**Files:** `src/core/derivations/notionalSmoothing.ts`, `src/ui/NotionalSmoothingPanel.tsx`, `src/ui/{MapView,Trajectory3dPanel}.tsx`, `test/notional-smoothing.ts`.

**Steps:**
1. Default to gaps greater than 3 seconds and neighboring median observed interval.
2. Create a new `_notionalSmoothed` track under the same entity; never edit source/fused raw points.
3. Label/shape notional samples distinctly and require an acknowledgement before exporting them.

---

# Tranche 7 — Projects, reports, and diagnostics

> **Status 2026-07-27:** Not started. This is the designated home for the recipe/operation-record
> persistence deferred from Task 3.2.

### Task 7.1: Introduce project migration and recovery framework

**Files:** `src/persistence/project/{manifest,archive,migrations}.ts`, `test/project-migrations.ts`, `test/project-archive.ts`, `src/ui/ProjectPanel.tsx`.

**Steps:**
1. Define supported schema versions and pure sequential migrators; reject unknown future versions safely.
2. Add v1 fixture archives plus migration/corruption/round-trip tests.
3. Add dirty-state/recovery messaging and optional compact/excluded history policy.

### Task 7.2: Add bookmarks, annotations, and HTML reports

**Files:** `src/ui/{ProjectPanel,ReportPanel}.tsx`, `src/core/report/*`, `src/persistence/project/*`, `test/report-model.ts`.

**Steps:**
1. Persist bookmarks/notes bound to dataset, time, index, and selection semantics.
2. Generate self-contained HTML analysis reports with metadata, source checksums, quality, transforms, selections, comparison/fusion decisions, and supplied image exports.
3. Add print/PDF styling only after a deterministic HTML report fixture exists.

### Task 7.3: Add local diagnostic bundle export

**Files:** `src/core/diagnostics/*`, `src/ui/ProjectPanel.tsx`, `electron/main.cjs`, `electron/preload.cjs`, `test/diagnostics.ts`.

**Steps:**
1. Export app/version/platform, sanitized configuration, logs, validation summaries, and optional user-selected project metadata.
2. Never include raw data, secrets, or KML library contents by default.
3. Add Electron bridge limits/allow-list tests consistent with existing persistent-library security patterns.

---

# Tranche 8 — Scale architecture and measured interoperability

> **Status 2026-07-27:** Not started. The plan explicitly gates this tranche on benchmark
> evidence before any architectural replacement — not attempted without that evidence.

### Task 8.1: Benchmark before architectural replacement

**Files:** `benchmarks/*`, `scripts/run-benchmarks.mjs`, `docs/performance-baseline.md`, CI workflow additions only after local benchmark is deterministic.

**Steps:**
1. Add reproducible 100k, 500k, and 1M point generators that do not enter normal test fixtures.
2. Measure import, transform, selection, chart preparation, map/3D geometry, comparison, archive save/open, and export time/memory.
3. Establish documented budgets and graceful warning/refusal thresholds.

### Task 8.2: Move proven heavy work to columnar Worker execution

**Files:** `src/core/compute/*`, `src/workers/*`, `src/core/columns/*`, adapters from `TrackPoint[]`, focused Worker tests.

**Steps:**
1. Add cooperative yielding/cancellation and meaningful progress to resampling first.
2. Add typed-array/column adapters and transferables only after round-trip correctness tests.
3. Move chart preparation and selected-range statistics only where benchmarks demonstrate a renderer benefit.
4. Add a worker pool/memory budget only after one multi-task workload proves it necessary.

### Task 8.3: Add Arrow/Parquet only after columnar internal stability

**Files:** new format modules and fixtures; `package.json` only when a tested interchange use case exists.

**Non-goal:** No HDF5, MAT, NetCDF, LAS/LAZ, or vendor binaries without licensed fixtures and concrete workflow requirements.

---

# Tranche 9 — Test automation, dependency maintenance, and release hardening

> **Status 2026-07-27:** Not started. Note for whoever picks this up: Task 9.3's Windows/macOS
> code signing and notarization are structurally blocked without secrets/certificates only the
> repository owner holds — no amount of agent effort substitutes for that.

### Task 9.1: Establish browser and Electron smoke gates

**Files:** `package.json`, `playwright.config.ts`, `test/e2e/*`, `scripts/*`, `.github/workflows/{ci,release}.yml`.

**Steps:**
1. Add Playwright with deterministic local fixtures for import → map/table/chart/3D selection → transform → project save/open → export.
2. Add visual smoke snapshots for core linked views only after stable fonts/viewport and fixtures are configured.
3. Add packaged launch/smoke tests per platform; distinguish skipped signing/notarization from a passing package launch.
4. Add property/fuzz tests for parsers, archive validation, and transforms with bounded input/time budgets.

### Task 9.2: Refactor dependency and Electron-builder maintenance into controlled upgrade lanes

**Files:** `package.json`, `package-lock.json`, `electron/{main,preload}.cjs`, `vite.config.ts`, `scripts/run-tests.mjs`, `.github/workflows/{ci,release}.yml`, `docs/dependency-policy.md`, `test/electron-bridge.ts`.

**Steps:**
1. Separate npm scripts into explicit lanes: `check:unit`, `check:web`, `check:desktop`, `check:e2e`, `check:release`, and `check:all`; make CI call them rather than duplicating opaque shell blocks.
2. Add a dependency policy documenting Node support, patch/minor cadence, major-upgrade branch policy, lockfile discipline, runtime versus build-only audit thresholds, and rollback procedure.
3. Create an Electron integration seam that tests IPC channel names, validation, byte limits, and packaged path behavior without enabling Node in the renderer.
4. Update direct patch/minor dependencies one at a time with a clean install and all applicable gates. Test Electron patch upgrades using a packaged Windows smoke test.
5. Treat electron-builder separately: investigate supported releases/lockfile graph and upgrade only to a release that resolves the known dev-only chain without downgrading from 26 to the audit-suggested incompatible 25.1.8. If no compatible fixed release exists, document the isolated build-time exposure, pin exact version/integrity, and add a review date.
6. Pin GitHub Actions and scanner containers to immutable full commit revisions after verifying their exact behavior; retain update documentation.

### Task 9.3: Release integrity and operational hardening

**Files:** `.github/workflows/release.yml`, `docs/release-checklist.md`, `docs/rollback.md`, Electron config/build field, release smoke scripts.

**Steps:**
1. Add provenance attestations and artifact manifest verification.
2. Add Electron fuse review with a documented expected fuse set and testable packaged configuration.
3. Add optional Windows/macOS signing/notarization hooks that fail closed only when release secrets/config are explicitly enabled.
4. Document stable/prerelease version policy, tag migration checks, rollback steps, and user-facing release verification.

---

## Deferred scope removed from active execution

These remain deliberate backlog items, not hidden promises in the current task list:

- Cesium/globe and deck.gl/Three.js migrations before benchmark evidence;
- unrestricted runtime third-party plugins;
- cloud accounts, collaboration, hosted telemetry, real-time ingest;
- broad format expansion beyond Arrow/Parquet without a representative fixture and user workflow;
- automatic altitude conversion without a verified geoid/reference conversion policy.

## Global test/verification contract

For each production task:

1. Write the smallest focused failing Node/browser test first.
2. Run it and confirm it fails for the missing behavior.
3. Implement the minimal production change.
4. Re-run that focused test; then lint/typecheck the affected surface.
5. At every tranche boundary, with no writers active:

```bash
npm ci
npm run lint
npm test
npm run build
npm run build:desktop:win
```

For tranches that introduce Playwright/Electron gates, also run their explicit scripts and report skips separately from passes. For any workflow/release change, parse YAML locally and verify actual artifact paths before calling the pipeline complete.

## Plan completion criteria

The plan is complete only when the following are true with fresh evidence:

- Stage 0 high-priority state/metadata/archive correctness defects are closed.
- Each supported source can be imported with explicit limits, fixture coverage, lineage, and useful diagnostics.
- Mutations, analytics, comparisons, fusion, and notional output are versioned, metadata-safe, non-destructive, and auditable.
- Map/chart/table/3D are durable, synchronized, accessible enough to communicate non-color states, and support verified multi-source workflows.
- Projects reopen meaningful workspace state across supported schema versions and generate evidence-backed reports.
- Scale decisions are benchmarked rather than assumed.
- Browser, packaged desktop, and release artifacts are automatically exercised; dependencies and Electron-builder have a documented, tested update path.
