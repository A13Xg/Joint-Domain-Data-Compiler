# Changelog

Notable user-facing and operational changes are recorded here. This project follows Semantic
Versioning; release tags use the `vX.Y.Z` form.

## Unreleased

### Added

- **Release info popup** — a small version button beside the header's **?** help button opens a
  dialog listing the app version, the key libraries JDDC is built on, "A13Xg Industries"
  copyright attribution, and a disclaimer that the app is for notional data only.
- **Automated patch versioning** — a git pre-commit hook (`githooks/pre-commit`, wired up by
  `npm run prepare`) auto-increments `package.json`'s patch version on every commit. A manual
  minor/major bump is detected by a new CI job (`ci.yml`'s `auto-tag-release`), which tags `main`
  as `v<version>` to start the existing tag-triggered release workflow — so a release still never
  builds on an ordinary push, only on a deliberate version bump or a manual workflow run.
- **CodeQL security scanning** (`.github/workflows/codeql.yml`) — static analysis of the
  TypeScript/JavaScript source on every push/PR to `main` and a weekly schedule.
- **Dependency Review** (`.github/workflows/dependency-review.yml`) — flags dependencies a PR
  adds or changes that carry a known high-severity vulnerability, alongside the existing
  `npm audit` gate in Quality Gates.
- **`.nvmrc` and `package.json#engines`** — pin the expected Node.js version (22) so tools like
  `nvm use` and `npm install` warn on a mismatch instead of failing confusingly later.

### Changed

- **Dependency roundup** — folded ten Dependabot PRs into one: Electron 42.9.0 → 42.10.0 (the only
  direct dependency; now `^42.10.0`) and transitive build/tooling bumps to brace-expansion 1.1.21,
  axios 1.20.0, undici 6.29.0, js-yaml 4.3.2, baseline-browser-mapping 2.11.22, joi 18.2.9,
  @xmldom/xmldom 0.8.15, fast-uri 3.1.7, and browserslist 4.28.9. All are dev/build-time only.

### Fixed

- Two test harnesses failed on a developer machine: `test/electron-fuses.ts` hard-coded POSIX
  `/release/...` paths (failing on Windows hosts), and `test/release-integrity.ts` demanded README
  badges match the full package version even though the patch-bump hook changes it on every commit.
  Paths are now built with the host separator, and badges are checked against `v<major>.<minor>.0`,
  the only tags CI creates.
- README and `AGENTS.md` cited a stale regression-harness count (62/100); corrected to the
  current 101.

## 0.8.0 - 2026-09-27

### Added

- **JDDC Playback** — a standalone app that loads a `.jddc-playback` scenario (or a `.jddc-project`,
  ignoring its history/recipes) and animates it: play/pause/seek/speed, per-track visibility and
  colour, and live range/bearing/closure-rate between two selected tracks. Reached via
  `?app=playback` in the browser build, or "Launch Playback" in the Workbench's Project panel on
  desktop, which opens a real window and streams the current data to it over IPC.
- **JDDC Graph Analysis** — a companion app for numerical review without animation: per-entity
  altitude/speed/climb-rate charts, a statistics table (mean/min/max), and — for a selected pair —
  closure-rate and slant-range over time plus a closure-rate-vs-range correlation scatter. Reached
  the same way, via `?app=graph` or "Launch Graph Analysis".
- **`.jddc-playback` format** — a scoped profile of the existing `.jddc-project` archive (same
  gzip-JSON codec, same validation boundary): every loaded dataset's current points and channels,
  callsign/aircraft-type/colour per dataset, no undo history, recipes, or fusion artifacts, and the
  original `sourceFormat`/`sourceFileName` preserved rather than rewritten. "Export to Playback" in
  the Project panel offers gzip (default) or plain, human-readable JSON.
- Shared building blocks for the two new apps, reusable by future ones: a pairwise range/bearing/
  closure-rate helper computed on demand and never stored (`src/core/analytics/pairwise.ts`), and a
  helper that derives missing `standard-kinematics` channels on load without ever overwriting a
  channel a dataset already carries (`src/core/analytics/ensureChannels.ts`).

### Known limitations

- No desktop shortcut or CLI argument launches Playback/Graph directly in the packaged app; today
  they're reached from within a running Workbench, or by hand in the browser build. Per-platform
  launchers (macOS can't pass a launch argument from the Dock) are future work.
- Not benchmarked at scale — tested with real fixtures up to a couple thousand points across two
  entities, not the 100-aircraft/multi-million-point exercises the suite is ultimately for.

## 0.7.0 - 2026-09-27

### Fixed

- **The 3D view orbited upside down.** The projection rotated by −pitch, so a positive pitch put
  the camera *below* the floor looking up: dragging down tipped the scene the wrong way, the
  default view was from underneath, and the **Top** preset (pitch 0) was actually a side view. The
  rotation itself is corrected (not the drag sign flipped), so dragging down now raises the camera,
  **Top** looks straight down with north up — matching the Map — and **Side** looks along the
  horizon towards north. `test/scene-camera.ts` pins the visible behaviour.
- **3D companion tracks were drawn on top of the primary track.** Each track was centred on its
  own vertices, so two tracks a kilometre apart overlapped in a view labelled "shared ENU frame".
  All tracks now project through one frame. The grid and the vertical curtain use the scene's real
  floor instead of the first sample's height and a fixed 120 px screen line.
- **The user guide did nothing in installed desktop builds.** The `?` button handed the guide to
  the OS with `shell.openPath()`, but in a packaged app it lives inside `app.asar`, which only
  Electron can read — so it worked from a checkout and failed silently everywhere else. It now
  opens in a sandboxed app window that reads it straight out of the archive, with no browser and
  no network. The packaged smoke gate now opens it through the real IPC on every release.
- **Windows portable: windows that opened and closed before the app.** electron-builder's portable
  launcher only runs silently when no `splashImage` is configured; with the bitmap added in 0.5.x
  it ran in NSIS GUI mode, putting up its own dialog and a BgImage window and tearing both down
  before JDDC started. The splash image is removed. The startup trace now names every window the
  app creates, and the release smoke prints it, so any remaining flash can be attributed.
- **The launch splash's progress bar was easy to miss** — a 3 px line on the window's bottom edge
  that read as a border. It is now a 6 px inset track.
- **README platform badges read "failing" while every release was green.** They queried
  `release.yml` on `main`, where the only runs are stale manual dispatches from August; packaging
  runs on tags. Windows and Linux badges are now pinned to the release tag's own check runs (and
  `test/release-integrity.ts` fails if the pin drifts from `package.json`); macOS, which is never on
  the automatic path, says it is built on demand.
- **P5 roster type code was clipped** to about one visible digit by an 8ch field; it now fits three
  digits and shows the hex value beside it. Callsign / aircraft id / unit inputs had no `type` and
  missed the theme's input styling.
- **Tabs were unreachable in a narrow window.** The tab bar was `overflow: hidden`: Settings was
  cut off at the default 1480 px window, and everything after Project at the 1100 px minimum. It
  now wraps.
- **The chart legend's Hide/Show buttons did nothing.** It kept visibility state of its own that
  nothing plotted from, omitted elevation, and coloured swatches from a different palette. It now
  lists the plotted series in their drawn colours, and Hide works like the channel chips.
- Controls rendering with browser defaults because their rule was missing or did not match: the
  Compare table's index column took 45% of the width (a key/value table rule leaking into data
  grids), the Clip-to-time-window fields showed 9 of 24 characters, project and diagnostic notes
  were cramped unstyled textareas beside inline captions, the Sources colour column was empty,
  "other visible" track names on the map spilled off the toolbar, the Fusion priority field was
  pinned to the far edge, and Export's output-name field was unthemed.
