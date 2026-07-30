# JDDC Glass Canopy Reference — MFD Page & Bezel Layout

How the Joint Domain Data Compiler reads if you treat it as a single multi-function display (MFD) in a one-seat cockpit rather than a web app with tabs. This is not a metaphor bolted on after the fact — the actual interaction model (one screen, mode pages selected by a bezel strip, a permanent message queue, everything else inline) already behaves like flight-deck avionics more than it behaves like a SaaS dashboard, so the vocabulary below maps onto real UI mechanics one-to-one, not decoratively. Every page, control, and rule described here exists in `src/App.tsx` and `src/ui/*` today.

There is one MFD. JDDC does not pop secondary windows, does not route between screens, and does not hide the instrument panel while you work a page — a solo engineer flying a data-reduction mission needs the caution panel and the loaded-track list in view no matter which page is up front. Think single-seat, single-display cockpit, not a multi-crew glass suite with a shared bus.

## 1. Panel geography

```
┌───────────────────────────────────────────────────────────────────────────┐
│  [JD]  JOINT DOMAIN DATA COMPILER              ● 3 TRACKS ON FILE          │  status bar
│        TSPI CONVERSION / ANALYSIS SUITE                                    │
├───────────────┬──────────────────────────────────────────────────────────┤
│               │ IMPORT XLATE STATUS TSD TREND DATA TAC 3D MX MSN XPORT   │  page-select bezel
│  [LOAD TRACK] │ TRACKS FUSION                                f16.gpx      │
│               ├──────────────────────────────────────────────────────────┤
│  ● track A    │                                                          │
│    track B    │             < selected page renders here >               │  page face
│    track C    │                                                          │
│  ─────────────│                                                          │
│  FORMATS ON   │                                                          │
│  FILE: GPX    │                                                          │
│  CSV KML …    │                                                          │
├───────────────┴──────────────────────────────────────────────────────────┤
│ LVL▾ [filter…] ☑ AUTOSCROLL   0 FLT 0 CTN 128 MSG   EXPORT  CLEAR         │  CAS message queue
│  12:41:03 INFO  import   Analyzed track.gpx: 6 columns                   │
└───────────────────────────────────────────────────────────────────────────┘
                     [ MASTER CAUTION FLASH: "Loaded 4,281 points…" ]
```

Four fixed instruments, none of which the pilot can dismiss, resize away, or cover with a page:

1. **Status bar** (~58px). Brand roundel, mission title, and a right-hand slot that alternates between the loaded-track count and a `Spinner` the instant any blocking operation (CSV analysis, dataset build) is in flight. This is the one strip that never changes shape regardless of what page is selected.
2. **Panel body.** A fixed horizontal split — track library column on the left, active page on the right. Everything below the status bar and above the message queue lives here.
3. **CAS message queue** (fixed 220px, permanently mounted `LogConsole`). This is not a page and there is no bezel key that closes it — it runs on Crew-Alerting-System doctrine: a scrolling, always-visible log of what the data pipeline is actually doing, because on an engineering instrument, trusting the pipeline matters more than reclaiming 220 vertical pixels. Every parse, transform, and export writes a line here whether or not the pilot is watching.
4. **Master caution flash.** One transient, non-blocking annunciation, centered, floating just above the message queue, self-extinguishing after ~3.2 seconds. Exactly one is ever lit; a new event overwrites the old rather than queuing behind it.

There are only two pop-up cards in the whole suite (the mission-debrief report dialog and native browser confirm prompts for two irreversible actions) — see §6. Every other control lives directly on its page face. No page ever opens a floating sub-window to get work done.

## 2. Track library column (left rail, 256px, narrows to 210px under 1100px width)

This column is orthogonal to the page-select bezel — it answers "what tracks are loaded" while the bezel answers "what am I doing with the one that's active," and both stay lit regardless of the other:

