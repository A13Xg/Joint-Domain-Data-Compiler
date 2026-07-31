# JDDC UI Layout & Workflow Reference

Authoritative description of the Joint Domain Data Compiler's current interface, as implemented in `src/App.tsx` and `src/ui/*`. This documents the single-user engineering-workbench UI for importing, inspecting, transforming, comparing, visualizing and exporting TSPI (time-space-position-information) trajectory data — fighter-jet flight telemetry as the primary domain, with equal support for ~0 ft AGL ground tracks (the model makes no altitude-band assumptions; "ground track" is just a track whose elevation channel hovers near the local ellipsoid/terrain reference).

There is exactly one top-level screen. JDDC is not a multi-window, multi-route application — it is a single dense workbench that reorganizes its center panel via a tab strip. This is a deliberate consequence of the product's audience (a solo engineer doing focused data work) and keeps all cross-cutting context (loaded datasets, log console) permanently visible regardless of which tool the user is using.

## 1. App shell (top to bottom, left to right)

```
┌───────────────────────────────────────────────────────────────────────────┐
│  [JD]  Joint Domain Data Compiler                    ● 3 datasets loaded  │  ← app-header
│        TSPI flight-data conversion & analysis workbench                   │
├───────────────┬─────────────────────────────────────────────────────────── │
│               │  Import  Mapping  Overview  Map  Charts  Table  Compare   │  ← tab-bar
│  + Load data  │  3D  Transform  Project  Export  Sources  Fusion   f16.gpx│
│               ├─────────────────────────────────────────────────────────┤
│  ● dataset A  │                                                          │
│    dataset B  │              < active tab's panel renders here >         │  ← tab-content
│    dataset C  │                                                          │
│               │                                                          │
│  ─────────────│                                                          │
│  Supported in:│                                                          │
│  [GPX][CSV]…  │                                                          │
├───────────────┴─────────────────────────────────────────────────────────┤
│  level▾  [filter log…]  ☑autoscroll   0 err 0 warn 128 total  Export Clear│  ← log-dock
│  12:41:03 INFO  import   Analyzed track.gpx: 6 columns                   │
│  ...                                                                       │
└───────────────────────────────────────────────────────────────────────────┘
                         [ toast: "Loaded 4,281 points…" ]   ← floats above log dock
```

Four fixed regions, top to bottom:

1. **Header** (`app-header`, `~58px`) — brand mark, title/subtitle, and a right-aligned status slot that swaps between a busy `Spinner` and a passive "`N` dataset(s) loaded" counter. Never scrolls, never hidden.
2. **Body** (`app-body`) — a horizontal flex split between the sidebar and the workspace. Fills all remaining vertical space between header and log dock.
3. **Log dock** (`log-dock`, fixed `220px`) — always-visible, always-mounted `LogConsole`. It is not a tab and cannot be closed; it is the permanent "what is the pipeline actually doing" surface for an engineering tool where trust in the data pipeline matters more than screen real estate.
4. **Toast layer** — a single ephemeral, non-blocking notification (`position: fixed`, centered, floating just above the log dock), auto-dismissed after ~3.2s. Only one toast exists at a time; a new one replaces the old.

There is no modal-heavy design: the only two dialogs in the whole app are the project **report export** dialog (`ReportExportDialog`) and native browser `window.confirm()` calls used for a small number of destructive actions (deleting a named recipe, deleting a KML/KMZ library entry). Everything else is inline, in-panel state.

## 2. Sidebar (left rail, `256px` fixed, collapses to `210px` under 1100px viewport width)

Persistent regardless of active tab — this is the dataset-management rail, separate from the tab-driven workspace:

- **`+ Load data`** — a single full-width, high-emphasis primary button (orange gradient, the only button styled this way besides Build/Export actions) that opens the native file picker. This is the single entry point for adding data by click; drag-and-drop onto the Import tab's dropzone is the other.
- **Dataset list** — one row per loaded dataset, each showing name, source format + point count (`gpx · 4,281 pts`), and an inline `×` remove button. Clicking a row makes it the *active* dataset and, if the user is currently on the Import/Mapping tab, auto-jumps to Overview. The active dataset's row is highlighted with an accent border and lighter fill. There is no drag-reorder, grouping, or folder concept — datasets are a flat, session-scoped list.
- **Format badges footer** — a static reference strip ("Supported in: GPX · CSV · GeoJSON · KML · NMEA · GPB") pinned to the bottom of the sidebar, separated by a rule.

