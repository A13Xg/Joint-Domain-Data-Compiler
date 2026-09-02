# JDDC Roadmap

This document outlines the planned development direction for Joint Domain Data Compiler. Features are organized by phase and priority.

**Current Release:** v0.2.0 (in development)  
**Latest Stable:** v0.1.1

---

## Phase 1: Visualization & UI Polish (Current)

### Visualization Enhancements
- [x] **Settings page** — Modular, expandable settings scaffolding: browser storage on the web
  build, a local config file on desktop. Must take new settings without restructuring.
  `state/settings.ts` is a new, app-scoped store (module-singleton + `useSyncExternalStore`, same
  shape as `state/pointSelection.ts`) — deliberately *not* part of `WorkspaceState`, which is
  project-scoped and travels inside a saved `.jddc` file; a setting should mean the same thing
  regardless of which project is open. Correction to this item's "local config file on desktop"
  half: Electron's renderer process already has a disk-backed `localStorage` that survives
  relaunches, so both builds use that one mechanism rather than adding a second, file-based store
  behind a new IPC channel for no behavioral gain — revisit only if a setting needs to be
  human-editable or shared outside the app. New settings are added by extending `AppSettings` and
  `SETTINGS_LIMITS`; `normalizeSettings` degrades a stale/corrupt persisted value field-by-field
  rather than discarding the whole object, so old settings survive a new field being added. A
  "Settings" tab hosts `SettingsPanel`.
- [x] **Configurable downsampling** — Expose the visualization point budget as a setting. Below
  the budget every point is drawn; at or above it, sample every `length / budget`-th point.
  Applies to every line-chart and point-rendering surface. Correction to this item's "one budget"
  premise (and to the *Window-aware downsampling* item below, which said the same): there were
  always three separate budgets with different orders of magnitude for good reason — a line chart
  hit-tests individual SVG elements, a map and a 3D scene draw to canvas regardless of point count —
  so this ships as `chartPointBudget` / `mapPointBudget` / `scenePointBudget`, one settings group,
  not one shared number that would move the map and 3D renderers as a side effect of tuning the
  chart. Each has its own clamped range in `SETTINGS_LIMITS`. The chart budget is not purely
  cosmetic: it is the same value that gates when the Charts tab's ctrl/shift delete-set gestures
  are available (see *Interactive editable graph view* above) — `SettingsPanel`'s copy says so, so
  a user lowering it understands they're also raising the zoom level needed to build a delete-set.
- [x] **Chart image export** — High-quality PNG/SVG export with annotations preserved.
  `visualization/charts/export.ts`: `serializeChartSvg` clones the live chart SVG and inlines each
  element's *computed* style (cascade + `var(--…)` already resolved by the browser) since the export
  has to be self-contained — a naive `XMLSerializer` output would rely on this app's external
  stylesheet, which isn't there when the file is opened elsewhere. "Annotations preserved" is read
  plainly: whatever is currently painted — series lines, individually-rendered points, quality-event
  markers, axis labels, the selected point/range indicator — exports; only the hover crosshair is
  dropped, since it's meaningless once static. PNG export rasterizes the same serialized SVG onto a
  2x-scaled canvas. Both follow the app's existing download pattern (`DataTable.downloadRows`,
  `ExportPanel.saveBlob`): an object-URL anchor click plus `archiveFile('outputs', …)`.
- [ ] **Multi-pane chart layouts** — Allow side-by-side axis scales and custom channel grouping.
  Skipped this pass: `TimeSeriesChart` is a single-chart component owning its own toolbar, zoom
  state, and (as of *Interactive editable graph view*, above) its gesture map — multi-pane means
  extracting a reusable chart unit and coordinating N independent domains, which is a refactor of
  code just finished, not an increment on top of it. Its own pass.
- [ ] **Statistical plot types** — Histograms, probability plots, Lissajous curves for trajectory
  analysis. Skipped this pass: blocked by a limitation already recorded further down this file
  ("No per-chart-type rendering fork (scatter/area types render as line chart)") — histograms and
  Lissajous curves need that fork to exist before they can render as anything but a line chart.
- [ ] **3D Performance validation** — Benchmark multi-track rendering and optimize geometry
  construction. Skipped this pass: this is "benchmark, then whatever the benchmark says," not a
  boundable feature — the optimization work it's gated on is open-ended by design.