- **`[LOAD TRACK]`** — a single high-emphasis bezel key, filled with the suite's designate-orange gradient (the same visual weight class as the EXEC keys described in §4/§9). Opens the native file picker. This and drag-and-drop onto the IMPORT page are the only two ways data enters the mission.
- **Track library list** — one line per loaded dataset: name, source format, point count (`gpx · 4,281 pts`), inline `×` to strike it from the library. Selecting a line designates that track as *ownship-active* — every single-track page (STATUS, TSD, TREND, DATA, 3D, MX, XPORT) now describes it. The active line gets an orange border and lighter fill, the same "designated" visual used everywhere else in the suite. If the pilot is parked on IMPORT/XLATE when a new line is designated, the display auto-slews to STATUS. No drag-reorder, no folders — the library is a flat, session-scoped stack.
- **Formats-on-file footer** — a static capability placard pinned to the bottom of the column (GPX · CSV · GeoJSON · KML · NMEA · GPB), separated by a hairline. Read-only, always the same regardless of what's loaded.

## 3. Page-select bezel

A single row of plain text bezel keys (no icon-only keys, no nested menu, no hamburger) — one flat strip that scrolls sideways if the display is narrower than its contents. Thirteen keys, fixed left-to-right order, each either **lit** (available) or **dark** (inhibited — rendered dimmed, non-clickable, but never removed from the bezel):

| Key position | Page | Lights up when |
|---|---|---|
| 1 | IMPORT | always lit |
| 2 | XLATE (CSV field mapping) | a CSV/TSV is holding for column translation |
| 3 | STATUS (Overview) | a track is designated active |
| 4 | TSD (Map) | a track is active, or the on-disk overlay library has content |
| 5 | TREND (Charts) | a track is active |
| 6 | DATA (Table) | a track is active |
| 7 | TAC (Compare) | ≥2 tracks on file |
| 8 | 3D | a track is active |
| 9 | MX (Transform) | a track is active |
| 10 | MSN (Project) | ≥1 track on file |
| 11 | XPORT (Export) | a track is active |
| 12 | TRACKS (Sources) | ≥1 track on file |
| 13 | FUSION | ≥2 tracks on file |

A dark key is a promise, not a secret — the full capability set of the machine is visible on first boot even with nothing loaded, the same way a fighter's MFD bezel shows every page button whether or not that sensor is currently powered. A new operator scanning the strip cold learns the whole mission envelope (TAC, FUSION, 3D, TRACKS) before loading a single file.

The active key gets a 2px underline rather than a filled cap — the *only* place in the suite that uses an underline for "currently selected" instead of a fill change; every chip and button elsewhere fills solid when active. To the right of the last key sits a monospace tail readout pinning the active track's filename, because TAC/TRACKS/FUSION/MSN can describe several tracks at once while every other page is scoped to the single designated one — the readout is the pilot's constant answer to "which track is STATUS/TSD/TREND/DATA/3D/MX/XPORT currently painting."

Selecting any of the seven "working" pages (STATUS, TSD, TREND, DATA, TAC, 3D, MX) is itself logged into the persisted mission state (`lastWorkspaceTab`) and marks the mission file dirty — reopening a saved mission returns you to the exact page you left, the same way a saved avionics config restores your last-selected MFD page on power-up.

## 4. Shared symbology — the instrument logic that runs under every page

Four conventions recur on almost every data-bearing page (STATUS, TSD, TREND, DATA, 3D, TAC) and are what make the thirteen pages read as one instrument rather than thirteen apps sharing a window:

- **Designation vs. lock.** One shared cursor state (`usePointSelection` under the hood) — a single point index, index range, time range, or segment set — is slaved across DATA, TREND, TSD, and 3D at once. Line-selecting a row, brushing a range on TREND, clicking a mark on TSD, or picking a vertex in 3D all write to the same designation, and every other page snaps its own highlight to match instantly. A designation renders as a small removable chip in each page's control strip (`selected #482 ×`, `range 120–340 ×`); striking the × on any one chip clears the designation fleet-wide.
- **Acquisition cursor.** Separate from designation: hovering a row, a TREND sample, or a 3D vertex broadcasts a lightweight, uncommitted cursor that TSD and 3D paint in cyan (`#38bdf8`) — distinct from the committed-designation color (orange) and the range color (amber). Acquisition is "where you're looking," designation is "what you've locked in," and the suite never lets the two colors collide.
- **Fault flags.** Gaps, duplicate timestamps, coordinate jumps, invalid fixes, and elevation spikes/flatlines (`detectQualityEvents`) get one consistent flag treatment everywhere they can appear: dashed/colored tick marks on TREND's axis, amber/red circle marks with tooltips on TSD, break marks along the 3D path, and a `⚠` flag with a highlighted row on DATA. A data fault spotted on one page is already flagged on all the others — nothing is rediscovered per-page.
- **Maintenance log vs. flight recorder.** MX page undo/redo behaves like a maintenance action stack — fast, interactive, snapshot-based, forgets nothing but also proves nothing. Running alongside it is a separate, append-only verified operation history that can be *replayed* deterministically against the original as-loaded track, the way a flight data recorder lets you rebuild a flight from raw parameters rather than trusting a technician's notes. Interactive undo answers "let me back out of that"; replay answers "prove this exact procedure reproduces against a fresh track" (used for saved procedures/recipes and cross-session repeatability). Two different guarantees, kept deliberately separate rather than collapsed into one history.

