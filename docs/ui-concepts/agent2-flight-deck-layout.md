# JDDC — Interface Principles & Instrument Map

*How the Joint Domain Data Compiler is put together, and why it holds its shape.*

JDDC is one screen. Not a wizard, not a multi-window suite, not a dashboard-of-dashboards — one dense, fixed-frame workbench that reconfigures its center panel through thirteen tabs. That constraint is not a limitation to design around; it's the whole point. A solo engineer working a flight-telemetry problem doesn't want to hunt across windows for the log stream or lose track of which dataset is active. So JDDC commits, hard, to a single frame: header, sidebar, tab strip, log dock, always in the same place, always visible, never negotiated away by whatever tool happens to be open in the middle.

Everything below follows from that one commitment.

---

## Principle 1 — Four fixed instruments, one frame

The shell never moves. Four regions, stacked, none of them collapsible into each other:

```
┌──────────────────────────────────────────────────────────────┐
│ HEADER — brand, title, live status (spinner ⇄ "N loaded")     │
├───────────┬────────────────────────────────────────────────────┤
│ SIDEBAR   │ TAB STRIP — 13 tabs, underline-selected            │
│ (datasets)│ ────────────────────────────────────────────────── │
│ 256px     │ ACTIVE PANEL                                        │
│           │ (fills remaining space)                             │
├───────────┴────────────────────────────────────────────────────┤
│ LOG DOCK — 220px, permanent, not a tab, cannot be closed        │
└──────────────────────────────────────────────────────────────┘
              [ toast — floats above the dock, ~3.2s, one at a time ]
```

Read that dock line again: it is *not a tab*. In most tools, a console/log view is something you open. In JDDC it's structural — bolted to the bottom of the frame at a fixed 220px regardless of what's happening above it, because the product's trust model depends on the pipeline being legible at all times. An engineer importing 40,000 points of GPX needs to see "6 columns analyzed" scroll past whether they're looking at the Map tab or the Transform tab. Hiding that behind a toggle would quietly say "you don't need to watch this" — and for a data-integrity tool, that's the wrong message to send.

The header is the only region that changes shape based on state: its right-aligned slot swaps between a passive "3 datasets loaded" counter and an active `Spinner`, the same real estate doing two jobs depending on whether the app is idle or busy. One toast exists at a time — a second one replaces the first rather than stacking — because notification queues are a symptom of a UI that doesn't trust its own log dock to carry the detail.

## Principle 2 — Two axes, not one funnel

The sidebar and the tab strip look adjacent but they are answering two completely different questions, and JDDC is careful to keep them decoupled rather than collapsing them into a single linear "step 1, step 2, step 3" flow.

The **sidebar** (256px, narrowing to 210px under 1100px width) answers *"what data do I have loaded, right now, in this session?"* — a flat, unordered list, one row per dataset (`name`, `format · point count`, inline `×` to remove), the active row picked out with an accent border and lighter fill. No folders, no drag-reorder, no grouping — datasets in JDDC are a working set, not a library to be organized. Above the list sits the sidebar's one piece of primary action: **`+ Load data`**, full-width, orange-gradient, the highest-emphasis button outside of the two "commit" actions elsewhere in the app. Below the list, a quiet reference footer pins the supported format badges (GPX · CSV · GeoJSON · KML · NMEA · GPB) so the answer to "does it read my file format" never requires opening a menu.

The **tab strip** answers a completely different question: *"what am I doing with the active dataset right now?"* Clicking a dataset row auto-jumps to Overview if you were parked on Import/Mapping — the sidebar hands off to the tab strip, but the reverse never happens. These two rails are orthogonal on purpose: swap the active dataset without losing your place in Charts; switch from Charts to Compare without touching which dataset is active. A single linear wizard would force you to pick one axis at a time. JDDC gives you both, permanently, side by side.

## Principle 3 — Show the whole instrument panel, dim what isn't ready

All thirteen tabs render all the time, in fixed order. Nothing is hidden behind progressive disclosure. A tab that isn't usable yet — because no dataset is active, or fewer than two are loaded — renders dimmed and inert rather than disappearing:

| # | Tab | Unlocks when |
|---|-----|--------------|
| 1 | Import | always |
| 2 | CSV Mapping | a CSV/TSV is pending column mapping |
| 3 | Overview | a dataset is active |
| 4 | Map | a dataset is active — or the desktop KML/KMZ library has content |
| 5 | Charts | a dataset is active |
| 6 | Table | a dataset is active |
| 7 | Compare | ≥2 datasets loaded |
| 8 | 3D | a dataset is active |
| 9 | Transform | a dataset is active |
| 10 | Project | ≥1 dataset loaded |
| 11 | Export | a dataset is active |
| 12 | Sources | ≥1 dataset loaded |
| 13 | Fusion | ≥2 datasets loaded |

This is a deliberate bet: showing someone "Compare," "Fusion," and "3D" sitting there, greyed out, on their very first launch — before they've loaded a single file — teaches the full shape of the product in one glance. It's a promise ("this is everything you get") rather than a mystery box that reveals itself feature by feature. The cost is a slightly busier tab strip on day one; the payoff is that nobody discovers Fusion by accident three months in.

Selection itself is understated: the active tab gets a 2px underline, not a filled background — the one place in the whole app where "selected" is signaled by a line rather than a fill. Everything else (chips, buttons) fills; only tabs underline. And to the right of the last tab, a small monospace label permanently pins the active dataset's filename, because several tabs (Compare, Sources, Fusion, Project) show multi-dataset context while the rest of the strip is scoped to one active dataset — the label is a standing answer to "wait, which file is this."

Switching between the seven "workspace" tabs (Overview, Map, Charts, Table, Compare, 3D, Transform) writes into the durable project state (`lastWorkspaceTab`) and marks the project dirty. A tab choice isn't ephemeral UI state here — it's saved, reopened, and resumed exactly where you left it, because a project archive is meant to pick up a real train of thought, not just restore files.

## Principle 4 — One selection, felt everywhere

This is the connective tissue that makes thirteen tabs feel like one instrument rather than thirteen separate apps bolted together.

**Selection is a single shared model** (`pointIndex` / `indexRange` / `timeRange` / `segmentIds`), not per-panel state. Click a row in Table, drag a range on the Chart, click a marker on the Map, pick a vertex in 3D — all four write to the same selection, and all four other views light it up simultaneously. It surfaces as a small dismissible pill in each panel's toolbar (`selected #482 ×`, `range 120–340 ×`); pull the × on any one of them and it clears everywhere at once. There's no "sync my selection" button because there's only ever one selection to begin with.

**Hover is a second, lighter channel**, deliberately kept separate from selection so a passing glance never mutates committed state. Hovering a table row, chart point, or 3D vertex broadcasts a transient cursor position that Map and 3D render in a distinct cyan (`#38bdf8`) — visually unmistakable from the orange of a committed selection or the amber of a committed range. Three states, three colors, one glance to tell them apart.

**Data-quality problems get the same universal treatment.** Gaps, duplicate timestamps, coordinate jumps, invalid coordinates, elevation spikes and flatlines are detected once (`detectQualityEvents`) and rendered everywhere consistently: dashed chart-axis markers, amber/red circle markers with tooltips on the Map, break markers on the 3D path, a `⚠` flag with a highlighted row in Table. Find a bad point once, and you've found it in every view — the tool never makes you re-discover the same defect twice.

**Keyboard nav rides the same rail** across Overview, Table, Charts, and 3D: `←/→` moves the synced cursor, `Shift+←/→` extends a range, `Enter` commits the cursor as a real selection, `Home`/`End` jump to track ends, `Escape` clears. One vocabulary, four surfaces.

## Principle 5 — Two different pasts, two different tools

The Transform tab runs two independent history systems side by side, because "undo" and "reproducibility" are not the same problem:

- **Undo/redo** is fast, interactive, snapshot-based — press Undo, get the dataset back exactly as it was one step ago. This is for the moment-to-moment "wait, that decimate was too aggressive" correction.
- **Verified operation history** is a separate, explicit record that can be *replayed* deterministically against the original source snapshot — this is what backs named, reusable recipes and cross-session repeatability. It's disabled with a plain-language explanation whenever no replay-safe source snapshot exists, rather than silently failing or faking a result.

Conflating these into one mechanism would either make undo sluggish (recomputing a full pipeline for a single step back) or make recipes untrustworthy (replaying an approximation rather than the literal operation sequence). JDDC keeps them apart on purpose.

## Principle 6 — Almost nothing is a dialog