- [ ] **Playback controls refinement** — Timestamp-accurate scrubbing with linked cursor in all
  views. Skipped this pass: scope is unstated beyond that one sentence, and it touches map/3D/chart
  playback surfaces together rather than one at a time.
- [x] **Window-aware downsampling** — *Enabling change; build first.* `TimeSeriesChart` builds its
  series from `[points, selected, effectiveX]` — the visible domain is not a dependency, so the
  whole dataset is reduced to `MAX_RENDERED_SAMPLES` (1,500) once and zooming only remaps those
  same samples onto a narrower range. Zooming never recovers fidelity, so nothing below can work.
  Filter to the visible domain *before* `minMaxDownsample`. Note that `xDomain` is currently
  derived *from* the series, which makes the naive version circular: the full-extent domain must
  be computed once from the raw data, with the windowed series derived from the zoom domain.
  `MAX_RENDERED_SAMPLES` is now the *Configurable downsampling* setting above's `chartPointBudget`
  — see that item for the correction to "one budget" (it's three, one per surface).
- [x] **Interactive editable graph view** — Show the smooth line at any zoom; once the visible
  window holds fewer rows than the point budget, render the individual points and make them
  selectable. Drag-select an area that looks wrong to drill down, repeat until the points appear,
  then correct them there. Today the chart is read-only: it can zoom and it can *report* a
  selection, but fixing a bad sample means leaving for the Transform tab and naming the point by
  index. Analysts find bad points by looking at them, so the fix belongs where the eye already is.
  Extends the existing chart rather than adding a panel, so multi-pane layouts and image export
  inherit it. Points are selectable **only when the visible window is fully rendered**, which makes
  a selection exact by construction — there are no undrawn rows hiding between the ones you see.
  Shipped gesture map (resolves both open questions below): click selects a point (unchanged,
  `PointInspectorPanel` already reads it — this is the "correct them there" step); drag zooms to
  the dragged span at every level, replacing the old drag-to-range-select; ctrl/⌘+click toggles a
  sample into the same `indexSet` the Table builds, shift+click extends it from its anchor, and
  ctrl/⌘+drag adds a whole run — all three gated to "the reference series (`series[0]`) is not
  downsampled," i.e. exact-by-construction, with a screen-pixel proximity cutoff so an off-target
  click can't silently grab a distant sample; shift+wheel (or a trackpad's horizontal swipe) pans
  without changing zoom. `TimeSeriesChart` now takes an `onDeletePoints` prop (the same callback
  `DataTable` uses) and shows its own "set of N" chip and delete button. Surfaced and fixed two
  real, pre-existing bugs along the way: `eventX`'s screen-to-domain mapping used the SVG's
  bounding-rect aspect ratio rather than its screen CTM, silently mis-locating clicks by the
  letterbox margin whenever `.chart-svg`'s `max-height` cap made its rendered aspect ratio diverge
  from the 900:320 viewBox (only became visible once a gesture — the new pixel-cutoff hit test —
  actually depended on click accuracy); and the JSX `onWheel` prop is passive by default, silently
  dropping `preventDefault()` and letting the page scroll under the chart during zoom/pan — replaced
  with a real `{ passive: false }` listener via `useEffect`.
- [x] **Point inspector** — Single-point value editing, and the increment that can ship first: it
  works against the existing single-point selection and needs none of the work above. Fields are
  locked by default; an explicit pencil unlocks them, a warning box confirms intent (first edit per
  dataset, not every edit — the pencil-to-checkmark gesture carries intent thereafter), and a
  checkmark in the pencil's place applies the change. All fields are editable, derived channels
  included.