Suite-wide, page-agnostic behavior:
- **Busy annunciation** — the status-bar track counter is bumped off by a spinner+label during any blocking op (CSV analysis, dataset build); a slim progress strip appears at the top of the page face for cancellable long runs (CSV build, GPX worker export), with an inline Cancel key.
- **Master caution flash** fires for every load, transform, export, or mission action — success or fault.
- **HOTAS-style cursor slew** on STATUS/DATA/TREND/3D: ←/→ walks the slaved cursor, Shift+←/→ extends a range, Enter commits the cursor to a hard designation, Home/End jumps track ends, Escape clears — documented directly in-panel on the STATUS page next to the block it drives.
- **Drop-anywhere-it-makes-sense loading** — IMPORT's dropzone is the primary target, but the drop handler itself sniffs format and accepts a multi-file drop, routing each file independently down the XLATE-required or direct-parse path.

## 5. Page-by-page

### IMPORT (`ImportView.tsx`)
The cold-start page. A single centered column (~920px max), dominated by a large dashed dropzone — click-to-browse or drag-and-drop onto the same target, a gently bobbing down-arrow, "Drop TSPI data here / or click to browse," and a row of format placards (GPX, CSV, GeoJSON, KML, NMEA, GPB) each carrying its label and primary extension. Below it, a static "conversion matrix" card explains the normalize-once/export-anywhere model in prose and lists accepted coordinate/timestamp formats. No table, no config, no readouts — this page has exactly one job (get a file onto the bus) and looks like a splash screen as much as a working page.

### XLATE (`MappingPanel.tsx`)
Reachable only mid-flow, auto-selected the instant a CSV/TSV is dropped. A field-translation form: detected columns get auto-suggested into semantic roles (latitude, longitude, elevation, timestamp, name, description) by best-guess scoring, each with a manual override `<select>` laid out in an auto-fill grid, a summary strip of the current mapping, a conditional amber swap-hint banner if lat/lon look transposed, a header-row toggle, and a teal **Build dataset** EXEC key — visually distinct from the orange LOAD key in the library column, because on this suite teal is reserved exclusively for "commit this to a real dataset," never for "select/start."

### STATUS (`StatsPanel.tsx`)
The track's home page — auto-selected the instant a track is designated. Top to bottom:
1. An 8-tile readout grid (Points, Valid coords, Distance, Duration, Avg rate, Max speed, Elev gain, Elev range), each a large monospace value stacked over a small uppercase label — a classic multi-parameter status tile bank.
2. **Provenance block** — source filename/size, accepted-points/warning counts, a sha256 checksum (truncated, full value on hover), parser id+version, coordinate/altitude/time reference metadata.
3. **Waypoint bookmarks** — add-current-cursor-as-bookmark input+key, then a jump-to list with inline strike (×).
4. **Cursor/range controls** — datetime-local start/end pickers for a time-range designation, plus clickable **leg chips** (auto-detected flight/data-state segments) each showing kind, index span, point count. The HOTAS cursor-slew help line sits directly under this block, since it's what that shortcut set drives.
5. A two-column readout: left = a fault checklist (✓/! against coordinate validity, timestamps present, time monotonic, elevation present, duplicate coordinates) plus a fault-events summary and mission warnings; right = a per-channel stats table (n / min / max / mean / σ).

