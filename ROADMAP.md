# JDDC Roadmap

This document outlines the planned development direction for Joint Domain Data Compiler. Features
are organized by phase and priority. This is a full rewrite: nothing unfinished from the previous
version was dropped — every open item below either shipped this session (marked `[x]`, with what
changed) or was carried forward (marked `[ ]`, with its original reasoning preserved plus any new
scoping found while surveying the codebase). ~20 items are genuinely new, found by an explicit
audit of parsers, exporters, accessibility, settings, tests, desktop integration, and data-quality
checks; the rest are carryover, which is why the total list is longer than that — nothing was
trimmed to hit a number.

**Current Release:** v0.8.0
**Latest Stable:** v0.8.0

---

## Phase 1: Visualization & UI Polish (Current)

### Visualization Enhancements
- [ ] **Multi-pane chart layouts** — Allow side-by-side axis scales and custom channel grouping.
  Still skipped: `TimeSeriesChart` is a single-chart component owning its own toolbar and zoom
  state (now X *and* Y); multi-pane means extracting a reusable chart unit and coordinating N
  independent domains — a refactor of code just extended again this session, not an increment on
  top of it. Its own pass.
- [ ] **Statistical plot types (histograms, Lissajous)** — Was blocked by "no per-chart-type
  rendering fork"; that blocker is now half-cleared (area/scatter shipped above), but a histogram
  or Lissajous curve isn't a styling variant of the existing line/point renderer the way area/scatter
  were — it needs its own binning/pairing logic and axis semantics, not just a different `<path>`.
  Medium-large, own pass.
- [ ] **3D Performance validation** — Benchmark multi-track rendering and optimize geometry
  construction. Still open-ended by design: "benchmark, then whatever the benchmark says."
- [ ] **Playback controls refinement** — Timestamp-accurate scrubbing with linked cursor in all
  views. Scope still unstated beyond that one sentence; touches map/3D/chart playback surfaces
  together.

#### Build order — editable graph view
All seven items shipped; this build order is now complete (Y-axis zoom/pan closed it out this
session). Kept here only as the historical record other roadmap sections cross-reference.
1. Window-aware downsampling ✅
2. Point rendering and hit-testing below the budget ✅
3. Point inspector ✅
4. Set-based selection model ✅
5. Selection-scoped delete operation ✅
6. Manual-edit provenance and the stale-channel badge ✅
7. Y-axis zoom and pan ✅

### Comparison Module
- [ ] **Multi-track comparison visualization** — Side-by-side trajectory divergence heatmaps.

### Transform Workflows
- [ ] **Advanced filters** — Kalman smoothing, spline interpolation, cross-track error analysis.
  Spline interpolation already exists as the fill-gaps/resample engine's core (Fritsch–Carlson
  monotone cubic); a standalone "smooth via spline" transform card may just be a thin wrapper over
  what already ships. Kalman smoothing and cross-track error are genuinely new numerical work.
- [ ] **Memory-efficient undo** — Compress operation snapshots instead of storing full datasets.
  **Scoped, not started — deliberately deferred rather than rushed.** Confirmed: `state/history.ts`
  stores full `Dataset` objects per undo step (real point arrays), capped at
  `MAX_HISTORY_SNAPSHOTS=50`; a 100k-point track (the documented DOM-parser cap) with 50
  undo-tracked operations retains up to ~5,000,000 `TrackPoint` objects for that one dataset alone.
  `repair/diff.ts`'s `PointDiffEntry` is a *classification* structure with no point payload, so it
  cannot reconstruct a prior state on its own — a real delta encoder is new work, not a reuse.
  The real risk: `history.past[0]` is currently load-bearing for `replaySource` (recipe replay's
  hash check), "Restore original," and the archive checkpoint — all three assume a full `Dataset`
  today. A rushed compression scheme here risks silent data loss in undo, which is the one place
  this app cannot afford a bug. Large; needs its own careful pass with those three consumers
  explicitly accounted for before any encoding scheme is chosen.

---

## New: Settings & Preferences

- [x] **Unit-system preference (metric / knots+feet)** — Shipped this session; see *Unit-system
  preference* above for what converts, what deliberately does not, and why the HTML report stays
  canonical SI.
