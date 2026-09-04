# JDDC Roadmap

This document outlines the planned development direction for Joint Domain Data Compiler. Features
are organized by phase and priority. This is a full rewrite: nothing unfinished from the previous
version was dropped — every open item below either shipped this session (marked `[x]`, with what
changed) or was carried forward (marked `[ ]`, with its original reasoning preserved plus any new
scoping found while surveying the codebase). ~20 items are genuinely new, found by an explicit
audit of parsers, exporters, accessibility, settings, tests, desktop integration, and data-quality
checks; the rest are carryover, which is why the total list is longer than that — nothing was
trimmed to hit a number.

**Current Release:** v0.4.0
**Latest Stable:** v0.4.0

---

## Shipped in 0.4.0

- [x] **Comparison results reach the HTML report (part 1 of 2)** — `buildComparisonSection` and
  `ReportComparisonSummary` had existed in `htmlReport.ts` since the report was built, but no
  caller ever passed a `comparison` field, so every exported report claimed comparison results
  were "not yet captured in report export" no matter what the Comparison tab showed. The report
  export now **re-derives** the comparison from the persisted `workspace.comparison` settings
  rather than reading a live result out of the tab. That choice matters: it needs no new props
  (`ProjectPanel` already receives `datasets`, `activeId`, and the whole `workspace`), it cannot
  go stale, and it populates the section even when the Comparison tab was never opened this
  session — verified by a dedicated e2e case that exports a report without ever clicking Compare.
  Three functions moved into a new `core/analytics/comparisonSummary.ts` —
  `resolveComparisonDatasetIds`, `computeComparisonSamples`, `summarizeComparisonRanges` — and
  `ComparisonPanel` now calls the same three, so the tab and the report cannot disagree about the
  numbers or about *which pair* is being compared. Deliberately **not** extracted: along/cross-track,
  the clock-drift estimate, and the closest-approach sample, none of which the report shows and one
  of which (`estimateClockDrift`) exists only to fill a UI row.
  Three states are kept distinct rather than collapsed, because the report's wording depends on
  which one it is: no comparison configured at all returns `undefined` (the honest "not captured"
  placeholder); a blocked or failed comparison returns both dataset names plus the error, since
  the section renders it as "{reference} vs {target}: {error}" and would otherwise read "vs : …";
  and a configured comparison that simply aligned nothing returns `sampleCount: 0` with the range
  fields absent, rendering "Unavailable" rows instead of falsely claiming no comparison exists.
  `summarizeComparisonRanges` reduces rather than spreading into `Math.min(...ranges)` — the report
  path applies no sample cap, and a long comparison would have overflowed the argument limit
  (covered by a 200k-sample check). Verified three ways: 43 new checks in
  `test/comparison-summary.ts`, and two live Playwright cases in
  `test/e2e/comparison-report.spec.ts` that export a real report and assert the section carries a
  populated numeric "Mean range" row rather than a table of "Unavailable".
  **Part 2 — the stats helper (median/p95/stddev) and binned histogram — remains open below.**