Design intent: the sidebar answers "what data do I have loaded" at all times; the tab bar answers "what am I doing with the active one right now." These are orthogonal and both always visible — a two-axis workspace rather than a single linear wizard.

## 3. Tab bar & navigation model

A single row of plain text/underline tabs (`tab-bar`), not icon-first, not a sidebar-nested nav, not a hamburger — everything is one horizontal strip that scrolls if the window is too narrow. Thirteen tabs in fixed order:

| # | Tab | Label | Enabled when |
|---|-----|-------|--------------|
| 1 | `import` | Import | always |
| 2 | `mapping` | CSV Mapping | a CSV/TSV file is pending column mapping |
| 3 | `overview` | Overview | a dataset is active |
| 4 | `map` | Map | a dataset is active, or the desktop KML/KMZ library has content |
| 5 | `charts` | Charts | a dataset is active |
| 6 | `table` | Table | a dataset is active |
| 7 | `compare` | Compare | ≥2 datasets loaded |
| 8 | `scene3d` | 3D | a dataset is active |
| 9 | `transform` | Transform | a dataset is active |
| 10 | `project` | Project | ≥1 dataset loaded |
| 11 | `export` | Export | a dataset is active |
| 12 | `sources` | Sources | ≥1 dataset loaded |
| 13 | `fusion` | Fusion | ≥2 datasets loaded |

Disabled tabs render dimmed and inert (`disabled`, no click handler fires) rather than being hidden — the full capability set of the program is always visible, communicating "this is what you'll unlock" instead of hiding functionality behind progressive disclosure. This matters for a technical tool: an engineer scanning the tab bar for the first time immediately learns the full feature surface (Compare, Fusion, 3D, Sources) even with nothing loaded yet.

The active tab gets a 2px accent underline (`::after`) rather than a filled background change — a light-touch selected-state convention reused nowhere else in the app (buttons/chips use fill, tabs use underline).

To the right of the last tab, a monospace `tab-active-name` label pins the active dataset's filename — a persistent reminder of *which* dataset the visible panel describes, since Compare/Sources/Fusion/Project can show multi-dataset context while the rest of the tabs are single-active-dataset scoped.

Selecting most "workspace" tabs (`overview, map, charts, table, compare, scene3d, transform`) also records the choice into the durable project workspace state (`lastWorkspaceTab`) and marks the project dirty — so switching tabs is itself a piece of project state that survives save/reopen, letting a user's project archive reopen on the same tab they left off on.

## 4. Cross-cutting interaction patterns

These four patterns recur across nearly every data-bearing panel (Overview, Map, Charts, Table, 3D, Compare) and are the connective tissue that makes JDDC feel like one linked instrument rather than 13 separate tools:

- **Linked point/range selection.** A single `pointIndex` / `indexRange` / `timeRange` / `segmentIds` selection model (`usePointSelection`) is shared across Table, Chart, Map and 3D. Selecting a row, dragging a chart range, clicking a map marker, or picking a 3D vertex all update the same underlying selection, and every other linked view highlights it simultaneously. Selection renders as a small removable `chip chip-on` / `chip chip-range` pill ("selected #482 ×", "range 120–340 ×") that appears in each panel's toolbar — clicking the × on any one of them clears it everywhere.
- **Transient hover cursor.** Independent from persistent selection: hovering a table row, chart point, or 3D vertex broadcasts a lightweight cursor position that the Map and 3D canvas render as a distinct highlight color (`#38bdf8` cyan), separate from the selected-point color (accent orange) and the range color (amber/yellow).
- **Quality-event overlays.** Gaps, duplicate timestamps, coordinate jumps, invalid coordinates, elevation spikes/flatlines detected by `detectQualityEvents` are rendered consistently everywhere they can be: colored/dashed chart-axis markers, amber/red map circle markers with tooltips, break markers in the 3D path, and a `⚠` flag + highlighted row background in the Table. A user never has to re-discover the same data problem twice per view.
- **Undo/redo as dataset snapshots, not command replay** in the Transform tab, paired with a separate, explicit "verified operation history" that *can* be replayed deterministically against the original source snapshot (used for recipes and cross-session repeatability) — two different mechanisms for two different needs (fast interactive undo vs. auditable/repeatable pipelines).