### TSD — Tactical Situation Display (`MapView.tsx` + `MapOverlayPanel.tsx`)
The Map page, read the way a horizontal-situation/tactical-situation page reads on a real MFD. A collapsible overlay drawer sits above the control strip (KML/KMZ overlay management — add/toggle/reorder/opacity/remove, per-overlay status for missing/error) — collapsed by default so the picture itself is what a pilot sees first. The control strip: display-mode select (Path+Points / Path only / Points only), basemap select (OpenStreetMap or an offline grid), color-by-channel select, a gap-split-minutes field, three fit keys (Fit active / Fit visible (N) / Fit range), a live valid/drawn point count, designation chips, a color-legend gradient when a channel is active, and — when the tile service is unreachable — a banner with a one-key fallback to the offline grid. Map tiles are the suite's *only* network dependency, and the page degrades gracefully rather than failing dark. Below the strip, a full-bleed Leaflet canvas (min-height 440px) paints the ownship path (split at detected gaps/jumps), other tracks as dashed non-interactive overlays each in their own color, fault-event circle marks with tooltips, a distinct start (green) / end (red) mark pair, and the shared acquisition/designation cursors.

### TREND (`TimeSeriesChart.tsx`)
The Charts page — one multi-channel strip-chart surface, not a bank of small multiples, the way an engine-trend page overlays several parameters on one time base rather than tiling them. A control strip of channel-toggle chips (colored dot + label, click to show/hide a trace), an x-axis mode select (time / source-index / cumulative distance), zoom/pan/reset, and a live cursor-readout strip along the bottom showing every visible channel's instantaneous value. Fault events render as small colored tick marks on the axis with hover tooltips and a compact legend. Dragging a range directly on the trace drives the shared range designation — no separate control needed.

### DATA (`DataTable.tsx`)
The Table page, treated as a raw maintenance-data readout — virtualized/windowed (fixed 26px rows, overscan-8), because tracks run tens of thousands of points deep. Control strip: search-filter, live "`N` / `M` rows" counter, "Export visible CSV" (exports exactly the filtered/sorted view on screen, not the whole track), a "faults only" checkbox (appears only when faults exist), a "next fault" jump key, a "designated range only" checkbox (appears only with an active range), and the standard designation chips. Column heads cycle asc → desc → none on click with a small triangle indicator. Fault-flagged rows get a left-edge amber bar and a `⚠` on the index cell; designated/acquisition-cursor/in-range rows each carry their own background treatment, all legible simultaneously.

### TAC — Tactical / Deconfliction (`ComparisonPanel.tsx`)
The Compare page, structured exactly like an intercept-geometry readout: reference/target track pickers, an alignment mode (nearest-time vs. interpolated) with tolerance/gap and manual time-offset controls, then computed relative-position analytics — local-ENU relative position, horizontal/slant range, bearing, vertical separation, closure rate, and a closest-point-of-approach summary line. Before any of that renders, a compatibility gate checks whether the two tracks' time/altitude reference metadata are even comparable, and blocks or warns using the same amber/red convention used everywhere else in the suite rather than failing silently — you don't get a geometry solution built on incompatible references.

### 3D — Synthetic Perspective (`Trajectory3dPanel.tsx`)
A hand-rolled 2D-canvas perspective/orthographic renderer (no WebGL, no external 3D engine) filling most of the page — a synthetic-vision-style page rather than a literal photoreal one. Control strip above: altitude-exaggeration field, color-channel select, projection select, gap-split-seconds field, ground-grid/vertical-curtain/points checkboxes, and camera presets (Reset / Top / Side / Fit trajectory). A **playback transport** below: Play/Pause, Restart, a scrub slider, a speed select (0.25×–4×), and a live percentage readout. Pointer-drag orbits the view (shift/right-drag pans), wheel zooms. Compatible companion tracks render simultaneously in a shared local-ENU frame, fixed purple, with an explicit count and an "excluded — incompatible reference" warning where relevant. A 6-tile readout grid (source points, valid coordinates, rendered vertices, east/north/up span) sits at the bottom with a one-line reminder of the orbit/pan/zoom gesture set.

### MX — Maintenance / Data Conditioning (`TransformPanel.tsx` + `NotionalSmoothingPanel.tsx`)
Two stacked sections. First, an operation-card grid — one card per available conditioning action (sort by time, swap coordinates, dedupe/drop-invalid, decimate, simplify, moving-average/median/Hampel/EMA smoothing, time/elevation shift, elevation-outlier removal, fixed-rate resample), each with a short description and its own numeric/checkbox controls anchored to the card's bottom edge. Above the grid: Undo/Redo keys gated on real history availability, a collapsible maintenance-action log with a "replay verified history" action (disabled, with a stated reason, when no replay-safe as-loaded snapshot exists), and a saved-procedures list (Load / Replay / Delete-with-confirm). Second, a separate notional-gap-fill smoothing block that produces a *new* derived track rather than editing the active one in place — destructive conditioning and generative/derivative conditioning are kept visually and functionally separate.

