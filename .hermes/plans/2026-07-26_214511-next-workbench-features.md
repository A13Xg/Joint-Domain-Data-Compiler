# Next Workbench Features Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Extend JDDC from a capable single-track inspector into a trustworthy multi-source trajectory workbench with explicit data quality, connected map/table/3D views, and non-destructive derived-track workflows.

**Architecture:** Keep raw imported datasets immutable. Add pure, source-index-preserving core modules for quality events, source comparison, candidate grouping, and derived tracks before wiring them into React state and linked visualizations. Persist user-visible view configuration and derived-track provenance in the existing project archive only after it has stable tests.

**Tech Stack:** React 19, TypeScript 6, Leaflet/react-leaflet, Canvas 2D local-ENU 3D renderer, Electron IPC, existing Node/esbuild test harnesses, GitHub Actions Quality Gates and Release Build.

---

## Current context

- The canonical roadmap is `docs/IMPLEMENTATION_ROADMAP.md`.
- `npm ci`, lint, the full 20-harness test suite, web build, and Windows desktop packaging currently pass locally.
- `KML-KMZ/` and the Electron KML/KMZ library are now available. Stored files import as normal datasets.
- Map and 3D views currently operate on the active dataset only. Raw multi-source data is not yet visually composited or fused.
- The next work must not alter raw imported point arrays. Every generated/smoothed/fused result must retain explicit source/derivation provenance.

## Non-goals for this tranche

- No cloud account, collaboration, or server persistence.
- No unverified Cesium/Three.js migration.
- No automatic publication of derived data as observed truth.
- No arbitrary map brush selection in the first manual fusion release; interval selection is the MVP interaction.

---

## Phase 1 — Quality events, gap semantics, and shared overlays

### Task 1: Define quality event contracts

**Objective:** Create a reusable, serializable event model for gaps, duplicates, coordinate jumps, spikes, and flatlines.

**Files:**
- Create: `src/core/quality/events.ts`
- Create: `test/quality-events.ts`
- Modify: `src/core/model.ts`

**Steps:**
1. Add `QualityEvent` with stable `id`, `kind`, `severity`, source index/time bounds, explanation, and optional measurements.
2. Add a pure `detectQualityEvents(points, config)` API.
3. Write failing tests for a timestamp gap, duplicate timestamp, coordinate jump, and untimed-track fallback.
4. Implement the minimum detection logic with validated thresholds.
5. Run `npm test` and verify the new harness is automatically included.

### Task 2: Add quality-event presentation helpers

**Objective:** Provide view-safe event lookup and range filtering without duplicating detection logic in UI components.

**Files:**
- Create: `src/core/quality/eventSelectors.ts`
- Test: `test/quality-events.ts`

**Steps:**
1. Add helpers for event overlap with index range/time range and deterministic sorting.
2. Test inclusive boundary behavior and unknown-time events.
3. Keep helpers pure and source-index based.

### Task 3: Show quality events in the Overview and table

**Objective:** Make detected issues reviewable from existing data workflows.

**Files:**
- Modify: `src/ui/StatsPanel.tsx`
- Modify: `src/ui/DataTable.tsx`
- Modify: `src/analysis.css`

**Steps:**
1. Add a bounded quality-event summary with severity counts.
2. Add table filtering for flagged rows and a jump-to-event action.
3. Ensure a selected event synchronizes to the existing point/range selection store.
4. Test lint/build and manually inspect empty-data behavior.

### Task 4: Render gaps and quality events in map and 3D

**Objective:** Use the shared event model to visibly explain broken trajectory segments.

**Files:**
- Modify: `src/ui/MapView.tsx`
- Modify: `src/ui/Trajectory3dPanel.tsx`
- Modify: `src/visualization/scene3d/trajectory.ts`

**Steps:**
1. Replace ad hoc gap-only splitting with the shared gap events where available.
2. Render explicit gap markers/labels in map and 3D.
3. Draw coordinate-jump warnings without connecting a misleading segment.
4. Add focused tests for gap segmentation and preserve existing 3D geometry tests.

**Validation:** `npm run lint && npm test && npm run build`.

---

## Phase 2 — Multi-source visual workspace

### Task 5: Create multi-dataset display state

**Objective:** Let users choose which source datasets are visible, their colors, ordering, and opacity without mutating datasets.