Global (non-panel-specific) affordances:
- **Busy indicator** — a spinner + label replaces the dataset counter in the header during any blocking operation (CSV analysis, dataset build); a slim indeterminate/determinate `ProgressBar` appears at the top of the tab content area with an optional Cancel button for cancellable long-running work (CSV build, GPX worker export).
- **Toasts** — every dataset load, transform, export, or project action fires a short toast confirmation/error at the bottom of the screen.
- **Keyboard navigation** — in Overview/Table/Chart/3D: ←/→ moves the synchronized cursor, Shift+←/→ extends a range, Enter commits the cursor as the persistent selection, Home/End jumps to track ends, Escape clears. This is stated directly in the Overview panel's selection-controls help line.
- **Drag-and-drop everywhere it makes sense** — the Import tab's dropzone is the primary target, but the whole interaction (`onFiles`) is format-sniffing and accepts multiple files at once, mapping each to CSV-mapping-required vs. direct-parse paths independently.

## 5. Per-tab panel breakdown

### 5.1 Import (`ImportView.tsx`)
A single centered column, max-width ~920px. A large dashed-border **dropzone** (click-to-browse *or* drag-and-drop, same target) dominates the panel, with a bobbing down-arrow icon, "Drop TSPI data here / or click to browse," and a row of format pills (GPX, CSV, GeoJSON, KML, NMEA, GPB) each showing its label and primary extension. Below it, a static "Conversion matrix" note card explains the normalize-then-export-to-anything model and the accepted coordinate/timestamp formats in prose. No table, no list, no configuration — this tab has exactly one job (get a file in), and it is a landing/empty-state screen as much as a functional one.

### 5.2 CSV Mapping (`MappingPanel.tsx`)
Only reachable mid-flow, immediately after a CSV/TSV is dropped (auto-navigated). A field-mapping form: detected columns are auto-suggested into semantic roles (latitude, longitude, elevation, timestamp, name, description) via best-guess scoring, with a manual override `<select>` per field arranged in an auto-fill grid (`mapping-fields`, `minmax(220px,1fr)`), a summary strip of current choices, a conditional swap-hint warning banner (amber) if lat/lon look transposed, a header-row/additional-header toggle, and a teal-accented **Build dataset** primary button that is visually distinct from the orange primary-action button used for loading files — teal/green is reserved for "commit/finalize" actions (Build, Export) throughout the app, orange for "start/select" actions.

### 5.3 Overview (`StatsPanel.tsx`)
The dataset's home screen and the tab auto-selected right after import. Top-to-bottom:
1. An 8-tile **metric grid** (auto-fill, `minmax(150px,1fr)`) — Points, Valid coords, Distance, Duration, Avg rate, Max speed, Elev gain, Elev range — each a large monospace value over a small uppercase label.
2. **Import summary** — provenance block: source filename/size, accepted-points/warning counts, sha256 checksum (truncated with full value on hover), parser id+version, and coordinate/altitude/time reference metadata.
3. **Bookmarks** — add-current-selected-point-as-bookmark input+button, then a list of jump-to buttons with an inline remove `×`.
4. **Selection controls** — datetime-local start/end pickers for time-range selection, plus a row of clickable **segment chips** (auto-detected flight/data-state segments) each showing kind, index span, and point count; the keyboard-shortcut help line lives directly under this block since it's the section keyboard nav acts on.
5. A two-column **stats-columns** grid: left = data-quality checklist (✓/! icons with detail text: coordinate validity, timestamps present, time monotonic, elevation present, duplicate coordinates) plus a detected-quality-events summary and dataset warnings; right = a per-channel statistics table (n / min / max / mean / σ).