- `test/electron-launch.ts` no longer fails when no dev server is running; it serves `dist/` with
  `vite preview` itself. (Loading `dist/` over plain `file://` is not an option: the dev Electron
  binary fails a random subset of lazy chunks there, while the packaged app — reading from
  `app.asar` — loads every one.)

### Added

- **P5: "Files in this set".** A table on each recording saying what the `.msnP5`, `.rpt` and
  `.teq` each are and what this session holds of them: the `.rpt` is a block index JDDC can rebuild
  (supplied and cross-checked, or derived), the `.teq` is an undecoded companion carried
  byte-for-byte. The export button names the `.teq` when one will be written. The guide gains a
  P5 section screenshot, captured from a synthetic recording.
- **Save the analysis report as PDF.** The export dialog offers *Save PDF* beside *Save HTML*. The
  desktop app renders it in a hidden, script-disabled window with `printToPDF` and asks where to
  save; a browser opens the report with the print dialog up.
- **Comparison distribution statistics** — n, min, median, P95, max and standard deviation for
  slant range, horizontal range, |vertical separation| and closure rate, in the Compare tab and the
  report, plus a slant-range histogram in the report.
- **3D:** an E/N/U orientation gizmo; keyboard camera control (arrows orbit, Shift+arrows pan,
  +/− zoom, Home resets); playback proportional to recorded time with a UTC / `T+` readout
  (falling back to sample order, and saying so, for untimed tracks); companion tracks in their
  Sources colours with a named legend, following the Sources visibility toggle.
- **Track colour is editable for every dataset** from the Sources tab (it was only editable for P5
  slots), and drives the map, 3D and legends.

## 0.6.0 - 2026-09-26

### Fixed

- **The launch splash could be built and then never shown, and a splash that was never shown
  held the workbench window back for eight seconds.** This is why four previous fixes passed
  their tests and changed nothing a user could see.
  - The reveal guard asked whether a splash *object existed* (`!splashWindow`), not whether one
    was *visible*. So a splash that failed to paint suppressed the workbench's own first-paint
    reveal as well, and the only thing left was the 8-second timeout — where before the splash
    existed, `index.html`'s skeleton appeared at first paint in a few hundred milliseconds.
    Verified by suppressing every show path: the workbench now reveals at ~1.2 s instead of 8 s.
  - Visibility no longer depends on the artwork. It was gated solely on an IPC message the
    preload sends after decoding a 222 KB plate, with the comments explicitly rejecting any
    fallback — so one dropped message meant no splash at all. `splash.html` paints its ground,
    the product name, the version and the progress bar entirely from inline CSS, so the first
    paint is already a complete splash; the plate is now an enhancement that fades in. Three
    independent routes (first paint, artwork decoded, a last-resort timer) each show it.
  - A splash whose renderer or preload dies is dismissed instead of lingering hidden forever.
  - The artwork report is accepted only from the splash's own renderer.
- **The progress bar no longer reports 86% before the largest chunk has loaded.** The stage that
  fires on the workbench document's `did-finish-load` sat at 0.86, but that event lands *before*
  `src/main.tsx` dynamically imports `App.tsx` — so the bar reached a near-full reading in a few
  hundred milliseconds and then stalled there for the whole of the real work. Rebalanced so the
  ease still has somewhere to travel while that chunk loads.
- **Startup no longer copies the ~23 MB bundled overlay on the main thread.** `seedKmlLibrary`'s
  `copyFileSync` ran during the splash-to-workbench handoff on a first launch; on Windows that is
  also the thread pumping the message loop, so the window froze exactly as the user first saw it.
  The startup path now uses an async copy; the explicit "reset bundled overlays" action keeps the
  synchronous one.
- The splash appeared as a bare dark box that flashed on and off. `ready-to-show` and
  `did-finish-load` both fire before a CSS `background-image` has decoded, so the window went up
  painted in nothing but its `backgroundColor` — and on a quick launch it was retired again before
  the artwork ever arrived. The splash preload now reports when the plate is actually decoded, and
  the window waits for that.
- There is no longer any timeout that shows the splash regardless. Every version of that guard
  shipped the bug it was meant to prevent: at 400 ms and at 1200 ms it beat the artwork on a cold
  start and put a blank rectangle on screen; at 2500 ms it sat past the point where a fast launch
  had already retired the splash, so it never fired at all. If the artwork cannot be painted the
  launch now proceeds with no splash, exactly as it did before the feature existed, and the
  workbench is no longer held back for a window nobody can see.

### Added

- **`JDDC_STARTUP_TRACE=1` prints one line per startup phase**, including the gap from process
  spawn to `main.cjs` that no in-app window can ever cover because Electron has not booted yet.
  Every splash timing constant in this app had been tuned against a single warm Linux launch;
  this is how a slow launch gets diagnosed on the machine that is actually slow rather than
  guessed at.