**Files:**
- Create: `src/state/workspaceDisplay.ts`
- Create: `test/workspace-display.ts`
- Modify: `src/App.tsx`
- Modify: `src/persistence/project/manifest.ts`
- Modify: `src/persistence/project/archive.ts`

**Steps:**
1. Define per-dataset display settings keyed by dataset ID.
2. Use deterministic fallback colors and validation for restored state.
3. Test add/remove/restore behavior and stale-ID cleanup.
4. Persist settings into a backward-compatible manifest schema revision or migration path.

### Task 6: Build a Sources panel

**Objective:** Give users one place to toggle visibility, rename a display label, set color/opacity, and identify raw versus derived tracks.

**Files:**
- Create: `src/ui/SourcesPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`

**Steps:**
1. Add a Sources tab or coordinated sidebar section.
2. Display parser, point count, source file, quality count, and derived/raw status.
3. Make source toggles immediately affect map and 3D only—not underlying data.
4. Ensure keyboard and screen-reader labels are present.

### Task 7: Render multiple tracks on the map

**Objective:** Replace active-dataset-only map rendering with color-coded multi-track rendering.

**Files:**
- Modify: `src/ui/MapView.tsx`
- Create: `src/visualization/map/trackLayers.ts`
- Create: `test/map-track-layers.ts`

**Steps:**
1. Extract path segmentation/color selection to pure map-layer helpers.
2. Render visible sources in ordering order while preserving active-track selection behavior.
3. Fit all visible tracks and provide a single-track focus control.
4. Keep KML/KMZ library datasets visually distinguishable.

### Task 8: Render multiple tracks in 3D

**Objective:** Add a local shared-origin multi-track scene with safe altitude/time-reference guards.

**Files:**
- Modify: `src/ui/Trajectory3dPanel.tsx`
- Modify: `src/visualization/scene3d/trajectory.ts`
- Create: `src/visualization/scene3d/multiTrack.ts`
- Create: `test/multi-track-3d.ts`

**Steps:**
1. Define a common ENU origin from the active/reference track.
2. Render visible tracks with source colors and per-track point limits.
3. Block or warn for incompatible altitude/time references rather than silently comparing them.
4. Add legend, source visibility controls, and active/hovered emphasis.
5. Benchmark 20k and 100k point scenarios before considering a WebGL rewrite.

**Validation:** verify project save/open restores view configuration; run `npm test` and `npm run build`.

---

## Phase 3 — Candidate grouping and Auto-Combine MVP

### Task 9: Add fusion-domain data contracts

**Objective:** Model entities, source registrations, candidate groups, decisions, and point provenance without making platform categorization mandatory.

**Files:**
- Create: `src/core/fusion/model.ts`
- Create: `test/fusion-model.ts`
- Modify: `src/core/model.ts`

**Steps:**
1. Define domain-neutral `Entity` fields: display name, optional callsign, optional platform type, and notes.
2. Define source registration and candidate-group records using timestamps/spatial windows.
3. Define fused-point provenance recording chosen source, skipped candidates, reason, and confidence.
4. Test validation and serialization invariants.

### Task 10: Implement source scoring and candidate grouping

**Objective:** Deterministically rank real source points at comparable time/space locations.

**Files:**
- Create: `src/core/fusion/grouping.ts`
- Create: `src/core/fusion/scoring.ts`
- Create: `test/fusion-grouping.ts`

**Steps:**
1. Group candidate points by configurable time tolerance and geospatial proximity.
2. Score source candidates using explicit values such as accuracy/HDOP/satellite count, timing consistency, gaps, and manual source priority.
3. Never fabricate a point in the MVP; choose the best real point or leave a documented gap.
4. Test ties, missing quality channels, mismatched time references, and deterministic output.

### Task 11: Implement Auto-Combine and its audit report

**Objective:** Produce a new derived fused track plus complete per-point decision details.

**Files:**
- Create: `src/core/fusion/autoCombine.ts`
- Create: `src/core/fusion/report.ts`
- Create: `test/fusion-auto-combine.ts`

**Steps:**
1. Consume registered sources and candidate groups.
2. Produce a derived dataset/track with source provenance in metadata and point extensions.
3. Record every skipped candidate with timestamp, source, reason, and score summary.
4. Test raw source immutability, output order, gap handling, and report completeness.