### 5.4 Map (`MapView.tsx` + `MapOverlayPanel.tsx`)
A collapsible **overlay drawer** sits above the map toolbar (KML/KMZ overlay management: add/toggle visibility/reorder/opacity/remove, with per-overlay status line for missing/error states) — collapsed by default, so the primary map controls are what a user sees first. The **toolbar** is a single wrapping row: display-mode select (Path+Points / Path only / Points only), basemap select (OpenStreetMap / offline grid), color-by-channel select, a numeric gap-split-minutes field, three fit buttons (Fit active / Fit visible (N) / Fit range), a live valid/drawn point count, selection chips, a color legend gradient when a channel is active, and (conditionally) a basemap-error banner with a one-click "switch to offline grid" fallback button — the app is explicit that basemap tiles are the *only* network dependency and degrades gracefully. Below the toolbar, a full-bleed Leaflet canvas (min-height 440px) renders the path (optionally split into segments at detected gaps/jumps), individually colored other-dataset overlay tracks (dashed, non-interactive), quality-event circle markers with tooltips, a distinct start (green) / end (red) marker pair, and the shared hover/selection cursor markers.

### 5.5 Charts (`TimeSeriesChart.tsx`)
One multi-channel SVG surface (not a grid of small multiples) with a toolbar of channel toggle **chips** (colored dot + label, click to show/hide series), an x-axis mode selector (time / source-index / cumulative distance), zoom/pan/reset controls, and a bottom **readout strip** showing live cursor values per visible channel. Quality events render as small colored tick marks along the axis with hover tooltips and a compact legend. Range-brushing on the chart directly drives the shared selection range.

### 5.6 Table (`DataTable.tsx`)
A virtualized (windowed, fixed 26px row height, overscan-8) grid — necessary because tracks can be tens of thousands of points. Toolbar: search-filter input, live "`N` / `M` rows" counter, "Export visible CSV" button (exports exactly the filtered/sorted view, not the whole dataset), a "quality events only" checkbox (appears only when events exist), a "Next quality event" jump button, a "selected range only" checkbox (appears only when a range exists), and the standard selection chips. Column headers are clickable to cycle sort asc → desc → none, with a small triangle indicator. Rows flagged by a quality event get a left-edge amber bar and a `⚠` prefix on the index cell; selected/hovered/in-range rows get their own background treatments, all simultaneously distinguishable.

### 5.7 Compare (`ComparisonPanel.tsx`)
Reference/target dataset pickers, alignment mode (nearest-time vs. interpolated) with tolerance/gap and manual time-offset controls, then computed relative-position analytics (local-ENU relative position, horizontal/slant range, bearing, vertical separation, closure rate, closest-approach summary line). A compatibility guard blocks or warns before showing results if the two datasets' time/altitude reference metadata isn't comparable — surfaced as the same amber/red warning-line convention used elsewhere, not a silent failure.

### 5.8 3D (`Trajectory3dPanel.tsx`)
A custom 2D-canvas-based perspective/orthographic scene renderer (no WebGL/three.js dependency) filling most of the panel, with a toolbar above it (altitude exaggeration number field, color-channel select, projection select, gap-split-seconds field, ground-grid/vertical-curtain/points checkboxes, and camera preset buttons: Reset camera / Top / Side / Fit trajectory) and a **playback transport** below it (Play/Pause, Restart, a scrub slider, a speed select 0.25×–4×, and a live percentage readout). Pointer drag orbits (shift/right-drag pans), wheel zooms. Compatible companion datasets render simultaneously in a shared local-ENU frame in a fixed purple, with an explicit count line and an "excluded due to incompatible references" warning when relevant. A 6-tile metric grid (source points, valid coordinates, rendered vertices, east/north/up span) sits at the bottom, plus a one-line reminder of the orbit/pan/zoom gesture set.

### 5.9 Transform (`TransformPanel.tsx` + `NotionalSmoothingPanel.tsx`)
Two stacked sections. First, an **operation-card grid** (auto-fill, `minmax(280px,1fr)`) — one card per available transform (sort by time, swap coordinates, dedupe/drop-invalid, decimate, simplify, moving-average/median/Hampel/EMA smoothing, time/elevation shift, elevation-outlier removal, fixed-rate resample) each with a short description and its own inline numeric/checkbox controls anchored to the card's bottom edge. Above the grid: Undo/Redo buttons gated on real history availability, and a collapsible **operation history** log with a "Replay verified history" action (disabled with an explanation when no replay-safe source snapshot exists) and a **named recipes** list (Load / Replay / Delete-with-confirm per recipe). Second, a separate notional-gap-fill smoothing panel that creates a *new* derived dataset rather than mutating the active one — a deliberate distinction between destructive/in-place transforms and generative/derivative ones.