- **`test/electron-launch.ts` launches Electron for real** and asserts the splash actually became
  visible, before the workbench mounted, within 2 s. The existing Electron coverage reads
  `electron/main.cjs` as a *string* and regexes it — its ordering assertion matched the first
  textual occurrence of `openSplash()`, which is inside a **comment**, and of `createWindow()`,
  which is the function *declaration*, so it passed without ever looking at a call site and would
  have kept passing with both calls deleted. That is the false confidence behind four fixes that
  "tested fine". The new harness skips loudly when it cannot run.
- The packaged smoke test now reports whether the launch splash was observed, instead of only
  filtering it out of its target search.
- **P5 CTS mission recordings (`.msnP5`) can be imported, inspected, edited and exported.** The
  format had no public specification; it was reverse-engineered from a single recording and the
  result is written up in [`docs/P5-MSN.md`](docs/P5-MSN.md), which separates what is confirmed
  from the bytes, what is inferred, and what is still unknown. The container is fully decoded —
  the `.rpt` block index, the 1 Hz block / 10 Hz subframe hierarchy, the plain-binary HH:MM:SS:CC
  clocks, the 50-slot participant roster and the 88-byte slot record framing — and every
  structural invariant is checked on load.
  - Each instrumented roster slot becomes its own track, so callsign, aircraft id, unit, aircraft
    type code, colour, label and visibility are all editable per aircraft.
  - **Export is a byte patch of the source file, not a re-serialization.** Most of a slot record
    is still undecoded, so regenerating one would mean inventing bytes; instead the imported
    bytes are edited in place. An export with no changes is byte-identical across all three files,
    verified against the full 446 MB specimen and asserted in the test suite.
  - The `.msnP5`, `.rpt` and `.teq` are handled as one set: dropped together they are paired by
    basename, the index is cross-checked against the layout derived from the recording, and the
    `.teq` is carried through export unchanged so what comes out is the set that went in.
  - A new **P5 Mission** tab carries the roster editor, the range georeference, a structural
    validator, and the export. Recordings run 400–500 MB and are held for the session, so the
    desktop app is the recommended home for them.
  - **Modifications the format cannot represent are reported, never dropped in silence.** A P5
    recording has nowhere to mark a sample deleted, and its clock lives in the subframe header
    shared by all 50 slots, so a per-track time shift cannot be written. Deleted points, edited
    timestamps, directly-edited raw frame channels, and two points claiming one record each
    produce an export warning naming the count and the reason.
  - **Altitude and time references are reported as `UNKNOWN`, not assumed.** Nothing in the file
    identifies its time base — it carries two clocks about four hours apart with no explanation —
    and derived height is only as good as the anchor height the operator supplies. Claiming
    HAE/UTC would let a cross-source comparison proceed silently that ought to warn.
  - **Every subframe carries an XOR integrity word over its 4,400 payload bytes** — `XOR32(records) ^
    0x0332044E`, confirmed against all 99,409 subframes of the specimen with zero exceptions. It is the format's
    only whole-payload check, so a flipped byte anywhere is caught, and validation now verifies it. Position
    edits maintain it incrementally (XOR is linear and every position field is word-aligned), which also means an
    edit followed by an undo restores the original bytes exactly.
  - The subframe header's apparent **second clock is not a clock**: it is the first clock XORed with
    `0x04010003`. Read as arithmetic it looked like a receipt timestamp four hours ahead with a few-centisecond
    jitter; it carries no information of its own.
  - **Frame origin is selectable.** `Range center` treats frame (0,0,0) as the surveyed range center, which is
    what the format encodes and the only mode that yields absolute positions; `First live sample` needs no survey
    data but displaces every coordinate. The parked position plus a real range center over-determines both unit
    scales, which is the way to settle them.
  - **Per-slot coverage scan.** A pod acquires late, drops out and re-acquires, and on a map those gaps are
    invisible because the track draws straight across them. The P5 Mission tab now shows a bucketed availability
    bar, coverage percentage and bounded gap list per aircraft — labelled as data availability, not line-up
    changes, because no mid-mission roster update exists in the format as decoded.
  - `npm run verify:p5 -- <file.msnP5>` proves the round-trip against a real recording: byte
    identity across all three files, idempotence over two cycles, 500+ bulk edits read back by
    value, a full 50-slot roster round-trip, undo restoring the original bytes, and rejection of
    truncated, mis-signed and deep-damaged files.
- **Range georeference is an explicit, operator-owned setting.** A P5 recording stores positions
  in a range-local frame whose origin and unit scale are *not in the file*. JDDC does not guess
  silently: it applies a stated default, warns on every import that the coordinates are an
  assumption, flags every point with `p5_assumed_georeference`, and keeps the raw frame values as
  the `p5_x`/`p5_y`/`p5_z` channels so a corrected georeference can be applied without
  re-importing.
- `portable.splashImage`: the Windows portable executable now shows a native bitmap while it
  extracts. That extraction happens before Electron starts, so it is the only thing that can put
  anything on screen during it — no in-app splash can. **The installed build remains much faster
  to launch**: electron-builder's portable target runs `RMDir /r` and re-extracts the entire
  application into `%TEMP%` on *every* launch, while an installed copy simply runs from disk.

## 0.5.1 - 2026-09-04

### Fixed

- The launch splash could be missed entirely. Three causes, all measured against a packaged Linux
  build:
  - Warming the KML/KMZ overlay library ran in `ready`, between opening the splash and its first
    paint. Its first act is a synchronous 23 MB copy of the bundled airspace overlay into
    `userData` on a first launch, which blocks the main process — so the splash's own
    `ready-to-show` could not be delivered while it ran, and the launch that most needed a splash
    was the one least likely to show one. It now runs once the workbench is on screen; nothing
    needs it before the map is opened.
  - The splash was dismissed the instant the workbench reported ready. On a warm launch that
    measured 381 ms end to end, leaving the splash on screen for about 330 ms — a flash that reads
    as a rendering glitch. It now stays up for a minimum of 900 ms including its outro
    (`SPLASH_MIN_VISIBLE_MS`), which binds only on launches already fast enough to beat it.
  - A 400 ms fallback meant to cover a swallowed `ready-to-show` was firing during ordinary cold
    starts, before the document had committed, putting a **white** 800×343 rectangle on screen for
    the ~200 ms until the art arrived. The splash is now shown by whichever of `ready-to-show` or
    `did-finish-load` lands first — both mean real pixels — and the blind fallback moved to 2.5 s,
    where only a genuinely stuck renderer can reach it.

  Note that no splash can cover the time before Electron's `ready` event, which was measured at
  ~970 ms on a cold packaged Linux launch and is expected to be longer on Windows, where the ASAR
  integrity fuse hashes the archive at startup.