JDDC's whole surface is built to avoid context-switching. There are exactly two exceptions to "everything is inline, in-panel state": the **Report Export** dialog (a checklist form for the Project tab's print-report generator) and native `window.confirm()` prompts, reserved for a small number of truly irreversible actions — deleting a named recipe, deleting a KML/KMZ library entry. That's the entire modal surface of the app. No confirmation dialog for routine actions, no wizard-style multi-step overlay, no settings panel floating over the workspace. If it's not one of those two things, it lives in the panel you're already looking at.

A full-viewport `ErrorBoundary` card (red-bordered) is the one deliberate exception to "never take over the whole screen" — appropriate, because a render error escaping mid-analysis is exactly the kind of thing that should be unmistakable rather than quietly swallowed into one broken tab.

---

## The thirteen instruments

Each tab gets exactly one job. None of them try to be a dashboard of everything.

**1 · Import** — A landing screen as much as a tool. One centered column, one large dashed dropzone (click-to-browse or drag-and-drop onto the same target), a bobbing down-arrow, format pills for GPX/CSV/GeoJSON/KML/NMEA/GPB, and a static "conversion matrix" note explaining the normalize-once/export-anywhere model in prose. No table, no config, no decisions — get a file in, then get out of the way.

**2 · CSV Mapping** — Only reachable mid-flow, auto-opened the instant a CSV/TSV lands. Detected columns get auto-suggested into semantic roles (lat/lon/elevation/timestamp/name/description) via best-guess scoring, each with a manual override dropdown in a responsive field grid. An amber banner appears if lat/lon look swapped. The **Build dataset** button is teal — the first place in the app you meet the teal/orange split, and it's not incidental: this button *commits* a dataset into existence, so it gets the "commit" color, not the "start" color the Load button used two screens ago.

**3 · Overview** — The dataset's home base, auto-selected the moment import finishes. An 8-tile metric grid (Points, Valid coords, Distance, Duration, Avg rate, Max speed, Elev gain, Elev range) sits at the top, monospace numbers over small labels. Below it: an import-provenance block (filename, size, sha256, parser id/version, coordinate/time reference metadata); a bookmarks list (name-and-jump, add-current-point, inline remove); selection controls (datetime start/end pickers plus clickable auto-detected segment chips, with the keyboard-shortcut cheat line living directly beneath since it's the section the shortcuts act on); and finally a two-column quality/statistics split — a checklist of data-integrity checks on the left, a per-channel stats table (n/min/max/mean/σ) on the right.

**4 · Map** — A collapsible overlay drawer (KML/KMZ management: add, toggle, reorder, opacity, remove) sits above the main toolbar, collapsed by default so the map itself is the first thing you see. The toolbar packs a lot into one wrapping row: display mode (Path+Points / Path only / Points only), basemap choice (OpenStreetMap or an offline grid fallback), color-by-channel, a gap-split-minutes field, three fit buttons, a live point count, selection chips, and a color legend when a channel is active. If tiles fail to load, a banner offers one-click fallback to the offline grid — tiles are the app's *only* network dependency, and it degrades gracefully rather than pretending the map still works. Below all that: a full-bleed Leaflet canvas rendering the path (segment-split at detected gaps), other datasets' overlay tracks (dashed, non-interactive), quality-event markers, a green start / red end marker pair, and the shared hover/selection cursors.

**5 · Charts** — One continuous multi-channel SVG surface, not a grid of small multiples. Channel chips (colored dot + label) toggle series visibility; an x-axis mode selector switches between time, source-index, and cumulative distance; zoom/pan/reset controls sit alongside a bottom readout strip that live-updates per-channel values under the cursor. Quality events show as small colored ticks along the axis with hover tooltips. Dragging a range directly on the chart *is* how you set the shared selection range here — the chart is an input device, not just a display.

**6 · Table** — Virtualized to handle tens of thousands of rows (fixed 26px rows, 8-row overscan). Toolbar carries a search filter, a live "N / M rows" counter, an "Export visible CSV" button (exports the filtered/sorted view exactly as shown, not the whole dataset), a "quality events only" checkbox, a "next quality event" jump, a "selected range only" checkbox, and the standard selection chips. Column headers cycle asc → desc → none on click. Rows with a quality event carry a left amber bar and a `⚠` on the index cell — stacked cleanly alongside selected/hovered/in-range background states, all legible at once.