- [x] **Unit-system preference (metric / knots+feet)** — Settings → Display units switches every
  distance, altitude, and speed *readout* between metric (m/km, m/s) and aviation/marine
  (ft/NM, kn). Done in the order this roadmap specified: `PointVisualizerPanel.tsx`'s duplicate
  local `formatDistance` was collapsed into the shared one **first**, as its own step, before any
  unit parameter existed.
  A new pure `core/units.ts` holds the type, the conversion factors, and the three formatters.
  `core/` does not import `state/settings.ts`: the choice is passed in as an argument, so the
  formatters stay pure functions Node can test without a `window`. None of them takes a default
  unit argument — a call site that forgets to pass the preference is a compile error rather than a
  readout that silently stays metric while the rest of its view converts, which is exactly the
  half-converted failure this item was flagged for. Factors are written as their defining ratios
  (`0.3048`, `1852`, `1852 / 3600`) rather than rounded decimals (`3.28084`, `1.94384`), so the
  conversion can be checked against the definition; `test/units.ts` (49 checks) pins both forms,
  every unit-switch boundary, and the non-finite fallbacks.
  Converted: `StatsPanel`, `TrackMetricsPanel`, `PointVisualizerPanel`, `ComparisonPanel` (metric
  cards, closest-approach line, and the 250-row sample table, whose column headers now carry the
  active unit so the cells can stay bare numbers), `MapView`'s point tooltip, and
  `TimeSeriesChart`'s window readout.
  Deliberately **not** converted, each for a stated reason: `ext` channel values and the unit
  labels inferred from their key suffixes (`_mps`, `_deg`, `Hz`) — an arbitrary channel is not
  metres and converting one would corrupt it; operation *inputs* such as the map's density cell
  size (converting an input means bidirectional parsing, a different problem from a readout); and
  bearings, sample rates, and time deltas, which have no unit-system dimension.
  The HTML analysis report also stays canonical SI **by decision**: it is exported evidence that
  leaves the machine, and GPX/EAG/GPB exports are already canonical. The Settings copy states this
  outright rather than leaving it to be discovered. *Unit-aware report export* is left open below.
  One display change fell out of collapsing the duplicate formatter: the Point Inspector's
  inter-point distance now switches to km/NM at one whole unit (was 10 km) and renders at the
  shared precision. Caught immediately by the existing jsdom check asserting `300 m` — which is
  why `formatAltitude`/`formatSpeed` treat their precision argument as a *ceiling*, not a fixed
  width, so a round 300 m does not become "300.000 m".
  Verified live end to end: with the preference set to nautical, an elevation of 121.4 m reads
  398.294 ft, an inter-point leg reads 383.5 ft at 22.72 kn, and the Compare tab's headers read
  "Slant ft" / "Closure kn" — while bearing stayed in degrees and Δt in seconds.