### Changed

- A `v*` version tag now builds and publishes Linux and Windows only. macOS runners bill at 10x on
  GitHub Free, which made an unattended mac build the most expensive thing a tag could start by
  accident, so it is now published deliberately — by running **Release** by hand with "Also build
  macOS" ticked, or by the existing **Release (macOS)** workflow. Either publishes into the same
  `v<version>` release, adding its artifacts alongside the ones already attached.
- `is_full_release` now means "covers everything the automatic release publishes" rather than
  "covers all three platforms", so the tagged Linux+Windows build owns the release's canonical
  `SHA256SUMS.txt` and a later macOS run still takes a scoped partial manifest instead of
  overwriting it.

## 0.5.0 - 2026-09-04

### Added

- A launch splash for the desktop app. It is the first thing `ready` opens — ahead of every IPC
  registration and filesystem touch — so a cold launch is acknowledged on screen in well under a
  second while the rest of startup proceeds behind it. A progress bar spans the bottom edge and a
  status line above it cycles through what is actually being brought up at each stage. The stages
  are real: the bar advances on the workbench window's `dom-ready`, on its `did-finish-load`, and
  on the renderer's own report that React has mounted, and every item named is something that
  stage genuinely loads or registers. It is a plain frameless window rather than a transparent
  rounded one because `transparent: true` is unreliable on Linux without a compositor, and black
  corners on the AppImage and `.deb` builds are worse than a straight edge everywhere.

### Changed

- The application icon and the browser-tab favicon are now the JDDC mark. The favicon previously
  carried an unrelated stock logo left over from the project scaffold.
- Quality Gates no longer runs for a push or pull request that touches only documentation, source
  artwork, or agent and editor scaffolding — none of which is an input to the lint pass, the test
  harnesses, the web build, or the health check. One code file in the same change brings the whole
  suite back, and `workflow_dispatch` still forces a run over anything. The release workflows are
  deliberately unfiltered: they fire on a version tag, and a tagged release has to produce its
  artifacts whatever the last commit happened to touch.
- The desktop window now stays hidden until the renderer reports the workbench mounted, rather
  than appearing at the loading skeleton's first paint. With a splash on screen the old behavior
  would raise a half-built window behind it and then swap to that same window a second later.
  Nothing changes for the browser build, or for a macOS `activate` reopen, where there is no
  splash to wait behind and the skeleton still carries the wait. An 8-second ceiling covers a
  renderer that never reports in, so a bundle that throws before mounting still surfaces its
  failure in the skeleton instead of leaving a permanent splash.

## 0.4.0 - 2026-09-04

### Added

- An illustrated user guide, opened by the **?** button in the header or on the Settings tab. It
  covers every tab, control, gesture, and keyboard shortcut, with worked examples for importing a
  CSV, comparing two tracks, repairing outliers, and exporting, plus a troubleshooting section. It
  ships inside the desktop app and works entirely offline — no fonts, scripts, or images are
  fetched from anywhere.
- `FEATURE_INVENTORY.md`: an exhaustive reference for every control and behavior in the workbench,
  and the source the user guide is written from.
- A unit-system preference (Settings → Display units): every distance, altitude, and speed
  readout can now render in aviation/marine units (feet, nautical miles, knots) instead of
  metric. Covers the Overview metrics and track metrics, the Point Inspector's fields and
  neighbour legs, the Compare tab's summary cards and sample table (whose column headers carry
  the active unit), the map's point tooltip, and the chart window readout. Channel values and
  their inferred units are deliberately left alone — an arbitrary channel is not metres — as are
  bearings, sample rates, and time deltas.
- Cross-dataset comparison results now actually reach the exported HTML analysis report. The
  report's comparison section had existed since the report was built but was never supplied with
  data, so every export said comparison results were "not yet captured in report export". The
  section is re-derived from the saved comparison settings at export time, so it is populated
  even if the Compare tab was never opened, and always names the same dataset pair the tab shows.
- End-to-end browser coverage for the Track Health repair flow: scan, repair, and both the
  Accept and Revert outcomes, asserting that accepting refits the flagged points in place
  (the track keeps every point) and reports them as interpolated rather than as observed data.

### Changed

- Stored data, all exports, and the HTML analysis report remain in canonical metres and m/s
  regardless of the display-unit preference. The Settings panel states this explicitly.
- The Point Inspector's inter-point distance now switches to kilometres (or nautical miles) at
  one whole unit rather than at ten, and shares the formatting used everywhere else — a
  consequence of collapsing a duplicated distance formatter into the shared one.

### Fixed

- Two long-standing races in the layout end-to-end tests, both test-only (the app's measured layout
  is byte-identical either way): one measured the Transform tab before its code-split panel had
  rendered, reading the loading skeleton instead; the other assumed the import was the newest log
  line when a background map-overlay load can land after it.
- Four controls had no accessible name and were unreachable by a screen reader: the Table tab's row
  filter, the bookmark label field, the Fusion source priority fields, and the project file picker.
  A new end-to-end check now walks every tab and fails if any visible control lacks one.
- The Compare tab and the HTML report can no longer disagree about a comparison: both now compute
  their range statistics, and resolve which dataset pair is being compared, through the same code.
- Summarizing a very long comparison no longer risks a call-stack overflow when the report path
  (which applies no sample cap) summarizes it.

## 0.3.0 - 2026-09-04

### Added

- Y-axis zoom and pan on the Charts tab, closing out the editable-graph-view work: ctrl/⌘+wheel
  zooms cursor-anchored the same way X already did, ctrl/⌘+shift+wheel pans. Because each plotted
  series auto-scales to its own unit (elevation in metres next to a turn rate in °/s), the zoom is
  a shared fraction of each series' own span rather than one absolute value domain.
- Real channel-vs-channel scatter: the Charts tab's x-axis can now be set to any numeric channel,
  not just time/index/distance, once Scatter is the active chart type — a line/area chart never
  accepts a channel axis, since a polyline through non-monotonic values would be a scribble.
  Switching chart types away from and back to Scatter preserves the chosen axis.