**7 · Compare** — Reference/target dataset pickers, an alignment mode (nearest-time vs. interpolated) with tolerance/gap and manual time-offset controls, then the payoff: relative-position analytics in a local ENU frame — horizontal/slant range, bearing, vertical separation, closure rate, a closest-approach summary line. If the two datasets' time or altitude reference metadata isn't actually comparable, a compatibility guard blocks or warns *before* showing numbers, using the same amber/red convention as everywhere else rather than quietly producing a nonsensical comparison.

**8 · 3D** — A hand-built 2D-canvas perspective/orthographic scene — no WebGL, no three.js. Toolbar above: altitude exaggeration, color-by-channel, projection mode, gap-split-seconds, ground-grid/vertical-curtain/points toggles, and camera presets (Reset / Top / Side / Fit trajectory). A playback transport below: Play/Pause, Restart, a scrub slider, speed select (0.25×–4×), live percentage readout. Drag orbits, shift/right-drag pans, wheel zooms. Compatible companion datasets render in the same scene in a fixed purple with an explicit count and an "excluded" warning line when a dataset's reference frame doesn't match. A 6-tile metric footer (source points, valid coordinates, rendered vertices, east/north/up span) plus a one-line gesture reminder closes the panel out.

**9 · Transform** — Two stacked sections. First, an operation-card grid — one card per transform (sort by time, swap coordinates, dedupe/drop-invalid, decimate, simplify, moving-average/median/Hampel/EMA smoothing, time/elevation shift, elevation-outlier removal, fixed-rate resample), each with its own inline controls anchored to the card's bottom edge. Above the grid: Undo/Redo (gated on real history), a collapsible operation-history log with "Replay verified history," and a named-recipes list (Load / Replay / Delete-with-confirm). Second, a separate notional-gap-fill smoothing panel that produces a *new* derived dataset rather than mutating the current one — the app draws a hard line between destructive in-place transforms and generative derivative ones, and keeps them in visually separate sections so that line is never accidentally crossed.

**10 · Project** — Save/reopen a bounded `.jddc-project` archive: all datasets, undo/redo history, display settings, bookmarks, operation history, workspace view state, round-tripped through a file input and download action. A name/notes editor and dirty-state indicator sit alongside a button that opens the app's one real dialog — **Report Export** — a checklist form for choosing what a generated report includes (stats, quality evidence, warnings, bookmarks, transform history) before rendering a self-contained, print-ready HTML document in the separate light "VectorPunk/HUD" system (covered in the theme document) — deliberately not a reskin of the dark workbench, because it's built for a different reader in a different medium.

**11 · Export** — A strict two-column split. Left: a 2×N grid of format cards (GPX, CSV, GeoJSON, KML, GPB — click to select, teal border/tint when active) above an options block (filename + extension, format-specific options like GPX's sort-by-time/include-extensions/BOM/coordinate-precision, conditional warning banners, and — if the dataset contains notional/interpolated points — a mandatory acknowledgment checkbox that hard-blocks Export until checked). Right: a live monospace preview of the first 1.4KB of the actual serialized output, scrollable, so you're checking real bytes before committing to a file, not trusting a description of what the export *should* look like. Large GPX exports route through a cancellable chunked Worker, swapping the Export button for an inline progress line + Cancel in place.

**12 · Sources** — The simplest tab in the app: a compact table (active-dot, color swatch, name, format, point count, visibility checkbox, "Make active" button) governing purely cosmetic multi-dataset display — which non-active datasets show up as extra colored paths on the Map, and in what color. It says so directly, in-panel: visibility is display-only, and never changes or deletes a dataset.

**13 · Fusion** — A multi-source auto-combine workflow that produces a new fused dataset and a persisted fusion-evidence record per run — an expandable detail block showing source registrations and grouping/report detail, viewable and reopenable for the rest of the session. The audit trail is treated as a first-class output alongside the fused data itself.

---

## Desktop and browser: one interface, two capability gates

The Electron build and the browser build render the identical UI. Exactly two things differ, and both are gated behind a single capability check (`isDesktopKmlLibraryAvailable()`):

- A **persistent KML/KMZ overlay library** — imported KML/KMZ files are written to disk and remain available as map overlays across sessions. The browser build has no persistent filesystem access, so this simply doesn't appear there; it isn't disabled-and-visible like a locked tab, it's absent.
- The **Map tab stays enabled with zero datasets loaded**, on desktop only, purely so the persistent library can be browsed on its own.

Nothing else — no panel, no tab, no control — differs between the two shells. The product is one build target philosophically, with a narrow, well-understood seam where the desktop shell's disk access buys it a little more.