- [ ] **Unit-aware HTML report export** — Follow-up the item above deliberately left out of scope,
  recorded here rather than left implicit. The report currently hardcodes `m` / `m/s` in
  `buildComparisonSection` and the metric tiles, and stays SI regardless of the display
  preference, because it is exported evidence that leaves the machine. Making it follow the
  preference is a real option, not an oversight — it would mean threading a `unitSystem` through
  `ReportOptions` (which is normalized, persisted per project, and surfaced in the export dialog),
  and deciding whether a report's units follow the exporting operator or stay canonical for
  whoever receives it. That is a policy question to settle before sizing, and the report's own
  header should then state which units it used.

## New: Desktop (Electron)

- [ ] **Recent projects list** — **Has a platform-fork the original description missed.** No MRU
  anywhere in `ProjectPanel.tsx`; every session starts from a blank file picker even for a project
  just closed. In Electron, a stored file path can be reopened directly — small-medium, in-app
  list (not necessarily the native menu, which is deliberately absent —
  `Menu.setApplicationMenu(null)`). In the browser build there is no such path: the File System
  Access API's `FileSystemFileHandle` would need to be persisted (IndexedDB, not `localStorage`,
  since handles aren't JSON-serializable) and re-permissioned on reopen, and browsers without that
  API (no path at all — falls back to the blank picker, same as today). This is a design decision
  with a web/Electron parity implication, not an afternoon's work; needs that decision made before
  sizing further, not just "small-medium."

## New: Export

- [x] **PDF report export** — Shipped in 0.7.0 (see above). Original note: the HTML analysis report had no direct PDF path; browser
  print-to-PDF is the only route today. Small if scoped as "a documented print stylesheet," larger
  if scoped as "a bundled PDF renderer" — needs a decision before sizing further.

## New: Testing

- [ ] **e2e coverage gaps** — Two slices closed so far: Settings persistence (0.3.0,
  `test/e2e/settings.spec.ts`, extended this session to cover the unit preference) and the Track
  Health repair flow (this session, `test/e2e/track-health-repair.spec.ts`). The comparison →
  HTML report path also gained live coverage (`test/e2e/comparison-report.spec.ts`). Still no e2e
  for the Point Inspector, the 3D view, or non-GPX export formats. Medium; keep picking one flow
  at a time rather than writing one large spec.

  Note on wiring: `check:e2e` still runs only `ci-smoke` + `workbench-smoke`. The specs added
  since (settings, comparison-report, track-health-repair) run under `npm run test:e2e`, which
  runs everything. That split is the existing convention, not an oversight — but if the intent is
  for CI to gate on these, `check:e2e` needs widening, which is a CI-runtime decision.

---

## Phase 2: Mobile & Accessibility

### Responsive Design
- [ ] **Tablet layouts** — Touch-optimized interface for iPad and Android tablets
- [ ] **Mobile-first MVP** — Essential import, map view, and basic export on phones
- [ ] **Offline-first sync** — Local data persistence with optional cloud backup

### Accessibility
- [ ] **WCAG 2.1 AA compliance** — Full keyboard navigation, screen reader support. Three concrete
  slices have shipped: *DataTable keyboard navigation + ARIA* and *Map container aria-label* (0.3.0),
  and *Accessible names for every control* (above), which is now guarded by an e2e check. What
  remains is the rest of a genuine audit — colour contrast ratios, focus-visible styling, heading
  hierarchy, live-region announcements for async results, and reduced-motion support.
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
- **Constraint:** ExportPanel GPX preview runs synchronously
  - **Timeline:** Phase 1 (after multi-pane layout)
  - **Impact:** Large datasets may briefly block UI; async worker refactor needed

- **Constraint:** 3D renderer is 2D canvas-based, not WebGL
  - **Timeline:** Phase 2+ (performance assessment first)
  - **Impact:** Keeps dependencies lean; performance limits ~100k points with optimizations

- **Constraint:** Enabling the report's comparison section runs the alignment synchronously
  - **Timeline:** Phase 1, alongside the ExportPanel async worker refactor above
  - **Impact:** Ticking "Cross-dataset comparison analytics" re-derives the comparison inside the
    export click handler, so two long tracks can briefly block the UI at export time. Same shape
    as the GPX-preview constraint above; the work is skipped entirely when the section is off.