- Area and points-only Scatter rendering: Area now fills down to the plot baseline; Scatter draws
  no connecting line, matching what the label implies instead of rendering as a relabeled line
  chart.
- "Drop outliers" now reconstructs flagged points in place from their surviving neighbours by
  default, through the same plausibility-gated spline/linear fit engine "Fill gaps" uses, instead
  of leaving a hole. Falls back to plain deletion (not a crash) when a track has any untimed
  point. Motion-profile presets (Aircraft/Ground vehicle/Marine/None) are now shared between the
  two repairs, with Aircraft as the default for both.
- Outlier detection no longer flags an entire sustained, legitimate turn: the position noise
  floor now accounts for a synthetic arc at the track's own fastest observed speed and the
  motion profile's turn-rate ceiling, rather than reading a turn's steady (near-zero local
  scatter) residual as signal.
- A persisted default motion profile setting (Settings tab): Drop outliers and Fill gaps now
  open on whichever profile was last chosen, instead of always resetting to Aircraft.
- NMEA parser support for VTG (course/speed over ground), ZDA (date/time), GSA (PDOP/HDOP/VDOP +
  active satellites), and GSV (satellites in view). Each rides its values onto the next GGA/GLL
  fix that doesn't already carry an equivalent field of its own; RMC's own speed/heading is
  deliberately not propagated the same way, since that would attribute a different sentence's
  measurement, at a different timestamp, to a fix that never took it.
- A GPS fix-quality Track Health check, informational only (never affects the score or blocks):
  flags stretches of degraded HDOP or low satellite count using `hdop`/`sat` data every GPX/NMEA
  import already carries but no check previously read.
- Full keyboard navigation and ARIA roles for the Table tab's data grid: arrow keys move a focus
  ring, Enter/Space selects (with the same Ctrl/⌘/Shift modifiers the mouse gestures use), and
  `aria-rowcount`/`aria-rowindex`/`aria-activedescendant` report correctly even though the grid is
  virtualized and only renders on-screen rows.
- An `aria-label` on the Map tab naming the loaded point count and any other visible track layers.
- Chart drag-to-zoom no longer highlights the axis text it passes over mid-drag.
- Expanded automated test coverage: `core/stats.ts`, `core/geoInterpolation.ts`, the motion-profile
  reconstruction engine, every new NMEA sentence type, and a new end-to-end spec covering Settings
  persistence across a real page reload.

## 0.2.0 - 2026-09-02

### Added

- IRIG / range-time parsing (`DDD:HH:MM:SS.ffffff`, and bare `HH:MM:SS.ffffff`). Flight-test
  recorders stamp day-of-year range time, which `Date.parse` rejects outright, so every row of
  such a file previously imported with no timestamp at all and nothing downstream that needs
  time — speed, the movement window, the time-order check, GPX export — could run. The format is
  now recognised by auto-detect, offered explicitly in the mapping panel, and understood by the
  column analyser, so the column is typed as a datetime and auto-maps to the timestamp field.
- Range time carries no year. Imports state the assumption in a warning naming the year the
  dates were anchored to, rather than letting a wrong absolute date reach an export silently.
  Relative timing — what every analytic actually consumes — is exact either way.
- Stale derived-channel badge. A manual edit to lat/lon/elevation/time is truth data and is never
  silently recomputed away, so `distance_m`, `ground_speed_mps`, and every other channel a
  derivation produced from that point (or the point after it, for pairwise kinematics) now carry
  an amber "stale" badge in the Point Inspector and the Points panel until the producing
  derivation is re-run. Re-running it clears exactly the channels it owns; the `manual_edit` flag
  itself is untouched.
- Point deletion, from the Table grid and the Charts tab. Ctrl/⌘+click or shift+click builds a
  multi-point selection (ctrl/⌘+drag on the chart adds a whole run at once); a Delete button
  removes exactly those points as a replayable, undoable operation, the same as any other
  transform. In the Charts tab the gesture only arms once the visible window renders every point
  individually, so a selection is always exact — never a stand-in for a downsampled range.
- The Charts tab's drag now zooms to the dragged span at every zoom level, replacing the old
  drag-to-range-select; wheel zoom is unchanged, and shift+wheel (or a trackpad's horizontal
  swipe) pans without changing zoom. Range selection is still available — shift+arrow, the
  Table's row clicks, or zooming to an existing selection — the chart just no longer *produces*
  one from a drag.
- A Settings tab. The chart, map, and 3D scene point-rendering budgets are user-adjustable
  instead of hardcoded constants, stored on the device rather than inside any project. The chart
  budget does double duty: it's the same value that decides whether a point renders individually
  and whether it's selectable for the deletion gesture above.
- Chart image export, as SVG or PNG. The exported file is self-contained — every element's
  *computed* style is inlined so it renders correctly outside this app — with a background rect
  added so a standalone view matches the on-screen chart.
- A CSV import with no usable timestamp (an unmapped timestamp column, or one where every row
  failed to parse) now raises a prominent warning — the header status badge, the import toast,
  and Track Health all surface it — instead of silently producing a dataset with no time axis,
  playback, or time-based metrics.

### Fixed

- **The application closes again.** With unsaved changes present, the window button, the
  taskbar's "Close window", and Alt+F4 all did nothing. A cancelled `beforeunload` raises the
  browser's "Leave site?" prompt on the web but raises *nothing* in Electron — it just cancels
  the close — so the renderer's unsaved-changes guard silently made the window unclosable. The
  desktop build now hands the dirty flag to the main process, which owns the confirmation as a
  real native modal; the web build keeps the listener, where it works as intended.
- The data grid no longer runs away under the cursor. Every row published its index on
  mouseenter and the grid re-centred on it, which scrolled new rows under a stationary pointer,
  which fired the next mouseenter — a feedback loop that took hold as soon as the pointer neared
  the top or bottom edge. Hover updates this grid raises itself are no longer followed, leaving
  cross-panel hover (map, charts, 3D scene) and arrow-key navigation working, and a row already
  on screen is no longer scrolled at all.
- Column headers are no longer cut off on the right. The header sat outside the scrolling
  viewport, so a grid wider than the panel scrolled its rows while the labels stayed clipped.
  Header and rows now share a width and scroll horizontally together.