### 5.10 Project (`ProjectPanel.tsx` + `ReportExportDialog.tsx`)
Save/reopen a bounded `.jddc-project` archive (all datasets, undo/redo history, display settings, bookmarks, operation history, workspace view state) via a file input and download action, a project name/notes editor, a dirty-state indicator (an "Unsaved changes" badge), a separate **Export manifest only** action (the manifest without embedded dataset payloads), a **Diagnostics** section (an optional free-text note plus an **Export diagnostic bundle** action that packages app/workspace configuration, dataset summaries, and recent logs for a bug report — explicitly excluding raw trajectory points and KML/KMZ library files), and a button that opens the **Report Export dialog** — the app's one significant modal, a checklist-style form (`dialog-checklist`) for choosing what to include (stats, quality evidence, warnings, bookmarks, transform history) before generating a self-contained, print-ready HTML report in a distinct light "VectorPunk/HUD" visual system (see the style/theme document) — deliberately different from the app's own dark UI because it targets printing/PDF export, not on-screen use.

### 5.11 Export (`ExportPanel.tsx`)
A strict two-column layout (`export-panel`, 1fr/1fr): left column stacks a 2×N grid of **format cards** (GPX, CSV, GeoJSON, KML, GPB, each a clickable card with label+description, active state = teal border/tint) above an options block (output filename + extension tag, format-specific options — for GPX: sort-by-time / include-extensions / BOM / coordinate-precision — plus conditional warning banners and a mandatory acknowledgment checkbox if the dataset contains notional/interpolated points, which otherwise hard-blocks the Export button); right column is a live **preview pane** (monospace, first 1.4KB of the serialized output, scrollable) so the user can sanity-check the exact bytes before committing to a download. Large GPX exports transparently route through a chunked cancellable Worker with an inline progress line + Cancel button replacing the Export button in place.

### 5.12 Sources (`SourcesPanel.tsx`)
The simplest panel: a compact table (dot = active marker, color swatch, name, format, point count, visibility checkbox, "Make active" button) that controls purely-cosmetic multi-dataset display state — which non-active datasets appear as extra colored paths on the Map, and in what color. Explicitly documented in-panel as non-destructive ("Visibility is display-only — it never changes or removes any dataset").

### 5.13 Fusion (`FusionPanel.tsx`)
Multi-source auto-combine/fusion workflow producing a new fused dataset plus a persisted **fusion evidence** record per run (an expandable `<details>` block showing source registrations and grouping/report detail), viewable and re-openable across the session.

## 6. Dialogs, confirmations, and errors

- **`dialog-backdrop`/`dialog`** — one reusable centered-overlay pattern (max-width 560px, own scroll if content overflows) used currently by exactly one flow: report export options. It is deliberately not overused; almost everything else is inline panel state, keeping the "no context-switch" feel of a single workbench screen.
- **Native `window.confirm()`** — used sparingly for irreversible actions (delete a named recipe, delete a KML/KMZ library file) rather than building a custom confirm dialog for every case.
- **`ErrorBoundary`** — a full-viewport centered card (red-bordered) that replaces the entire app shell if a render error escapes, rather than a partial/panel-level fallback — appropriate for a data tool where a crash mid-analysis needs to be unmistakable rather than quietly containing to one tab.

## 7. Desktop (Electron) vs. browser differences

The UI is identical in both shells with two conditional exceptions, both gated by `isDesktopKmlLibraryAvailable()`: a persistent KML/KMZ overlay library (imported KML/KMZ files are saved to disk and remain available as map overlays across sessions — browser build has no persistent filesystem, so this capability silently doesn't appear) and the Map tab being enabled even with zero datasets loaded, purely to browse that persistent library. No other panel, tab, or control differs between web and desktop builds.