### MSN — Mission File (`ProjectPanel.tsx` + `ReportExportDialog.tsx`)
Save/reopen a bounded `.jddc-project` mission file (every loaded track, undo/redo history, display settings, bookmarks, operation history, page-select state) via a file input and a download key, a mission name/notes field, a dirty-state flag, and a key that raises the suite's one real pop-up: the **debrief-card dialog**. That dialog is a checklist form for choosing what the printed card includes (stats, fault evidence, warnings, waypoint bookmarks, conditioning history) before generating a self-contained, print-ready HTML debrief in a completely different, light "VectorPunk/HUD" visual system (full detail in the theme reference) — deliberately not a reskin of the cockpit's own dark glass, because the card is meant to leave the cockpit and be read on paper or by someone who never sat in the seat.

### XPORT (`ExportPanel.tsx`)
A strict two-column page. Left column: a 2×N grid of format placards (GPX, CSV, GeoJSON, KML, GPB — click to select, active state = teal border/tint) above an options block (output filename + extension tag, format-specific options — for GPX: sort-by-time / include-extensions / BOM / coordinate-precision — plus conditional warning banners and a mandatory acknowledgment checkbox if the track contains notional/interpolated points, which hard-blocks the XPORT key until checked). Right column: a live preview pane (monospace, first ~1.4KB of the serialized output, scrollable) — a look at the actual bytes before you commit to the download, not a description of them. Large GPX jobs transparently route through a chunked, cancellable worker with an inline progress line and Cancel key standing in for the Export key while it runs.

### TRACKS (`SourcesPanel.tsx`)
The simplest page on the bezel: a compact table (active-marker dot, color swatch, name, format, point count, visibility checkbox, "Make active" key) that controls purely cosmetic multi-track display state — which non-active tracks paint as extra colored paths on TSD, and in what color. The page states its own boundary directly in-panel: visibility is display-only and never touches or removes a track.

### FUSION (`FusionPanel.tsx`)
Multi-source auto-combine workflow that produces a new fused track plus a persisted fusion-evidence record per run — an expandable block showing source registrations and grouping/report detail — viewable and reopenable later in the same session. This is sensor-fusion in the literal avionics sense: multiple independent tracks reconciled into one composite picture, with the reconciliation logic left auditable rather than opaque.

## 6. Pop-ups, positive-confirmation gates, and hard faults

- **The one real pop-up** (`dialog-backdrop`/`dialog`, max-width 560px, own internal scroll) is the debrief-card export dialog described under MSN. It is used nowhere else — every other page keeps its state inline, which is what keeps the suite feeling like one cockpit rather than a stack of dialogs.
- **Positive-confirmation gates** — native `window.confirm()` prompts, used sparingly, only for the two genuinely irreversible actions in the suite: deleting a saved procedure/recipe, and deleting a KML/KMZ library file. Rather than a bespoke confirm card for every destructive action, the suite reuses the browser's own challenge-response prompt for just these two.
- **Hard-fault screen** (`ErrorBoundary`) — if a render error escapes containment, the entire cockpit face is replaced by a full-viewport, red-bordered fault card rather than one page quietly going blank. On a data tool, a crash mid-analysis needs to be unmistakable, not silently contained to one page while the pilot keeps trusting the rest of the display.

## 7. Ground rig vs. airborne rig — desktop vs. browser

Same cockpit, two rigs, with exactly two conditional differences, both gated on `isDesktopKmlLibraryAvailable()`:
- **Persistent overlay library** — the Electron build saves imported KML/KMZ files to disk so they remain available as TSD overlays across sessions; the browser build has no persistent filesystem, so this capability simply doesn't surface there.
- **TSD available cold** — on desktop, the TSD (Map) key can light up even with zero tracks loaded, purely so the pilot can browse the persistent overlay library without first loading a track. In-browser, TSD follows the normal "needs an active track" rule.

No other page, key, or control differs between the two rigs — it is the same avionics suite either way, minus one piece of persistent storage the browser platform can't offer.