- Outlier detection no longer reads altimeter quantization as signal. Altitude arrives on a
  fixed grid (4 ft, 1.219 m, in the file this was found with), so over a short window most
  residuals are exactly zero, the median absolute deviation collapses to zero, and the robust
  z-score silently degenerates into whichever floor the config supplies — making "3σ" a fixed
  3 m bar, *inside* the sensor's own resolution at 2.46 quantization steps. The elevation scale
  is now floored at the channel's detected step as well. Continuous channels are unaffected,
  where the deviation is far above the step and already wins.
- The Special Use Airspace KML overlay now loads in packaged Windows and macOS builds. Only the
  Linux target had an `extraResources` entry seeding it; Windows and macOS fell back to a remote
  fetch URL pointing at a deleted branch, which 404s, so the overlay silently never appeared.
  `win` and `mac` now carry the same `KML-KMZ → kml-seed` bundle Linux already had, and the local
  seed always wins over the remote fetch — verified end to end (`seedKmlLibrary` against a packaged
  `kml-seed` directory populates the library correctly), not just that the file lands in the
  installer. Adds ~23 MB to each Windows/macOS artifact.
- The Charts tab no longer overlaps the chart on top of the Point Inspector. `.charts-workspace`
  forced itself to shrink to the viewport (`min-height: 0`, inherited from the single-panel Map
  tab layout), but once a second panel sits below the chart, that shrink squeezed the chart below
  its own readable minimum and its `overflow: visible` content — the legend, "Reset zoom" chip,
  and per-point selection chip — painted over the inspector below it. Worse, the floating chip
  intercepted clicks meant for the inspector's own "Edit" button, making the point editor
  unreachable whenever enough channels were selected to fill the window. The workspace no longer
  shrinks below its content (`.tab-content`'s existing scroll takes over instead, matching every
  other tab) but keeps growing to fill a tall, short-content window exactly as before.
- The Charts tab's screen-to-data coordinate mapping used the SVG's bounding-rect aspect ratio
  instead of its screen transform matrix, silently mis-locating clicks whenever `.chart-svg`'s
  `max-height` cap made its rendered aspect ratio diverge from its 900:320 viewBox (mainly a
  short-window symptom). Invisible until a gesture actually depended on click accuracy — the new
  delete-set hit-testing above is what surfaced it; now uses `getScreenCTM()`, exact regardless
  of letterboxing.
- Zooming or panning the chart with the mouse wheel could scroll the page underneath it at the
  same time. React attaches the JSX `onWheel` handler as a passive listener by default, which
  silently drops `preventDefault()`; replaced with a real listener registered
  `{ passive: false }`.

### Known limitation

- Re-running outlier removal keeps finding more points, and this is inherent to the check rather
  than a threshold that needs tuning: a point is scored against its index-space neighbours, so
  removing the sharpest samples makes their neighbours adjacent and concentrates the same real
  motion into fewer samples, producing a fresh crop. Measured on a 10 Hz fighter sortie it
  reaches a nonzero steady state at every threshold from 3σ to 15σ, with the scale both frozen
  and recomputed. On data with genuine high-rate dynamics the flags are real manoeuvring, not
  sensor error; raising `scoreThreshold` is the lever, not repeated removal.

## 0.1.12 - 2026-08-27

### Added

- A packaged-ASAR integrity gate (`npm run check:asar`, `scripts/verify-asar-integrity.mjs`)
  that re-runs Electron's own startup validation at build time -- archive header against the
  hash embedded in the executable or `Info.plist`, then every file and every integrity block
  against the bytes actually stored. It is wired into `build:desktop`, `build:desktop:linux`,
  and `build:desktop:win` themselves, so a packaging regression fails the build command that
  produced it -- no installer is ever handed to the smoke test, the artifact upload, or the
  publish job. The packaged smoke launch re-runs it afterwards as a second line of defence.
- Automatic Actions-run housekeeping. Quality Gates and every release workflow now end with a
  non-blocking `prune` job that deletes runs belonging to workflow files that no longer exist,
  plus its own history beyond the 30 most recent. A manual **Prune Workflow Runs** workflow
  covers one-off sweeps across every workflow at once, and defaults to a dry run.

### Fixed

- **The packaged Windows and macOS applications now start.** 0.1.1's installer and portable
  builds exited immediately with no window and no process in the task manager. Electron
  validates every byte it reads out of `app.asar` against the per-file `integrity` block
  recorded in the archive header, and on a mismatch it prints one line to a console no packaged
  user ever sees and calls `process.exit(1)`. `@electron/asar` 4.1.2-4.3.0 -- pulled in over
  electron-builder's own 3.4.1 by a `package.json` `overrides` entry -- hashes small files by
  re-reading the source path from disk instead of the bytes electron-builder streams into the
  archive. Every `package.json` electron-builder rewrites while packing (the app's own, plus one
  per runtime dependency) therefore carried the hash of its pre-rewrite content, and the app
  died on the very first read of `app.asar/package.json` at startup. Dropping the override
  restores 3.4.1 and the archives now verify clean. Linux was never affected: it has no
  embedded-integrity fuse.
- The previous release's attempt at this -- clearing `release/` before a Windows pack, blamed on
  a stale `app.asar` -- treated a symptom. `release/` is now cleared before every desktop build
  regardless, but the integrity mismatch was produced fresh on every build, including on a clean
  CI runner.
- `win.icon` and `linux.icon` pointed at `images/Img1.png`, which has never existed in this
  repository. electron-builder silently fell back to `build/icon.png`; both entries now name
  that file, so the configuration says what the build actually does.
- Release publishing no longer races its own cleanup. `cleanup-artifacts` declared
  `needs: [setup, package]`, so it unblocked alongside `publish` rather than after it and could
  delete the platform artifacts before they were downloaded, failing the run with
  `find: 'release-bundle': No such file or directory`.
- A partial (single-platform) release writes `SHA256SUMS-partial-<platforms>.txt`, which no
  longer collides case-insensitively with the packaging step's `SHA256SUMS-Windows.txt`.
- Publishing a release with no downloaded platform artifacts now fails with that reason stated
  rather than a bare `find` error about a missing directory.

### Changed

- The packaged-application launch check is a hard release gate. It was advisory
  (`continue-on-error: true`), and on 0.1.1 it correctly reported `Packaged application exited
  early with code 1` for both Windows and macOS -- and the release published anyway. Its Linux
  dependency install is likewise no longer allowed to fail into a silent skip.