- [x] **Set-based selection model** — Group select yields an arbitrary, possibly non-contiguous set
  of indices, used for **deletion only**. Both `PointSelectionSnapshot` and `WorkspaceSelection`
  currently carry one `pointIndex` plus one *contiguous* `indexRange`, so this is a shape change to
  persisted workspace state (`restorePointSelection` takes exactly those two), and the selection
  store is a module-level singleton every panel reads — map, 3D, table and charts move together.
  Correction to this item's original premise, twice over. First: the shape change did not touch
  persisted state — `indexSet` lives only in the in-memory `PointSelectionSnapshot`, deliberately
  kept out of `WorkspaceSelection` (a working set for the delete gesture, not durable view state),
  so `restorePointSelection` always starts it fresh, same as `segmentIds`. Second, and narrowing
  "every panel": **Table and Charts** move together — both build the set (Table via ctrl/shift+click
  on rows, Charts via ctrl/shift+click and ctrl+drag on rendered points, both gated to exact
  conditions — Table to natural/unsorted/unfiltered order, Charts to the reference series not being
  downsampled) and both read it through the same `toggleInSet`/`extendSetRange`/`unionSetRange`/
  `clearSet`/`getSelectedIndexSet` primitives. Map and 3D do not build one — nothing in either
  surface names an individual point by rendered position today, so there was no natural gesture to
  wire, and no roadmap item currently calls for one. "Every panel moves together" is narrowed here
  to name the two that actually do, rather than left as a claim the code doesn't back.
- [x] **Selection-scoped delete operation** — `OperationScope` supports `indexRange` and rejects
  `timeRange`; there is no set-of-indices scope, and `runPointPreserving` is by definition
  count-preserving, so delete needs the point-removing path. `operations/drop-outliers.ts` is the
  template: it already narrows removal by scope while detecting over the whole track. Scoped to
  removing a few strays — points that drifted off course or plotted far out. Bulk removal stays in
  the Transform tab and is unchanged. `operations/delete-points.ts` rejects `indexRange`/`timeRange`
  scope and an empty/missing `indexSet`, dedupes and range-checks the indices, and is registered and
  replayable like any other operation. Wired end-to-end from the Table tab. Correction to this item's
  "same gesture as editing" premise: delete uses the existing `useConfirm` destructive-action dialog
  (the same one `TransformPanel` uses elsewhere), not the Point Inspector's pencil-then-checkmark.
- [x] **Manual-edit provenance** — `edit-point` flags every edited point `manual_edit` in
  `PointProvenance.qualityFlags` (no schema change), unioned with whatever flags a point already
  carries. `TrackMetricsPanel` and `PointVisualizerPanel` already read `qualityFlags` generically, so
  the flag surfaces there for free. The HTML report's disclosure section (`includeNotionalDisclosure`,
  now labeled *Data quality disclosure*) was extended to count and disclose manually edited points
  alongside notional ones — it previously special-cased only `notional` and would have stayed silent
  on hand edits otherwise. Correction to this item's original premise: GPB does **not** carry
  provenance (or `name`/`desc`, or non-numeric `ext` values) — it is a numeric-only container by
  design (`core/parsers/gpb.ts`), so it silently drops the flag exactly like GPX and EAG TSPI. Project
  save does carry it, via plain JSON round-tripping of the dataset.
- [x] **Stale derived-channel badge** — A manual edit is truth data and is never silently
  recomputed away, so editing lat/lon leaves `speed_mps`, `distance_m` and friends holding their
  prior values until the user re-runs the derivation. `PointProvenance.staleChannels` names the
  channels a lat/lon/ele/time edit invalidates (on the edited point and the next one, for
  pairwise kinematics); `runDerivation` clears the ids it owns on its next run. `PointInspectorPanel`
  and `PointVisualizerPanel` render an amber "stale" badge next to the affected field. Verifying
  this in the browser surfaced a real, pre-existing bug: the Charts tab's flex layout let the
  chart collapse below its readable minimum whenever the Point Inspector was tall enough to fill
  the viewport, painting the chart's own legend/selection chips over the inspector and blocking
  its "Edit" button entirely. Fixed alongside this item — `.charts-workspace` now sizes to content
  and the tab scrolls, like every other tab.
- [ ] **Y-axis zoom and pan** — `visualization/charts/zoom.ts` now also has `panDomain` (pure,
  clamped, tested in `test/chart-zoom.ts`), and shift+wheel/trackpad-swipe pans that X-domain —
  but still only X. Independent of the editing work now that a move is a typed value rather than a
  drag; the value is in reading a channel whose variation is small against its full extent. Lower
  priority than the items above.

#### Settled decisions — editable graph view
- **A "move" is a typed value, not a drag.** Select a point, unlock, edit named fields. This
  removes the timestamp-vs-value-vs-position ambiguity entirely.