### Data Handling
- **Constraint:** DOM parser capped at 100k points (memory limit)
  - **Timeline:** Stable; larger datasets use GPB or chunked export
  - **Impact:** CSV mapping UI respects limit; clear error messaging

- **Constraint:** Map visual budget ~4,000 points by default (display only)
  - **Timeline:** Stable; full data preserved for export. User-adjustable (500–20,000) via Settings.
  - **Impact:** Deterministic downsampling preserves statistical correctness

- **Constraint:** GPB export is numeric-only — it drops `name`, `desc`, `provenance`
  (including `qualityFlags`), and coerces any non-numeric `ext` channel to `0`
  - **Timeline:** Phase 4 (archive schema v2, see *Format Support* below)
  - **Impact:** A round-trip through GPB silently loses manual-edit flags, notional/interpolated
    flags, and any string/boolean passthrough channel. GPX and EAG TSPI are already documented as
    lossy here for the same reason.

### Architecture
- **Constraint:** No mobile/tablet responsive design in current scope
  - **Timeline:** Phase 2
  - **Impact:** Desktop-first; web/Electron parity maintained

- **Constraint:** Operation history not yet recipe-safe for deterministic replay
  - **Timeline:** Phase 1 follow-up
  - **Impact:** Undo/redo works via snapshots; export history visible in reports

- **Constraint:** Undo/redo retains full dataset snapshots, not compressed deltas
  - **Timeline:** Phase 1 follow-up, deliberately deferred (see *Memory-efficient undo* above for
    why — three consumers assume a full `Dataset` at `history.past[0]`)
  - **Impact:** Memory scales with (snapshot count) × (point count); bounded today only by the
    50-snapshot cap, not by data size

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
- **Electron:** Follows 6-month major-version cadence with security patches (currently 42.10.x;
  Electron 42.10 declares `engines.node >=22`, matching our minimum)
- **Timeline:** Quarterly minor-version bumps; major versions with full test suite

### Format Support
- **CSV/TSV/NMEA 0183** — Core formats, mature parsing; VTG/ZDA and GSA/GSV sentence support both
  shipped this session (Phase 1 focus: DMS handling edge cases)
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
- Full test harness pass (85+ deterministic checks)
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
- **Operation history not yet recipe-safe** — Undo/redo works via snapshots; deterministic replay roadmapped for Phase 1 follow-up

### Medium Priority (Plan Refactor)
- **ExportPanel GPX preview runs synchronously** — Brief UI block on large datasets; async refactor planned for Phase 1
- **Memory-efficient undo** — Compress snapshots instead of storing full datasets; deliberately
  deferred this session pending careful handling of `history.past[0]`'s three dependent consumers
  (see *Memory-efficient undo* above)

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
| 0.1.12  | 2026-08-27   | Fixed the non-starting packaged Windows/macOS builds (asar integrity), automatic Actions-run housekeeping |
| 0.2.0   | 2026-09-02   | IRIG/range-time parsing, stale derived-channel badge, point deletion from Table/Charts, a Settings tab, chart image export, CSV-no-timestamp warning |
| 0.3.0   | 2026-09-04   | Configurable settings (incl. persisted default motion profile), Y-axis zoom/pan (closes the editable-graph-view build order), area/scatter and real channel-vs-channel scatter chart rendering, turn-aware outlier detection with in-place reconstruction, unified fill-gaps/drop-outliers repair engine, NMEA VTG/ZDA/GSA/GSV support, GPS fix-quality Track Health check, map accessibility label, DataTable keyboard navigation + ARIA, expanded test coverage (`stats.ts`, `geoInterpolation.ts`, motion-profile reconstruction, NMEA sentence parsing, Settings e2e) |
| 0.4.0   | 2026-09-04   | In-app illustrated user guide and feature inventory, unit-system preference (metric / knots+feet) across every readout, cross-dataset comparison wired into the HTML report, accessible names for every control, e2e coverage for the Track Health repair flow |
| 1.0.0   | TBD          | Production-ready: mobile support, multi-user collaboration, advanced analysis |