- [x] **e2e coverage for the Track Health repair flow** — the second concrete slice of "e2e coverage
  gaps" below, and the highest-value one because 0.3.0 rewrote that engine (reconstruct-in-place
  through the shared `trackReconstruction.ts`). Track Health's remediation button is the only UI
  entry to it; unit tests cover the engine, but nothing covered scan → repair → accept-or-revert →
  rescan as one flow. `test/e2e/track-health-repair.spec.ts` drives exactly that, and asserts the
  properties that matter rather than that a click happened: **Revert** leaves the score and the
  failing check untouched (the dialog is a gate, not a progress notice), **Accept** flips the
  outlier check from fail to pass and raises the score, the track still has **all 40 points**
  afterwards (proving points were refit in place, not deleted), and Track Metrics' point
  accounting reports 6 **interpolated** points where it reported none before — a refitted sample
  stays countable and distinguishable from a recorded one (non-negotiable #1).
  Needed a new fixture: the flow only appears when the outlier check actually *fails*, which needs
  more than `maxFlaggedFraction` (5%) of evaluated points flagged, and no real-capture fixture in
  the corpus trips that. `test/fixtures/outlier-spikes.csv` is a smooth 40-sample eastbound leg
  with three ~200 m lateral position spikes, documented as synthetic in the fixture README.

- [x] **In-app user guide** — Built from a separate implementation plan rather than this roadmap,
  recorded here because it is durable work. `public/user-guide.html` is a self-contained,
  theme-aware manual covering every tab, control, and gesture, with worked examples and a
  troubleshooting section, written from the new `FEATURE_INVENTORY.md`. It is opened by a **?**
  button in the app header and on the Settings tab; in Electron the main process resolves the
  packaged path itself and opens it through `shell.openPath`, so the renderer can never name an
  arbitrary file to open. Nothing is fetched at runtime — no CDN fonts, scripts, or images — so it
  renders identically from `file://` inside the packaged app with no network, which is asserted
  rather than assumed.
  The 20 screenshots are captured by `npm run guide:screenshots` against
  `test/fixtures/demo-flight-a.csv`/`-b.csv`, a **synthetic** flight pair generated by
  `npm run fixtures:demo-flight`. Synthetic by necessity, not convenience: the screenshots are
  committed to a public repository *and* packaged into every release binary, and the flight-test
  CSV the original plan named for this purpose is excluded by a deliberate root-anchored
  `.gitignore` rule. Positions are integrated from a commanded heading/speed/vertical-rate profile
  rather than drawn as a shape, so the Track Health checks see a physically consistent flight —
  both tracks score 100/100. Phase transitions are smoothed over a 25-second window because an
  airframe rolls into a change over seconds; stepping the commanded profile at a phase boundary put
  a real discontinuity into the path, which the outlier detector flagged correctly, making a
  healthy fixture look defective. The map basemap is set to the offline grid for the capture, which
  keeps it independent of the network and keeps third-party map imagery out of a redistributed
  document.
- [x] **Accessible names for every control** — A concrete slice of the *WCAG 2.1 AA compliance* item
  below. Audited by walking the live accessibility tree on all 13 tabs rather than grepping for
  `aria-label`, which cannot tell that a control is already named by a wrapping `<label>`, its own
  text, or `aria-labelledby` — nor that one named only by a `placeholder` is *not* named, since a
  placeholder is not an accessible name and vanishes once the field has a value. Found four gaps
  (Table row filter, bookmark label, Fusion source priorities, project file picker) and fixed them.
  The audit is now `test/e2e/accessible-names.spec.ts`, so a control added without a name fails a
  test instead of being noticed later.

---

## Shipped in 0.3.0

- [x] **Y-axis zoom and pan** — the last open item of the "editable graph view" build order (see
  Phase 1 below), which is now fully shipped. Ctrl/⌘+wheel zooms the Y axis, cursor-anchored the
  same way X already was; ctrl/⌘+shift+wheel pans it. Because `TimeSeriesChart` auto-scales each
  series independently (they can be in unrelated units — elevation in metres beside a turn rate in
  °/s), there is no single Y *value* domain to zoom against. `yZoomDomain` is instead a shared
  `{0,1}` *fraction* of each series' own span, reusing `zoom.ts`'s existing `zoomDomain`/`panDomain`
  unchanged (bounds `{0,1}` instead of the data's own bounds — no new pure-math needed, and the
  existing generic `chart-zoom.ts` tests already cover that math for arbitrary bounds). Axis
  min/max labels now read off the zoomed slice, not the full extent, matching how the X labels
  already behave. Y-zoom (unlike X) doesn't filter the underlying series data before rendering, so
  a zoomed line/point can compute outside the plot rect; added an SVG `clipPath` around the
  line/point geometry to keep it inside the grid instead of bleeding into the axis margins — visible
  proof the feature does something, caught by looking at the actual rendered output, not just
  `tsc`. "Reset zoom" now clears both axes.
- [x] **Per-chart-type rendering fork (partial)** — closes the *known limitation* below for two of
  the three chart types: **Area** now closes the line down to the plot baseline and fills it
  (`fillOpacity: 0.18`); **Scatter** now draws no connecting line at all (points only), matching
  what "scatter" should mean instead of silently rendering as a line chart with a different label.
  A genuine channel-vs-channel scatter (X = another selected channel, not time/index/distance)
  shipped in the same session, right below. Verified two ways: a new jsdom integration check
  (`test/time-series-chart-integration.tsx`) asserts `.chart-line` is literally absent for scatter
  and a `fill-opacity` path is present for area — not just that `.chart-svg` exists — and a live
  Playwright pass confirmed the same visually.
- [x] **Outlier detection: turn-aware floor** — a legitimate sustained turn was scoring as 100% of
  points flagged (residual is large but nearly constant across a turn, so MAD reads it as ~0 local
  scatter). `estimateTurnPositionFloorMeters` (quality/outliers.ts) widens the floor by simulating
  a synthetic arc at the profile's turn-rate ceiling and the track's own fastest observed speed and
  cadence, run through the detector's own window-median math — not a closed-form guess. Verified: a
  30°/s max-rate turn with no injected fault now flags zero points (was 100% before).
- [x] **Drop outliers: reconstruct in place** — flagged points are now refit from surviving
  neighbours through the same plausibility-gated engine Fill gaps uses, instead of deleted and
  left as a hole (the mechanism behind "if you drop them, a new set of incorrect points is
  detected"). `reconstructionKnots`/`fitChannelsAtTimes`/`firstProfileViolation`/
  `collectRealNeighbors` now live in a shared `trackReconstruction.ts`, used by both `fill-gaps`
  and `drop-outliers` — points already marked `interpolated` are skipped as *scoring* candidates
  (`isSynthesized`, quality/outliers.ts) and walked past as *fit knots* in both operations, so a
  repeated Apply doesn't compound its own small fit error into a new flag next to the one it just
  fixed. Domain presets (Aircraft/Ground vehicle/Marine/None (vector-only)) shared between Drop
  outliers and Fill gaps; Aircraft is now the default for both (was Unconstrained). `reconstruct:
  false` still gives plain deletion. Falls back to deletion gracefully (not a thrown error) when a
  track has any untimed point, both in the Transform tab (checkbox disabled with a tooltip) and
  Track Health's remediation button (caption updates to say so).
- [x] **Chart drag-select no longer highlights axis text** — needed both `user-select: none` on
  `.chart-svg` (stops selection *starting* inside the chart) and `event.preventDefault()` on
  `onMouseDown` (stops a drag that starts there from selecting text it passes over) — CSS alone
  was not sufficient.
- [x] **Persist the default motion profile** — `AppSettings.defaultMotionProfile` (new field,
  `state/settings.ts`), validated against `MOTION_PROFILE_IDS` with a normalize-and-clamp fallback
  like the existing numeric budgets; `TransformPanel`'s `outlierProfile`/`motionProfile` state now
  initialize from it instead of a hardcoded `'aircraft'`. New "Transform defaults" group in
  `SettingsPanel.tsx`. Verified live: changed to Marine in Settings, reloaded the page, and the
  Transform tab's two motion-profile selects both opened already set to Marine.
- [x] **Map container `aria-label`** — `.map-canvas-wrap` now carries `role="region"` (not
  `role="img"` — that would have flattened Leaflet's interactive children, hiding the zoom controls
  and popups from assistive tech) and an `aria-label` naming the valid point count and any other
  visible track layers. Verified live: label reads correctly and the Leaflet zoom-in control is
  still present and reachable inside the labeled region.
- [x] **`core/stats.ts` test coverage** — New `test/stats.ts`, 39 checks: point/coord/elevation/time
  counts, elevation gain/loss/min/max, time monotonicity, duplicate-coordinate detection,
  distance/speed/sample-rate derivation, per-channel stats (numeric-string coercion, mean/stddev,
  unit inference), plus `formatDuration`/`formatDistance`.
- [x] **`core/geoInterpolation.ts` test coverage** — New `test/geo-interpolation.ts`, 21 checks:
  `lerp` (basic, extrapolation, degenerate `a === b`) and `lerpLon` (antimeridian-crossing
  eastbound/westbound, non-crossing parity with plain `lerp`, always-wraps-to-`[-180,180]`).
- [x] **Focused tests for `motionProfiles.ts` / `trackReconstruction.ts`** — New
  `test/track-reconstruction.ts`, 32 checks: profile shape sanity, `reconstructionKnots`
  (spline vs. linear knot windows), `collectRealNeighbors` (chronological order, boundary
  clamping, skips already-synthesized points), `angularChannelsOf`, `fitChannelsAtTimes` (linear
  fit, angular wrap-around, `interpolated` provenance flagging), and `firstProfileViolation`
  (speed/vertical-speed/turn-rate ceiling violations, isolated from each other with
  purpose-built geometry so a speed violation can't mask the turn-rate check under test).
- [x] **NMEA VTG sentence support** — `core/parsers/nmea.ts` now parses VTG (course/speed over
  ground) and rides its value onto the next GGA/GLL fix that has none of its own — a GGA+VTG
  receiver with no RMC previously reported positions with no speed/heading channel at all. RMC's
  own speed/heading is deliberately *not* propagated the same way: RMC already emits its own
  point, so copying its reading onto a later GGA fix would attribute a measurement, at a different
  timestamp, that fix never took. Only VTG (which never produces a point of its own) rides along.
  Also added ZDA (date/time) support feeding the same `lastDate` RMC already contributes to, with
  a shared range guard (`isPlausibleDate`: year ≥ 1980, month 1–12, day 1–31) so a malformed ZDA
  can't silently fabricate a date that then times every later fix. New `test/nmea-vtg-zda.ts`, 23
  checks, including one confirming the RMC-does-not-propagate boundary and two for the malformed-
  date guard. GSA/GSV shipped in the same session, right below.
- [x] **GPS fix-quality Track Health check** — New `gpsFixQualityCheck` in `trackHealthChecks.ts`,
  shipped deliberately at `weight: 0` (informational only — never scores, never blocks). A
  *weighted* check would have required rebalancing all five existing check weights to preserve the
  "weighted checks sum to 100" invariant asserted by an existing test; that is a scoring-policy
  decision with wide blast radius, not a side effect of adding a check, so it stays out of scope
  here. Flags points with `hdop` above threshold (default 5) or `sat` below minimum (default 4),
  reports `notApplicable` when a track carries neither field. 9 new checks added to
  `test/track-health.ts`, including two hardcoded check-count assertions that had to be updated
  (6→7 checks) — caught by running the full suite immediately after, not in a batch. Verified live:
  loading an NMEA fixture with `hdop`/`sat` data shows a "GPS Fix Quality" row on the Overview tab.
- [x] **NMEA GSA/GSV sentence support** — `core/parsers/nmea.ts` now parses GSA (PDOP/HDOP/VDOP +
  active satellites) and GSV (satellites in view), riding both onto the next GGA/GLL fix the same
  way VTG does. Two precedence/collision rules, both deliberate: (1) GSA's HDOP only fills in when
  a fix's own HDOP field (GGA) is blank — the fix's own reading always wins, GSA is a fallback, not
  an overwrite; PDOP/VDOP have no GGA equivalent so are unconditional additions. (2) GSV's
  "satellites in view" is stored under a distinct channel key (`sat_in_view`), never `sat` — GGA's
  `sat` is satellites *used in the fix solution*, a different count, and the existing GPS
  fix-quality check (shipped earlier this session) reads `ext.sat` directly, so writing GSV's
  larger in-view count to that same key would have silently defeated the check for any track
  carrying both sentence types. All DOP fields are rejected unless finite and strictly positive
  (`positiveNum`), so a malformed GSA can't enter `ext` as a plausible-looking but meaningless
  reading. New `test/nmea-gsa-gsv.ts`, 18 checks, including one proving GGA's own HDOP beats GSA's
  and one proving `sat`/`sat_in_view` never collide.
- [x] **DataTable keyboard navigation + ARIA** — the Table tab's click/shift-click/ctrl-click
  multi-select-and-delete workflow was mouse-only; it is now fully keyboard-operable. The grid is
  virtualized (only on-screen rows exist in the DOM), which rules out per-row DOM focus — a
  genuinely focused row would lose focus the instant it scrolled out and unmounted. Used the
  `aria-activedescendant` pattern instead: the scroll container is the sole tab stop
  (`role="grid"`, `tabIndex=0`), a `focusedIndex` state tracks the logically active row
  independently of click-selection, and `aria-activedescendant` points at that row's `id` — moving
  focus (Arrow/Home/End/PageUp/PageDown) imperatively scrolls the target row into the rendered
  slice first, so the id it points at always resolves to a real DOM node. A `.kbd-focused` CSS
  outline substitutes for the native focus ring a real `:focus` can't provide here. Enter/Space
  activates the focused row through the exact same `activateRow` function the mouse `onClick`
  handler calls (with the same Shift/Ctrl/⌘ modifier semantics) — one selection code path for both
  input methods, not two that could drift apart. `aria-rowcount`/`aria-colcount`/`aria-rowindex`
  reflect the filtered/sorted row count and each row's position in it, not raw DOM position, so a
  screen reader announces correct row numbers under virtualization. Header cells gained
  `role="columnheader"` and `aria-sort`. Verified live end-to-end on a synthetic 500-point track:
  Arrow/Home/End/PageDown moved the focus ring correctly across virtualization boundaries (`End`
  correctly scrolled to and focused row 499), and Enter / Ctrl+Enter / Shift+Enter correctly
  produced a single selection, a multi-select toggle, and a range extension respectively — matching
  the existing mouse-driven behavior exactly.
- [x] **Real channel-vs-channel scatter** — `ChartXAxis` (`visualization/charts/series.ts`) gained a
  fourth kind, `` `channel:${string}` ``, alongside the existing `time | index | distance` — X = any
  numeric channel's own per-point value, not something derived from position. Deliberately gated to
  `chartType === 'scatter'` only, both in the x-axis `<select>` (the channel options simply aren't
  offered otherwise) and via a hard runtime fallback to `'index'` if the underlying `xAxis` state
  somehow points at a channel while a non-scatter chart type is active — a polyline drawn through
  non-monotonic channel values is a scribble, not a chart, and `extractChartSeries`'s existing
  points-only scatter rendering was already the right shape for this, not new rendering work. The
  fallback is non-mutating (same pattern already used for the hasTime/hasDistance fallbacks): switch
  away from Scatter and a line/area chart renders safely off a fallback axis; switch back and the
  previously-picked channel axis is restored, because the underlying `xAxis` state was only ever
  shadowed, never overwritten. A point missing the chosen x-channel is skipped entirely (already
  correct — the existing `y === null || x === null` guard needed no change once `xValue` could
  return null for a channel), not plotted at a fabricated x of 0. `numericChannelValue` exported
  from `series.ts` so the chart's own `pointX` helper (cursor/selection/range positioning) reuses
  the exact same numeric-channel coercion as series extraction, rather than a second copy that could
  drift. Verified three ways: new `test/chart-series.ts` checks (domain computation over a channel
  axis, x/y pairing, the missing-value skip), a new `test/time-series-chart-integration.tsx`
  scenario (channel option only appears on Scatter, selecting one updates the axis label, switching
  away and back preserves/restores it), and a new live Playwright spec
  (`test/e2e/channel-scatter.spec.ts`) driving the real browser end to end on derived-kinematics
  data (elevation vs. ground_speed_mps).
- [x] **e2e coverage for Settings** — One concrete slice of the "e2e coverage gaps" item below:
  new `test/e2e/settings.spec.ts` covers what no unit test can (`state/settings.ts`'s own tests run
  in Node, with no `window`/`localStorage`) — that the persisted default motion profile and point
  budgets actually survive a real page reload, that the Transform tab's motion-profile pickers
  actually pick up the persisted value on mount, and that "Reset to defaults" restores every field
  including the motion profile. The rest of "e2e coverage gaps" (Track Health's repair flow, Point
  Inspector, the 3D view, non-GPX export formats) remains open.

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
- [ ] **Enrich the comparison report section (part 2 of 2)** — Part 1 shipped this session (see
  *Comparison results reach the HTML report* above): `ProjectPanel`'s report export now passes a
  re-derived `comparison`, so `buildComparisonSection` is live rather than permanently dead code.
  What remains is the originally-scoped enrichment: a stats helper (median/p95/stddev over
  `horizontalRangeM`/`slantRangeM`/`relativeUpM`/`closureRateMps`, same shape as
  `rangeStatistics.ts`) plus a binned-histogram render in `buildComparisonSection`. Small now that
  the wiring exists and `core/analytics/comparisonSummary.ts` is the obvious place to add it —
  `summarizeComparisonRanges` already walks exactly these sample arrays once.
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

- [ ] **PDF report export** — The HTML analysis report has no direct PDF path; browser
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
- **Electron:** Follows 6-month major-version cadence with security patches
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