- **Group select deletes; it never edits.** Value manipulation requires a single-point selection.
- **A manual edit is truth data.** Derived channels are *not* auto-recomputed; a hand-edited point
  stays as entered until some later action modifies it. Users own the order of operations, and the
  stale badge exists to support that rather than replace it.
- **Time edits are accepted with a warning; nothing is re-sorted.** There is no practical case for
  an automatic resort, so the capability is skipped entirely: an edited timestamp stays where the
  user put it, and the existing time-order check reports the break like any other. Consistent with
  a manual edit being truth data — the user owns the order of operations. This also means an *edit*
  never reshuffles indices; only deletion does.
- **Drag zooms; the wheel zooms too.** Releasing a drag auto-zooms to the dragged span, and the
  cursor-anchored wheel zoom keeps working at every level, so zoom is never trapped by whatever
  drag currently means. The wheel behaviour already exists (`onWheelZoom`); the change is that drag
  auto-zooms on release instead of only parking a range chip.
- **Rendering already preserves extrema.** `minMaxDownsample` keeps the min and max of every
  bucket, so a one-sample spike survives to full zoom-out. Seeing that a point is off, then zooming
  to it, works with the existing renderer — the gap was window-awareness, not the envelope.
- **Deterministic replay is deferred; recording is not.** Each edit and delete is recorded as an
  explicit operation, because an edit invisible to the history panel and the analysis report is the
  wrong default. Making the operation history recipe-safe stays deferred.
- **Resolved — marquee and pan.** Drag means *zoom* while the reference series is above the point
  budget and *marquee-add-to-delete-set* once it renders individually — the two never apply at the
  same zoom level, matches the drill-down-then-edit workflow, and the wheel still zooms throughout.
  Contiguous range-select (`indexRange`) is *not* revived on a modifier-drag — the settled decision
  above already retired it from the chart in favor of zoom, and Charts stays a consumer of ranges
  (`zoomToSelection('range')`, the range chip) rather than a producer; `handleSelectionKeyboard`'s
  shift+arrow and the Table's row clicks are still how one gets made. Ctrl/⌘ and shift instead mirror
  the Table's own delete-set vocabulary (toggle / extend), so the two surfaces teach one gesture
  language instead of two. Pan is shift+wheel, or a trackpad's native horizontal swipe (`deltaX`) —
  middle-drag and space-drag were the other candidates; wheel-based pan needed no new drag mode and
  so cost nothing against the gestures above.

#### Open questions — editable graph view
- **Index identity, now narrowed to deletion.** `TrackPoint` has no stable id; points are
  identified by array position. Dropping the auto-resort removes the worst case — an edit no longer
  moves any index — so only deletion shifts the rows after it, in the one direction, by a known
  count. A recorded "set field at index N" can still go stale if a delete lands before it. Adding a
  real `id` is the thorough fix and is expensive (every parser, every exporter, the GPB binary
  format); the cheap mitigation is to record each edit alongside a fingerprint of the point's prior
  values, so a stale index is detected and refused rather than silently written to the wrong row.

