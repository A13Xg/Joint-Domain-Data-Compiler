# JDDC Roadmap

This document outlines the planned development direction for Joint Domain Data Compiler. Features are organized by phase and priority.

**Current Release:** v0.2.0 (in development)  
**Latest Stable:** v0.1.1

---

## Phase 1: Visualization & UI Polish (Current)

### Visualization Enhancements
- [ ] **Settings page** — Modular, expandable settings scaffolding: browser storage on the web
  build, a local config file on desktop. Must take new settings without restructuring.
- [ ] **Configurable downsampling** — Expose the visualization point budget as a setting. Below
  the budget every point is drawn; at or above it, sample every `length / budget`-th point.
  Applies to every line-chart and point-rendering surface.
- [ ] **Multi-pane chart layouts** — Allow side-by-side axis scales and custom channel grouping
- [ ] **Statistical plot types** — Histograms, probability plots, Lissajous curves for trajectory analysis
- [ ] **Chart image export** — High-quality PNG/SVG export with annotations preserved
- [ ] **3D Performance validation** — Benchmark multi-track rendering and optimize geometry construction
- [ ] **Playback controls refinement** — Timestamp-accurate scrubbing with linked cursor in all views
- [x] **Window-aware downsampling** — *Enabling change; build first.* `TimeSeriesChart` builds its
  series from `[points, selected, effectiveX]` — the visible domain is not a dependency, so the
  whole dataset is reduced to `MAX_RENDERED_SAMPLES` (1,500) once and zooming only remaps those
  same samples onto a narrower range. Zooming never recovers fidelity, so nothing below can work.
  Filter to the visible domain *before* `minMaxDownsample`. Note that `xDomain` is currently
  derived *from* the series, which makes the naive version circular: the full-extent domain must
  be computed once from the raw data, with the windowed series derived from the zoom domain.
  Folds `MAX_RENDERED_SAMPLES` into the *Configurable downsampling* setting above — one budget,
  two consumers.
- [ ] **Interactive editable graph view** — Show the smooth line at any zoom; once the visible
  window holds fewer rows than the point budget, render the individual points and make them
  selectable. Drag-select an area that looks wrong to drill down, repeat until the points appear,
  then correct them there. Today the chart is read-only: it can zoom and it can *report* a
  selection, but fixing a bad sample means leaving for the Transform tab and naming the point by
  index. Analysts find bad points by looking at them, so the fix belongs where the eye already is.
  Extends the existing chart rather than adding a panel, so multi-pane layouts and image export
  inherit it. Points are selectable **only when the visible window is fully rendered**, which makes
  a selection exact by construction — there are no undrawn rows hiding between the ones you see.
- [x] **Point inspector** — Single-point value editing, and the increment that can ship first: it
  works against the existing single-point selection and needs none of the work above. Fields are
  locked by default; an explicit pencil unlocks them, a warning box confirms intent (first edit per
  dataset, not every edit — the pencil-to-checkmark gesture carries intent thereafter), and a
  checkmark in the pencil's place applies the change. All fields are editable, derived channels
  included.
- [ ] **Set-based selection model** — Group select yields an arbitrary, possibly non-contiguous set
  of indices, used for **deletion only**. Both `PointSelectionSnapshot` and `WorkspaceSelection`
  currently carry one `pointIndex` plus one *contiguous* `indexRange`, so this is a shape change to
  persisted workspace state (`restorePointSelection` takes exactly those two), and the selection
  store is a module-level singleton every panel reads — map, 3D, table and charts move together.
- [ ] **Selection-scoped delete operation** — `OperationScope` supports `indexRange` and rejects
  `timeRange`; there is no set-of-indices scope, and `runPointPreserving` is by definition
  count-preserving, so delete needs the point-removing path. `operations/drop-outliers.ts` is the
  template: it already narrows removal by scope while detecting over the whole track. Scoped to
  removing a few strays — points that drifted off course or plotted far out. Bulk removal stays in
  the Transform tab and is unchanged. Delete gets the same unlock-then-confirm gesture as editing,
  being the more destructive of the two.
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
- [ ] **Stale derived-channel badge** — A manual edit is truth data and is never silently
  recomputed away, so editing lat/lon leaves `speed_mps`, `distance_m` and friends holding their
  prior values until the user re-runs the derivation. Flag those channels as stale rather than
  recomputing, so a chart of a derived channel does not look as though the edit did nothing.
- [ ] **Y-axis zoom and pan** — `visualization/charts/zoom.ts` is pure X-domain math (`zoomDomain`,
  `isFullyZoomedOut`) with no pan. Independent of the editing work now that a move is a typed value
  rather than a drag; the value is in reading a channel whose variation is small against its full
  extent. Lower priority than the items above.

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

#### Open questions — editable graph view
- **What drags a marquee, and what pans?** Drag is now zoom, which leaves group-select-for-delete
  without a gesture. Proposed: drag means *zoom* while the window is above the point budget and
  *marquee-select* once individual points are rendered — the two never apply at the same zoom
  level, it matches the drill-down-then-edit workflow, and the wheel still zooms throughout, so
  nothing is lost. Panning still has no gesture at all; middle-drag or space-drag are the
  candidates. Both to be confirmed.
- **Index identity, now narrowed to deletion.** `TrackPoint` has no stable id; points are
  identified by array position. Dropping the auto-resort removes the worst case — an edit no longer
  moves any index — so only deletion shifts the rows after it, in the one direction, by a known
  count. A recorded "set field at index N" can still go stale if a delete lands before it. Adding a
  real `id` is the thorough fix and is expensive (every parser, every exporter, the GPB binary
  format); the cheap mitigation is to record each edit alongside a fingerprint of the point's prior
  values, so a stale index is detected and refused rather than silently written to the wrong row.

#### Build order
1. Window-aware downsampling — nothing else functions without it.
2. Point rendering and hit-testing below the budget.
3. Point inspector — independent of 1 and 2; ship early.
4. Set-based selection model.
5. Selection-scoped delete operation.
6. Manual-edit provenance and the stale-channel badge.
7. Y-axis zoom and pan.

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
- **Constraint:** The Transform tab does not scroll on short viewports
  - **Timeline:** Phase 1
  - **Impact:** Cards below the fold are unreachable at small window heights.

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
- **Constraint:** A CSV import whose rows cannot all be timed succeeds with only a log warning
  - **Timeline:** Phase 1
  - **Impact:** Missing time is not a cosmetic gap — it disables the time axis, playback, and
    every time-based metric. The condition needs a prominent flag in the import surface, not a
    log line that scrolls away.

- **Constraint:** DOM parser capped at 100k points (memory limit)
  - **Timeline:** Stable; larger datasets use GPB or chunked export
  - **Impact:** CSV mapping UI respects limit; clear error messaging

- **Constraint:** Map visual budget ~4,000 points (display only)
  - **Timeline:** Stable; full data preserved for export
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