- Removed a stray zero-byte `playwright` file from the repository root.

## 0.1.1

### Added

- A self-contained, print-ready HTML analysis report with dataset statistics, reference and
  source metadata, quality evidence, warnings, bookmarks, and operation history.
- A light, low-ink VectorPunk/HUD report design with responsive and print-specific layouts.
- Browser and Electron diagnostic-bundle export with strict schema and size validation.
- Chromium end-to-end coverage of the primary import, linked-inspection, transform,
  project-round-trip, report, diagnostic, and export workflow.
- Deterministic bounded property/fuzz coverage for transforms, GeoJSON, text parsers, and
  project-archive corruption.
- Native packaged-application smoke definitions for Linux, Windows, and macOS.
- Release artifact manifest verification, CycloneDX SBOMs, and GitHub/Sigstore provenance
  attestations.
- A reviewed Electron Fuse V1 policy and a shared, tested nine-operation IPC security contract.
- Desktop builds now keep a bounded, oldest-pruned local safety-net copy of every imported and
  exported file in a dedicated archive folder (independent of wherever the OS puts downloads),
  reachable from the Project tab's "Open archive folder" button.
- The release workflow's build-verification job now runs the full lint/unit-test suite and the
  Chromium end-to-end smoke tests before packaging installers, closing a gap where a tag push
  could publish a release without either gate passing.
- A Track Health Scan that grades a loaded track against six pass/fail checks and lets the
  operator drill into each failure, with the offending samples highlighted on the map and the
  time-series chart.
- A "Drop outliers" repair that removes points breaking their local trend in position,
  elevation, or ground speed, scored by the same robust MAD detector the Track Health scan
  grades against. Channels can be selected individually.
- A "Round precision" repair that reduces stored decimal places for coordinates, elevation,
  and numeric channels through the same formatter the exporters use.
- "Clip to time window" is now reachable from the Transform tab; it defaults to the selected
  time range and was previously implemented but had no UI.
- A "Restore original" action in the Transform tab that discards every applied operation and
  returns to the original import. The restore is itself undoable.
- A Track Metrics panel in the Overview tab: elapsed time and span, high/low speed and altitude,
  point accounting (valid, invalid, timed, elevated, duplicate, and per-provenance-flag counts),
  and the format-specific metadata parsers capture. `metadata.meta` — GPX creator, EAG platform,
  exercise and mission ids, GPB track name — was parsed and stored but had no consumer until now.
- A spatial density overlay on the map, toggled from the map controls with an adjustable cell
  size. Binning is equal-area (longitude scaled by cos(lat)) and antimeridian-safe.
- A collapsible log dock, collapsed by default to a single line showing the newest entry, so the
  220px dock no longer competes with the workspace for height.
- Typed, stackable, dismissible toast notifications with severity colouring, replacing the
  single-slot toast that discarded a message whenever a second one arrived.
- A header status light reporting idle / working / ready / warnings / errors from live log
  tallies; a finished run that logged errors previously looked identical to a clean one.
- Destructive actions now open a dialog that names the consequence and shows before/after
  counts, replacing `window.confirm`.
- Skeleton placeholders during the Track Health scan's first run.
- Entrance, hover, and status animations throughout, all disabled under `prefers-reduced-motion`.
- Track Health's outlier check now offers a "Drop flagged points" action that runs the
  drop-outliers operation at the scan's own thresholds. The scan could previously only point at
  bad samples; there was no remediation affordance anywhere in the app.
- A "Fill gaps" repair that bridges dropouts with Fritsch–Carlson monotone cubic interpolation
  fitted through the real points on either side. A gap whose fill would imply motion outside the
  selected motion profile (aircraft, ground vehicle, marine, or unconstrained) is skipped and
  reported rather than invented, and every inserted point is flagged `interpolated`.

- A **Points** tab: a point visualizer that shows one sample in its own neighbourhood rather
  than as another table row. A quality strip spans the whole track and jumps to any sample; an
  equal-aspect local plan view and elevation profile show whether the sample sits on the line
  its neighbours describe; the legs either side report their interval, geodesic distance,
  implied speed, elevation change, and bearing; and the full field list covers provenance,
  quality flags, overlapping quality events, and every channel. Selection is the shared store,
  so stepping through samples here moves the map, charts, table, and 3D scene with it.
- A graphical **Accept / Revert gate** in front of every repair that changes the track. The
  original and the proposed repair are drawn on one frame — plan view, profile, or both,
  whichever the change makes sense in — with the samples the repair added, removed, moved, or
  retimed marked, alongside the operation's own summary, warnings, and point counts. Nothing is
  applied until Accept: Escape, clicking away, and closing the gate all revert, so making no
  choice leaves the track untouched. Reachable from every Transform card, the worker-backed
  fixed-rate resample, and the Track Health scan's "Drop flagged points". Whether a repair has
  a graphical view is computed from the before/after diff rather than a list of operation ids,
  so a derivation that only writes computed channels applies without raising a gate. A "preview
  repairs" toggle in the Transform toolbar turns the gate off for batch work.

### Removed

- The retired test corpus, ahead of this repository being made public.
  `test/eag-geographic.ts` no longer checks that ≥95% of real points land in a
  bounding box; it now checks that the ECEF→geodetic conversion recovers known WGS-84
  waypoints to within 3e-5 degrees and 2 m, against reference values computed outside
  `src/core/geodesy.ts`. Both filename date encodings the EAG parser supports stay covered.

### Changed

- Documentation consolidated for the public release: the duplicate `Roadmap.md` was folded into
  `ROADMAP.md` (the two spellings collided on case-insensitive checkouts, so Windows and macOS
  clones could not resolve both), the version history and Phase 1 status were brought up to
  date, and the `README.md`/`docs/EAG-TSPI.md` descriptions of EAG test coverage were corrected
  to describe the synthetic fixtures actually in use.
- Test fixtures now live in `test/fixtures/`, with one shared definition of
  the fixture root in `test/helpers/fixtures.ts`. Three unreferenced fixtures were dropped,
  one of them a byte-for-byte duplicate, along with a midnight-crossing assertion that
  accepted both of its own outcomes.
- Bundled map overlays now ship with the build and load themselves. The browser build serves
  `KML-KMZ/` at `kml-library/` (dev server and build output alike) and the packaged Linux app
  carries the same files in `resources/kml-seed`, so `Special_Use_Airspace.kml` appears on the
  map on first run instead of waiting for a manual "Show on map". Loading happens after first
  paint. Windows installers are unchanged — they stay lean and still resolve the overlay
  remotely — and the web build's overlay copy is excluded from every installer.