#### Build order
1. Window-aware downsampling — nothing else functions without it. ✅
2. Point rendering and hit-testing below the budget. ✅
3. Point inspector — independent of 1 and 2; ship early. ✅
4. Set-based selection model. ✅
5. Selection-scoped delete operation. ✅
6. Manual-edit provenance and the stale-channel badge. ✅
7. Y-axis zoom and pan. — last item remaining; X-axis pan (not the Y-axis zoom/pan item's scope) shipped alongside 2.

### Comparison Module
- [x] **Drift estimation** — Clock-skew detection shipped in 0.1.1 (`estimateClockDrift`, surfaced in
  the Comparison panel and exported with the comparison CSV). Automatic *correction* workflows
  remain open.
- [ ] **Multi-track comparison visualization** — Side-by-side trajectory divergence heatmaps
- [ ] **Richer comparison reports** — Statistical tables, divergence histograms in HTML export

### Transform Workflows
- [x] **Recipe UI** — Shipped in 0.1.1: transform sequences can be named, saved, listed, replayed,
  and deleted from the Transform tab. Parameter templating remains open.
- [ ] **Advanced filters** — Kalman smoothing, spline interpolation, cross-track error analysis
- [ ] **Memory-efficient undo** — Compress operation snapshots instead of storing full datasets

---

## Phase 2: Mobile & Accessibility

### Responsive Design
- [ ] **Tablet layouts** — Touch-optimized interface for iPad and Android tablets
- [ ] **Mobile-first MVP** — Essential import, map view, and basic export on phones
- [ ] **Offline-first sync** — Local data persistence with optional cloud backup

### Accessibility
- [ ] **WCAG 2.1 AA compliance** — Full keyboard navigation, screen reader support
- [ ] **Color-blind modes** — Alternative palettes for protanopia, deuteranopia, tritanopia
- [ ] **High-contrast themes** — Explicit dark/light modes with adjustable text size

---

## Phase 3: Collaboration & Cloud

### Multi-User Features
- [ ] **Shared workspaces** — Real-time collaborative analysis with Operational Transformation or CRDTs
- [ ] **Comment annotations** — Bookmark points of interest with discussions
- [ ] **Activity history** — Audit trail with per-user attribution

### Cloud Integration
- [ ] **S3/Azure Blob storage** — Optional cloud backup for large datasets
- [ ] **Dataset versioning** — Git-like history for data provenance and rollback
- [ ] **API & webhooks** — Programmatic access for data ingest and analysis pipelines

---

## Phase 4: Advanced Analysis

### Specialized Workflows
- [ ] **Sensor fusion recipes** — Multi-source alignment templates (GPS + INS + radar)
- [ ] **Uncertainty quantification** — Monte Carlo analysis of coordinate/timestamp confidence
- [ ] **Anomaly detection** — Automated event flagging for unusual behavior patterns
- [ ] **Trajectory classification** — ML-based maneuver recognition (climb, turn, descent, etc.)

### Export & Integration
- [ ] **NetCDF format** — Support for scientific data interchange
- [ ] **PostGIS vector tiles** — Direct database integration for large datasets
- [ ] **REST API** — Headless JDDC instance for batch processing

---

## Known Limitations & Future Improvements

### Visualization
- **Constraint:** No per-chart-type rendering fork (scatter/area types render as line chart)
  - **Timeline:** Phase 1 follow-up
  - **Impact:** Chart validator provides clear feedback; users see expected vs. actual
  
- **Constraint:** ExportPanel GPX preview runs synchronously
  - **Timeline:** Phase 1 (after multi-pane layout)
  - **Impact:** Large datasets may briefly block UI; async worker refactor needed

- **Constraint:** 3D renderer is 2D canvas-based, not WebGL
  - **Timeline:** Phase 2+ (performance assessment first)
  - **Impact:** Keeps dependencies lean; performance limits ~100k points with optimizations

### Data Handling
- **Constraint:** DOM parser capped at 100k points (memory limit)
  - **Timeline:** Stable; larger datasets use GPB or chunked export
  - **Impact:** CSV mapping UI respects limit; clear error messaging

- **Constraint:** Map visual budget ~4,000 points by default (display only)
  - **Timeline:** Stable; full data preserved for export. User-adjustable (500–20,000) since
    *Configurable downsampling* shipped — Settings tab, `mapPointBudget`.
  - **Impact:** Deterministic downsampling preserves statistical correctness

- **Constraint:** GPB export is numeric-only — it drops `name`, `desc`, `provenance`
  (including `qualityFlags`), and coerces any non-numeric `ext` channel to `0`
  - **Timeline:** Phase 4 (archive schema v2, see *Format Support* below)
  - **Impact:** A round-trip through GPB silently loses manual-edit flags, notional flags, and any
    string/boolean passthrough channel. GPX and EAG TSPI are already documented as lossy here for
    the same reason; GPB was not, until this was found while wiring manual-edit provenance.

### Architecture
- **Constraint:** No mobile/tablet responsive design in current scope
  - **Timeline:** Phase 2
  - **Impact:** Desktop-first; web/Electron parity maintained

- **Constraint:** Operation history not yet recipe-safe for deterministic replay
  - **Timeline:** Phase 1 follow-up
  - **Impact:** Undo/redo works via snapshots; export history visible in reports

---

## Generic Bug Fixes

A batch of smaller defects to be fixed together, independent of the feature phases above.

_Items to be outlined — placeholder, not an abandoned section._

- [ ] _(to be filled in)_

---

## Bug Tracker & Issue Triage

Issues are tracked in GitHub with these labels:

- **`bug`** — Incorrect behavior, regressions, or data corruption
- **`enhancement`** — Feature requests or UX improvements
- **`performance`** — Latency, memory, or rendering bottlenecks
- **`security`** — Potential vulnerabilities or unsafe patterns
- **`documentation`** — Docs gaps, inaccurate guides, API clarity
- **`type/*`** — Component area (parser, transform, ui, electron, etc.)

---

## Dependency & Platform Evolution

### Node.js & Runtimes
- **Current minimum:** Node 22 (required by Vite 8, File/Blob/Web Crypto APIs)
- **Electron:** Follows 6-month major-version cadence with security patches
- **Timeline:** Quarterly minor-version bumps; major versions with full test suite

### Format Support
- **CSV/TSV/NMEA 0183** — Core formats, mature parsing (Phase 1 focus: DMS handling edge cases)
- **GPX/GeoJSON** — Full support; Phase 1 focus: schema edge cases and performance
- **KML** — Google `gx:Track` support; Phase 2: network-link handling
- **EAG TSPI** — NATO range instrumentation support (stable; Phase 3: precision improvements)
- **GPB** — JDDC binary format (compact, lossless for coordinates/channels; phase 4: archive schema v2)
- **Future candidates** — NetCDF, HDF5, proprietary military formats (Phase 4)

---

## Release Cadence

- **Patch releases (X.Y.Z+)** — Bug fixes, security patches (every 2-4 weeks as needed)
- **Minor releases (X.Y+)** — New features, UI polish, format support (every 8-12 weeks)
- **Major releases (X+)** — Architecture changes, breaking API changes (annual or less frequently)

Each release includes:
- Full test harness pass (62+ deterministic checks)
- Native platform smoke tests (Linux/Windows/macOS)
- CycloneDX SBOMs and SHA-256 checksums
- GitHub/Sigstore provenance attestations
- Benchmark comparison against baseline (material regressions investigated)

---

## Performance Baselines

Deterministic benchmarks run on synthetic spiral-climb datasets:
- **100k points** — ~200ms build time, <50ms render
- **500k points** — ~1.2s build time, <150ms render (with downsampling)
- **1M points** — ~2.5s build time (baseline; larger datasets route through GPB or chunked export)

Results are recorded and compared at release time; material regressions must be investigated before publication.

---

## Architecture Debt & Tech Debt

### Low Priority (Stable, No Immediate Risk)
- **3D renderer is canvas-based, not WebGL** — Works well for current perf targets; WebGL upgrade deferred pending performance assessment
- **No per-chart-type rendering fork** — Chart validator works around this; minor usability limitation
- **Operation history not yet recipe-safe** — Undo/redo works via snapshots; deterministic replay roadmapped for Phase 1 follow-up

### Medium Priority (Plan Refactor)
- **ExportPanel GPX preview runs synchronously** — Brief UI block on large datasets; async refactor planned for Phase 1
- **Memory-efficient undo** — Compress snapshots instead of storing full datasets; Phase 1 follow-up

### High Priority (Track Carefully)
- **No mobile/tablet responsive design** — Planned Phase 2; test coverage gap until then
- **Cloud infrastructure absent** — Phase 3 milestone; impacts collaboration roadmap

---

## How to Contribute

1. **Report bugs** — Open an issue with reproduction steps and expected vs. actual behavior
2. **Request features** — Describe the workflow, constraints, and why it matters
3. **Optimize performance** — Benchmark before/after, link to baseline data
4. **Improve docs** — PRs for clarity, examples, and API documentation welcome
5. **Write tests** — Unit tests, integration tests, and e2e cases in `test/`

See `ONBOARDING.md` for developer workflow, branch strategy, and CI/CD practices.

---

## Version History

| Version | Release Date | Highlights |
|---------|--------------|-----------|
| 0.1.0   | 2026-08-14   | Initial local-first baseline: import, linked visualization, transforms, project save/export |
| 0.1.1   | 2026-08-26   | HTML analysis reports, Electron packaging with SBOMs and provenance, Track Health Scan, repair/undo workflows, bundled map overlays |
| 0.2.0   | TBD          | Configurable settings, richer comparison reporting, chart image export |
| 1.0.0   | TBD          | Production-ready: mobile support, multi-user collaboration, advanced analysis |