### Task 12: Build timeline interval selection and override controls

**Objective:** Let users force or reject source selection over snapped candidate-group intervals.

**Files:**
- Create: `src/ui/FusionPanel.tsx`
- Create: `src/ui/FusionTimeline.tsx`
- Modify: `src/App.tsx`
- Modify: `src/ui/TimeSeriesChart.tsx`
- Modify: `src/persistence/project/archive.ts`

**Steps:**
1. Display source colors, candidate groups, quality events, and auto-combine decisions on a shared timeline.
2. Allow source selection by timeline interval; snap start/end to candidate group boundaries.
3. Persist manual overrides; rerunning Auto-Combine must preserve them unless reset.
4. Show point-level skipped/selected explanations in an inspectable table.

### Task 13: Export policy for fused tracks

**Objective:** Keep raw sources viewable while exporting only the selected derived/fused track by default.

**Files:**
- Modify: `src/ui/ExportPanel.tsx`
- Modify: `src/core/exporters/index.ts`
- Create: `test/fusion-export.ts`

**Steps:**
1. Make export target explicit: active raw, fused, or another derived track.
2. Default the fusion workspace to fused-track export only.
3. Include a human-readable provenance/audit report export.
4. Require a warning acknowledgement for exports containing derived/notional points.

---

## Phase 4 — Non-destructive notional smoothing

### Task 14: Build physics-aware gap-fill derivation

**Objective:** Create a separate derived track that inserts clearly marked notional points across qualifying gaps.

**Files:**
- Create: `src/core/derivations/notionalSmoothing.ts`
- Create: `test/notional-smoothing.ts`
- Modify: `src/core/model.ts`

**Steps:**
1. Accept adjustable gap threshold; default to gaps greater than 3 seconds.
2. Use the neighboring median observed sample interval as default output cadence.
3. Interpolate only where prerequisites are known and report when a gap cannot be safely derived.
4. Mark every inserted point `derived`, `notional`, and `gapFilled` in provenance/extensions.
5. Create a new track under the same entity with `_notionalSmoothed` appended to the track name.

### Task 15: Add the Derive/Smooth UX

**Objective:** Let users preview parameters and create a non-destructive derived track.

**Files:**
- Create: `src/ui/NotionalSmoothingPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/ui/Trajectory3dPanel.tsx`
- Modify: `src/ui/MapView.tsx`

**Steps:**
1. Show proposed gap count, inserted-point count, and affected time ranges before creating output.
2. Visually distinguish observed versus notional points in map, table, and 3D.
3. Carry all source/entity display properties into the derived track.
4. Add export acknowledgment for any notional point.

---

## Release and validation plan

For every completed task or tightly coupled slice:

```bash
npm run lint
npm test
npm run build
```

Before merging a substantial visualization or fusion slice:

```bash
npm ci
npm run lint
npm test
npm run build
npm run build:desktop:win
```

GitHub Actions now run the consolidated Quality Gates workflow and a three-platform Release Build on every push to `main`. A version tag (`v*`) additionally publishes the verified release bundle.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Fusion may imply certainty that source data does not support. | Preserve raw sources, provenance, scores, and skipped-point reasons; default to selecting real points only. |
| Large datasets overload Leaflet/Canvas. | Keep bounded render limits, pure decimation helpers, and measured performance gates. |
| Different altitude/time references yield misleading comparisons. | Add explicit compatibility guards before multi-track/fusion operations. |
| Project archives grow unbounded with histories/derived data. | Add limits, migration support, and later delta/checkpoint history before broad persistence expansion. |
| Notional smoothing could be mistaken for observed telemetry. | Use distinct visual styling, metadata flags, derived names, and an export acknowledgement. |

## Definition of done for this feature set

- Users can retain, inspect, color-code, and compare multiple raw sources in map/table/3D views.
- Auto-Combine outputs one auditable fused track selected from real points, with a full decision report.
- Timeline interval overrides are persisted and deterministic.
- Notional smoothing creates a separate clearly marked derived track under the same entity.
- Project save/open preserves view/source/fusion state safely.
- Every core operation has focused tests; full lint, test, web build, and Windows desktop package gates pass.