- The selection badge is now two controls, not one. Clicking the badge takes you to the samples
  it names — the map fits them, the chart zooms to them, the table scrolls to the row, and the
  3D scene pans to centre them without disturbing the orbit you set up. Only the × discards the
  selection, so the destructive action is no longer under the whole target and there is finally
  a way to ask "where is that point?".
- The Speed Envelope health check now ignores the first 20% of a file. Recordings routinely
  start with the aircraft parked and powered up, which sits below the 10 kt floor as normal
  operation; a brief speed burst at the head (engine start, GPS noise while stationary) could
  open the movement window across the whole parked stretch and spend the check's violation
  budget on it. The skip applies to this check only, is reported in the check's detail when it
  changed what was scored, and removes nothing from the dataset.
- A destructive repair now raises one gate instead of two: the graphical preview carries the
  counts, summary, and warnings the confirmation dialog used to show. The confirmation dialog
  still stands when the preview is switched off.
- `computeStats` now reports a minimum speed alongside the existing max and mean, computed in
  the same single pass rather than recomputed in the UI.
- The Transform tab is now grouped into five labelled sections (validity & structure, outliers
  & smoothing, density & precision, resampling, derive) instead of one flat grid of cards.
- Dedupe, decimate, and simplify are merged into one "Reduce points" card with a mode selector;
  the three elevation filters are merged into one "Elevation filter" card the same way. All six
  underlying algorithms are unchanged — only the card and operation surface is collapsed.
- "Remove elevation outliers" is removed, superseded by the multi-channel "Drop outliers".
- Decimation now always keeps the final point. Dropping it shortened the track's stated time and
  distance extent by up to `factor - 1` samples.
- Project archives now preserve validated operation history and multi-source display settings.
- Project names persist through restore, and dirty workspaces warn before replacement or unload.
- Windows packaging signs installers when `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` are present;
  when they are absent, CI intentionally builds and verifies unsigned artifacts.
- GitHub Actions and the scanner container now use immutable revisions, and
  `electron-builder` is exact-pinned.
- Documentation now distinguishes locally proven gates from native-runner and credential
  requirements.

### Fixed

- The decimate summary now reads "every 2nd point" rather than "every 2th point". The wording
  was cosmetic while it only reached the log; the repair preview puts it at the top of a
  dialog.
- The saved-tab list used on project restore had drifted from the real tab list and was missing
  Sources and Fusion, so a project saved on either tab silently reopened on Overview. Both lists
  now read from one definition.
- The original import is no longer discarded after 50 operations. History pruning used
  `slice(-limit)`, which rotated the original out of index 0 — the snapshot that backs
  "Replay verified history", the project archive checkpoint, and the new "Restore original".
  Pruning now takes from index 1 and pins index 0.
- Every transform in the Transform tab is now a registered, replayable operation. Thirteen of
  the seventeen bypassed the operation registry, so applying any one of them recorded a
  synthesized history entry that showed as "not replayable" and disabled named-recipe saving
  for the rest of the session. Fixed-rate resampling records a real operation too, even though
  it executes in a compute worker.
- "Selected range only" now reaches the operation as a recorded scope instead of being applied
  in the panel, so a range-scoped transform replays as what it was.
- No migration is needed for the merged and removed transforms: every one of them was
  unregistered, so its existing history records were already non-replayable fallbacks.
- The Transform tab clipped roughly 1500px of its cards with no scroll path: the panel had
  `overflow: hidden` and shrank as a flex item, leaving `.tab-content` seeing nothing to scroll.
  Tab panels now size to their content and `.tab-content` scrolls. The same bug hid the log
  stream (which also made its autoscroll a no-op) and truncated the Export tab's preview.
- Deduplication of six identical private copies of `clonePoint`, two copies of the longitude
  seam helpers, and two implementations of the bearing/shortest-angle math.
- The density overlay stranded a Leaflet canvas renderer on the map every time it was toggled.
- GPX and KML no longer drop unparseable points silently. Both skipped coordinates that would
  not parse without recording the fact anywhere, so a malformed file was indistinguishable from
  a short one. Parsers now report structured `droppedCounts` alongside a warning, and the Track
  Metrics panel shows what the source originally offered versus what was imported.
- GPX and KML parsers now reject malformed XML roots with intentional parser errors instead of
  dereferencing a missing document element.
- Linked selection now survives index-stable transforms and clears only when an operation
  reorders or removes points.
- Restored project identity is retained in report names and exported filenames.
- Project manifests, HTML reports, and diagnostic bundles now report the actual package version
  (previously hand-typed as a stale `0.1.0` in three places in `ProjectPanel.tsx`).
- Removed three stray files (an empty `npm`, an empty `joint-domain-data-compiler@0.1.0`, and a
  transient `.jddc-driver-state.json` runtime-state file) that had been accidentally committed.
- Windows packaging now clears `release/` before packing. Building over a previous run's output
  let `electron-builder` reuse a stale `app.asar` whose hash no longer matched the header the
  fuses hook embeds, so the packaged app aborted at launch on an integrity violation.

### Security

- Runtime production dependencies audit with zero high or critical findings.
- Electron IPC payloads, navigation, saved files, and packaged paths are covered by focused
  allow-list, traversal, type, and byte-limit tests.
- `@electron/asar` (`^4.3.0`) and `@electron/get` (`^5.1.0`) are pinned via `package.json`
  `overrides`, removing the deprecated `boolean`/`global-agent`/`roarr` chain and moving asar
  packing off `glob@7`/`inflight`.
- `rimraf@2.6.3`, `glob@7.2.3`, and `inflight@1.0.6` remain, reachable only through `temp` via
  `electron-winstaller`/`electron-builder-squirrel-windows` — a required peer of `app-builder-lib`
  loaded solely for the Squirrel.Windows target, which this project does not build. No newer
  `temp` exists, and `temp` calls `rimraf` with the legacy callback API that `rimraf@4+` dropped,
  so overriding it would break Squirrel support rather than fix a live code path. `npm audit`
  remains at zero vulnerabilities.

## 0.1.0

- Initial local-first trajectory and TSPI workbench baseline.
