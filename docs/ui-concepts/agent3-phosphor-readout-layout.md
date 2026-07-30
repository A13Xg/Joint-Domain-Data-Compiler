┌──────────────────────────────────────────────────────────────────────────┐
│  JDDC MISSION CONTROL — INSTRUMENT PANEL SCAN                            │
│  "Phosphor Readout" Documentation Set — UI Layout & Navigation            │
│  [STATUS] Cold boot into dense workbench. Single-screen, 13-tab interface  │
└──────────────────────────────────────────────────────────────────────────┘

AUTHORITY: `src/App.tsx`, `src/ui/*` — the live implementation. This brief
logs the current signal state of the engineering workbench's physical layout,
tab manifest, cross-cutting cursor/selection mechanics, and per-tab readout
surface (Import through Fusion).

═══════════════════════════════════════════════════════════════════════════

█ INSTRUMENT CONSOLE TOPOLOGY

One fixed screen topology, immutable across all operations. No multi-window,
no route/drawer juggling—single dense panel that reorients its center lab
via 13-tab selector. This is deliberate: one engineer, one tool, all shared
context always visible (datasets + log spew + selected data state).

┌────────────────────────────────────────────────────────────────────────────┐
│ ┌──────────────────────────────────────────────────────────────────────────┤ ┐
│ │ [■] Joint Domain Data Compiler        TSPI flight telemetry tool  ● 3  │ │ app-header (58px)
│ │     conversion & analysis workbench                                      │ │ status: dataset counter ↔ spinner (busy)
│ ├─────────────────────────────────────────────────────────────────────────┤ │
│ │ ┌──────────┬──────────────────────────────────────────────────────────┐ │ │
│ │ │ + Load   │ Import Mapping Overview Map Charts Table Compare 3D ...  │ │ │
│ │ │ data     │ Transform Project Export Sources Fusion            gpx  │ │ │
│ │ ├──────────┼──────────────────────────────────────────────────────────┤ │ │
│ │ │● dataset │  ╔════════════════════════════════════════════════════╗  │ │ │
│ │ │ A        │  ║          < active tab content renders here >       ║  │ │ │
│ │ │ dataset B│  ║                                                    ║  │ │ │ tab-content area
│ │ │ dataset C│  ║      (auto-fills available vertical space)         ║  │ │ │ (scrollable)
│ │ │          │  ║                                                    ║  │ │ │
│ │ │ ─────────┤  ╚════════════════════════════════════════════════════╝  │ │ │
│ │ │ Supp:    │                                                          │ │ │
│ │ │ GPX CSV  │                                                          │ │ │
│ │ │ GeoJSON  │                                                          │ │ │
│ │ └──────────┴──────────────────────────────────────────────────────────┘ │ │
│ ├────────────────────────────────────────────────────────────────────────┤ │
│ │ level▾ [search…] ☑auto  0err 0warn 128tot | Export Clear            │ │ log-dock (220px)
│ │ 12:41:03  INFO  import  Analyzed track.gpx: 6 columns                │ │
│ │ 12:41:05  INFO  build   Parsed 4281 valid coordinates               │ │ (always mounted,
│ │ 12:41:07  WARN  detect  Duplicate timestamp @ point 847             │ │  non-closeable)
│ └────────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│        [ toast: "Loaded dataset A (4,281 points)" ]  ← floats above dock   │
└────────────────────────────────────────────────────────────────────────────┘

Four fixed zones stack top-to-bottom:
  1. HEADER (58px, #0b0f17) — branding, title, right-side spinner/count
  2. BODY (flex-fill) — two-column split: sidebar | workspace
  3. LOG DOCK (220px, #0b0f17) — permanent read-only console
  4. TOAST LAYER (fixed overlay, auto-dismiss ~3.2s)

No modals except: report-export dialog, native confirm() for deletes.

═══════════════════════════════════════════════════════════════════════════

█ LEFT RAIL SCAN — DATASET MANIFEST & CONTROL

Fixed-width column (256px; collapses to 210px below 1100px viewport).
Persistent across all tab selections. Two separate concerns:

┌─────────────────────────┐
│ ┌─────────────────────┐ │
│ │ + LOAD DATA         │ │ high-emphasis button (orange accent gradient)
│ │ [click or drag file] │ │ → native file picker entry point
│ └─────────────────────┘ │
│                         │
│ ● dataset_A.gpx         │ active dataset (border + fill)
│   gpx · 4,281 pts [×]   │ inline remove button
│                         │
│ dataset_B.csv           │ inactive (dim text)
│   csv · 892 pts [×]     │
│                         │
│ dataset_C.kml           │
│   kml · 342 pts [×]     │
│                         │
│ ─────────────────────── │
│ Supported in:           │
│ [GPX][CSV][GeoJSON]     │ static footer badge strip
│ [KML][NMEA][GPB]        │
└─────────────────────────┘

Affordances:
  — Click dataset row → active; auto-jump to Overview if on Import/Mapping
  — × remove button → dataset deleted (no confirm needed; undo available)
  — flat list (no drag-reorder, folders, or nested groups)

Design rationale: answers "what data is loaded?" always. Orthogonal from
the tab bar (which answers "what operation am I doing?"). Two-axis workspace.

═══════════════════════════════════════════════════════════════════════════

█ NAVIGATION MANIFEST — THIRTEEN TAB READOUT

Plain text/underline horizontal strip (no sidebar nav, no icons, no hamburger).
Single fixed order. Each tab's enablement gated by dataset/file preconditions.

Disabled tabs render dimmed + inert (not hidden)—communicates full capability
set to new users without progressive-disclosure hiding. All UI affordances
visible from cold boot.

┌─────────────────────────────────────────────────────────────────────────┐
│ # │ Tab ID      │ Label          │ ENABLED WHEN                       │
├─────────────────────────────────────────────────────────────────────────┤
│ 1 │ import      │ Import         │ always                             │
│ 2 │ mapping     │ CSV Mapping    │ CSV/TSV file pending column mapping│
│ 3 │ overview    │ Overview       │ ≥1 dataset active                 │
│ 4 │ map         │ Map            │ ≥1 dataset active OR KML lib has  │
│   │             │                │ content (desktop only)            │
│ 5 │ charts      │ Charts         │ ≥1 dataset active                 │
│ 6 │ table       │ Table          │ ≥1 dataset active                 │
│ 7 │ compare     │ Compare        │ ≥2 datasets loaded                │
│ 8 │ scene3d     │ 3D             │ ≥1 dataset active                 │
│ 9 │ transform   │ Transform      │ ≥1 dataset active                 │
│ 10│ project     │ Project        │ ≥1 dataset loaded                 │
│ 11│ export      │ Export         │ ≥1 dataset active                 │
│ 12│ sources     │ Sources        │ ≥1 dataset loaded                 │
│ 13│ fusion      │ Fusion         │ ≥2 datasets loaded                 │
└─────────────────────────────────────────────────────────────────────────┘

Active tab rendered with 2px accent underline (orange, `--accent`).
Right of tab strip: monospace `active-dataset` filename label (e.g., "f16.gpx")
  — persistent reminder of context when multi-dataset panels active.

Tab selection for workspace tabs (overview, map, charts, table, compare,
scene3d, transform) auto-records into persistent project state
(`lastWorkspaceTab`) — reopen project on same tab you left off on.

═══════════════════════════════════════════════════════════════════════════

█ CROSS-CUTTING SIGNAL PATTERNS

Four linked mechanics wired across nearly all data-bearing tabs—make JDDC
feel like one instrument rather than 13 disconnected tools:

1. POINT/RANGE SELECTION (linked across Table/Chart/Map/3D):
   ├─ Single shared selection model: `pointIndex` / `indexRange` / `timeRange`
   ├─ Select row → all views highlight. Drag chart range → all views react.
   ├─ Click map marker or 3D vertex → synchronized everywhere.
   └─ Removable chip pill ("range 120–340 ×") in each panel's toolbar
      (click × to clear everywhere)

2. TRANSIENT HOVER CURSOR (lightweight, separate from selection):
   ├─ Independent from persistent selection
   ├─ Hover table row, chart point, or 3D vertex → broadcasts cursor
   ├─ Map + 3D render as distinct cyan (#38bdf8) highlight
   └─ Separate from selected-point orange and range-amber colors

3. QUALITY-EVENT OVERLAYS (gaps, dupe timestamps, jumps, invalids):
   ├─ Rendered consistently everywhere applicable:
   │  ├─ colored + dashed axis tick marks in Charts
   │  ├─ amber/red circle markers on Map (+ tooltips)
   │  ├─ break markers in 3D path
   │  └─ ⚠ flag + highlighted row bg in Table
   └─ User never re-discovers same data problem twice per view

4. UNDO/REDO SNAPSHOT MODEL (Transform tab only):
   ├─ NOT command replay; dataset snapshots instead
   ├─ SEPARATE "verified operation history" available for replay
   │  (used for recipes, cross-session repeatability)
   └─ Two mechanisms for two needs: fast undo vs. auditable pipelines

Global affordances across all panels:
  — Busy spinner + label replace dataset counter during blocking ops
  — Slim progress bar at top of tab content (w/ optional Cancel for long tasks)
  — Toast notifications for load/transform/export/project actions
  — Keyboard nav in Overview/Table/Chart/3D: ←/→ move cursor,
    Shift+←/→ extend range, Enter commits selection, Home/End jump to ends,
    Escape clears all.
  — Drag-and-drop on Import tab dropzone; accepts multi-file, auto-routes
    to CSV-mapping or direct-parse per file type.

═══════════════════════════════════════════════════════════════════════════

█ TAB READOUT: IMPORT (Tab 1)

Entry point, always enabled. Single centered column (max-width ~920px).

┌─────────────────────────────────────┐
│                                     │
│  ╔═══════════════════════════════╗  │ Large dashed-border dropzone
│  ║      ↓ DROPZONE ↓             ║  │ · click to browse OR drag-drop
│  ║                               ║  │ · Centered down-arrow icon (bobs)
│  ║  Drop TSPI data here          ║  │ · Single target for both input modes
│  ║  or click to browse            ║  │
│  ╚═══════════════════════════════╝  │
│                                     │
│  [GPX][CSV][GeoJSON][KML]           │ format pills showing label + ext
│  [NMEA][GPB]                        │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  CONVERSION MATRIX                  │ static reference card:
│  Import any format, analyze, export │ normalize-then-export model
│  as any format. Accepted coords:    │ Coordinate + timestamp rules
│  DD, DMS, cartesian. Timestamps:    │ in prose; no interactive config
│  ISO8601, epoch, duration.          │
│                                     │
└─────────────────────────────────────┘

Purpose: one job only (get a file in). Landing/empty-state screen.
No table, list, or configuration—keep it sparse for cold-start clarity.

═══════════════════════════════════════════════════════════════════════════

█ TAB READOUT: CSV MAPPING (Tab 2)

Gated: only reachable mid-flow after CSV/TSV drop (auto-navigated).
Field-mapping form for semantic role assignment.

┌───────────────────────────────────────────────────────┐
│  [?] Detected columns (auto-suggested mapping)         │
│                                                       │
│  Latitude      [dropdown: lat/lon/x/none]            │ mapping-fields grid
│  Longitude     [dropdown: lat/lon/y/none]            │ auto-fill, minmax(220px,1fr)
│  Elevation     [dropdown: elev/alt/z/none]           │ each field: select-override
│  Timestamp     [dropdown: time/date/none]            │
│  Name          [dropdown: name/label/none]           │ summary strip shows current
│  Description   [dropdown: desc/note/none]            │ choices; conditional
│                                                       │ lat/lon swap-hint banner
│  ─────────────────────────────────────────────────    │
│  ☑ Header row (row 1)                                │ (amber) if transposed
│  ☑ Additional header row (row 2)                     │
│                                                       │
│                     ┌─────────────┐                  │
│                     │ BUILD DATASET│ ← teal (commit) │
│                     └─────────────┘                  │
└───────────────────────────────────────────────────────┘

Teal-accented "Build dataset" button is visually distinct from orange
"+ Load data" button (load/start) — teal/green reserved for finalize/build
actions (Build, Export) throughout app. Orange for start/select actions.

═══════════════════════════════════════════════════════════════════════════

█ TAB READOUT: OVERVIEW (Tab 3)

Dataset home screen; auto-selected after import. Five-part readout:

┌──────────────────────────────────────────────────────────────┐
│  METRIC GRID (auto-fill: minmax(150px, 1fr))                │
│  ┌────────────┬────────────┬────────────┬────────────┐     │
│  │ 4,281      │ 4,281      │ 187.3 km   │ 1847 sec   │     │
│  │ Points     │ Valid coords│ Distance   │ Duration   │     │
│  └────────────┴────────────┴────────────┴────────────┘     │
│  ┌────────────┬────────────┬────────────┬────────────┐     │
│  │ 228 m/s    │ 312 m/s    │ 1,847 m    │ 1,200 m    │     │
│  │ Avg rate   │ Max speed  │ Elev gain  │ Elev range │     │
│  └────────────┴────────────┴────────────┴────────────┘     │
│                                                              │
│  ─────────────────────────────────────────────────────────  │
│                                                              │
│  IMPORT SUMMARY (provenance block)                          │
│  File: track.gpx (187 KB)                                  │
│  Accepted: 4,281 points (0 warnings)                       │
│  SHA256: a1b2c3d4... [hover for full]                      │
│  Parser: GPX v1.1 (ver. 2.0)                               │
│  Coord system: WGS84 (EPSG:4326)                           │
│  Alt reference: ellipsoid (HAE)                            │
│  Time reference: UTC                                        │
│                                                              │
│  ─────────────────────────────────────────────────────────  │
│                                                              │
│  BOOKMARKS (add-current-point, list w/ jump buttons)       │
│  [+ Add current as bookmark]                               │
│  Launch point (index 0) [×]                                │
│  Max-speed waypoint (index 847) [×]                        │
│                                                              │
│  ─────────────────────────────────────────────────────────  │
│                                                              │
│  SELECTION CONTROLS                                         │
│  From: [2024-06-15 14:22:00]  To: [2024-06-15 14:53:47]   │ datetime pickers
│  Segments (auto-detected): [Climbout 0-423 pts] [Cruise]   │ clickable chips
│  [Climb-to-altitude 424-1200 pts] [Descent 1201-4281]      │
│  Keyboard: ←/→ move, Shift+←/→ range, Enter commit, ...    │
│                                                              │
│  ─────────────────────────────────────────────────────────  │
│                                                              │
│  TWO-COLUMN STATS GRID                                      │
│  ┌────────────────────┬──────────────────────────────────┐ │
│  │ DATA QUALITY       │ PER-CHANNEL STATISTICS         │ │
│  ├────────────────────┼──────────────────────────────────┤ │
│  │ ✓ Coords valid     │ Channel  │ n    │ min  │ max  │ │ │
│  │ ✓ Timestamps      │ ─────────┼──────┼──────┼──────┤ │ │
│  │ ✓ Time monotonic  │ lat      │4281  │27.34 │47.91 │ │ │
│  │ ✓ Elevation exist │ lon      │4281  │-122.5│-87.3 │ │ │
│  │ ! 3 dupe coords   │ elev(m)  │4281  │0     │12500 │ │ │
│  │ ⚠ 1 duplicate ts  │ ─────────┴──────┴──────┴──────┤ │ │
│  │ ⚠ Quality events: │ (n, min, max, mean, σ per col) │ │ │
│  │   1 gap, 1 jump   │                                │ │ │
│  └────────────────────┴──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════

█ TAB READOUT: MAP (Tab 4)

Leaflet 2D base-layer + path rendering. Two sub-components:

┌──────────────────────────────────────────────────────────────┐
│ KML/KMZ OVERLAY DRAWER (collapsed by default, toggle to show)│
│ [▼ Map overlays]  overlay.kmz (visible) [0-100% opacity]    │
│   missing_tile.kml (error: file not found) [×]               │
│   parking_area.kml (not visible) [toggle] [×]                │
│                                                              │
│ ─────────────────────────────────────────────────────────────│
│                                                              │
│ TOOLBAR (wrapping row)                                      │
│  Display: [Path + Points ▼]  Basemap: [OSM ▼]              │ tooltips, live counts
│  Color by: [elevation ▼]  Gap split: [5 min]               │
│  [Fit active][Fit visible (3)][Fit range]                  │ conditional swaps
│  · Points: 4,281 / 4,281 drawn                              │ conditional warning
│  [✓ Start] [✓ End] [range 120-340 ×]                       │ selection chips
│                                                              │
│  Color legend: ─────────────────────  (when channel active) │
│                 -500m          12500m                       │
│                                                              │
│ ─────────────────────────────────────────────────────────────│
│                                                              │
│  ╔════════════════════════════════════════════════════════╗ │
│  ║  • Path (colored by active channel, split at gaps)     ║ │ full-bleed
│  ║  ┌─ [Start marker, green]                              ║ │ Leaflet canvas
│  ║  │  ╲                                                   ║ │ min-height: 440px
│  ║  │   ╲ ─ ─ ─ [gap marker] ─ ─ ─                        ║ │
│  ║  │        ╲                                             ║ │
│  ║  │         ╲ ⚠ [quality event circles, amber/red]      ║ │
│  ║  │          ╲                                           ║ │
│  ║  └──────────→ [End marker, red]                        ║ │
│  ║                                                         ║ │
│  ║  Other datasets (dashed, non-interactive, colored)     ║ │
│  ║  Companion track B ╱╱╱╱╱╱ (purple)                    ║ │
│  ╚════════════════════════════════════════════════════════╝ │
└──────────────────────────────────────────────────────────────┘

Basemap: OpenStreetMap (network) OR offline grid fallback (no tiles).
Conditional error banner if basemap unavailable + auto-switch button.
KML overlay library desktop-only (persistent KML/KMZ library across sessions).

═══════════════════════════════════════════════════════════════════════════

█ TAB READOUT: CHARTS (Tab 5)

Multi-channel SVG time-series (not small-multiples grid). Single large surface.

┌──────────────────────────────────────────────────────────────┐
│ TOOLBAR (channel toggles, x-axis mode, readout)             │
│  Channels: [●lat][●lon][●elev][●speed] ... (click to hide) │
│  X-axis:  [Time ▼] [Source-index] [Distance]               │
│  [Zoom in][Zoom out][Reset view]                            │
│                                                              │
│ ─────────────────────────────────────────────────────────────│
│  ╔════════════════════════════════════════════════════════╗ │
│  ║  (hand-rolled SVG chart area, no library)             ║ │ SVG canvas
│  ║  elev │                                                ║ │ Quality events:
│  ║ 12500 │              ╱╲      ⚠ colored tick marks    ║ │ · gap (dashed)
│  ║       │             ╱  ╲                              ║ │ · jump (solid)
│  ║  6000 │     ╱╲      ╱    ╲  ┌──range-selection─┐    ║ │ · duplicate ts
│  ║       │    ╱  ╲____╱      ╲─┘  (amber highlight) ║ │ · invalid coord
│  ║     0 │___╱                                           ║ │
│  ║       └────────────────────────────────────────────→ ║ │ Range-brushing
│  ║         0         time         1847 sec             ║ │ drives shared
│  ║  [drag to select range]                             ║ │ selection
│  ║  Quality events legend (small, compact)             ║ │
│  ╚════════════════════════════════════════════════════════╝ │
│                                                              │
│ READOUT STRIP (live cursor values)                         │
│  @47.234°  | -122.450°  | 847 m  | 228 m/s  |  [selection chips] │
└──────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════

█ TAB READOUT: TABLE (Tab 6)

Virtualized windowed grid (fixed 26px row height, overscan-8). Tens of
thousands of points handled without lag.

┌──────────────────────────────────────────────────────────────┐
│ TOOLBAR                                                      │
│  [Search: ____________]  4,281 / 4,281 rows  [Export visible CSV]
│  ☑ Quality events only  [◀Next event▶]  ☑ Range selection only
│  [✓ Selected #847 ×][range 120-340 ×]                       │
│                                                              │
│ ─────────────────────────────────────────────────────────────│
│  Index│Lat      │Lon       │Elev(m) │Speed(m/s) │Timestamp  │ (sortable
│  ─────┼──────────┼──────────┼────────┼───────────┼──────────┤  headers)
│    0  │47.2341  │-122.4502 │   12   │   0.0    │14:22:00.12│ green end
│    1  │47.2346  │-122.4497 │  24   │   5.8    │14:22:00.21│ start
│   ...│  ...    │  ...    │  ...   │  ...    │  ...     │
│ ⚠ 847 │47.8765 *│-121.1234 │ 847  *│ 342.1   │14:35:22.45│ selected
│   ...│  ...    │  ...    │  ...   │  ...    │  ...     │ (highlight)
│  4280 │28.1234 +│-93.2145 *│ 0.2   │   1.2   │14:53:47.99│ quality
│  ─────┴──────────┴──────────┴────────┴───────────┴──────────┤ events
│  * = coordinate jump  + = duplicate timestamp                │ (row bg)
│  Legend: [⚠ gap marker]  [⚠ jump] [⚠ dupe ts] [⚠ invalid]  │
└──────────────────────────────────────────────────────────────┘

Click header to sort asc → desc → none. Quality-flagged rows: left-edge
amber bar + ⚠ prefix on index. Hover/selected/in-range rows simultaneously
distinguished by background. Search filters by all columns.

═══════════════════════════════════════════════════════════════════════════

█ TAB READOUT: COMPARE (Tab 7)

Gated: ≥2 datasets loaded. Reference vs. target pairwise analysis.

┌──────────────────────────────────────────────────────────────┐
│  Reference dataset: [dataset_A.gpx ▼]                        │ pickers
│  Target dataset:    [dataset_B.csv ▼]                        │
│                                                              │
│  Alignment mode: [Nearest-time ▼] Tolerance: [5 sec]        │ options,
│                  [Interpolated]    Gap handling: [split]     │ manual
│                  Manual offset: [0 sec]                      │ time-offset
│                                                              │
│  ─────────────────────────────────────────────────────────────│
│                                                              │
│  Metadata compatibility check:                               │
│  ✓ Time reference compatible (both UTC)                     │ guard:
│  ✓ Altitude reference compatible (both ellipsoid)           │ compatibility
│  ⚠ Warning: altitude bands differ (0-500m vs 0-12500m)      │ warnings if
│                                                              │ refs mismatch
│  ─────────────────────────────────────────────────────────────│
│                                                              │
│  COMPUTED ANALYTICS (multi-row readout)                     │
│  Closest approach: 142 m (index 847, 14:35:22)              │ ENU relative
│  Avg horizontal separation: 287 m                           │ position,
│  Avg slant range: 312 m                                     │ bearings,
│  Vertical separation (avg): 47 m                            │ rates
│  Closure rate (max): 185 m/s                                │ closure
│  Bearing (at closest): 042°                                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════

█ TAB READOUT: 3D (Tab 8)

Custom Canvas-based perspective/orthographic scene (no WebGL, no three.js).
Two parts: scene + transport.

┌──────────────────────────────────────────────────────────────┐
│ TOOLBAR                                                      │
│  Exaggeration: [1.5 ▼]  Color: [elevation ▼]  Projection: [Perspective ▼]
│  Gap split: [10 sec]  ☑Ground grid  ☑Vertical curtain  ☑Points
│  [Reset camera][Top][Side][Fit trajectory]                 │
│                                                              │
│ ─────────────────────────────────────────────────────────────│
│  ╔════════════════════════════════════════════════════════╗ │
│  ║  3D SCENE (hand-rolled Canvas perspective render)     ║ │ Canvas
│  ║                                                         ║ │ min-fill
│  ║        ╱╲ Path (colored, linestring)                  ║ │
│  ║       ╱  ╲ Start marker (green)                       ║ │ Companion
│  ║      ╱    ╲                                            ║ │ dataset
│  ║     ╱ ┌─┐  ╲ End marker (red)                         ║ │ (purple,
│  ║    ╱  │B│   ╲ Companion track B (fixed purple)        ║ │ fixed
│  ║   ╱   └─┘    ╲ Ground grid (y-plane reference)       ║ │ color)
│  ║  ╱_____________╲ Vertical curtain (visual aid)        ║ │
│  ║                 ╲                                       ║ │
│  ║ Gesture: drag=orbit  shift/right-drag=pan  wheel=zoom ║ │
│  ╚════════════════════════════════════════════════════════╝ │
│                                                              │
│ PLAYBACK TRANSPORT (below scene)                            │
│  [◀][||][▶][↻]  ▬▬▬▬●───── scrub slider (44%)            │ transport
│  Speed: [1× ▼]  [0.25x][0.5x][1x][2x][4x]  47% complete   │ controls
│                                                              │
│ METRIC GRID (bottom)                                        │
│  4,281 pts │ 4,281 valid │ 4,281 rendered │ E: 187km │ N: 247km │ U: 12.5km
│  Orbit: left-drag  Pan: Shift+drag / right-drag  Zoom: wheel      │ gesture
│                                                              │ reminder
└──────────────────────────────────────────────────────────────┘

Companion datasets render in shared ENU frame; warning if incompatible
reference. Speed control 0.25×–4×, scrub slider for frame-by-frame.

═══════════════════════════════════════════════════════════════════════════

█ TAB READOUT: TRANSFORM (Tab 9)

Two stacked sections: operation cards + history/recipes, then notional smoothing.

┌──────────────────────────────────────────────────────────────┐
│ OPERATIONS SECTION                                           │
│  [◀ Undo ▶][▶ Redo ▶]  [▼ Operation history (5 ops)]        │ history log
│    Verify & Replay (verify snapshot exists, or disabled)    │ w/ replay
│    Named recipes: [Load F-16 climb profile][…]              │ action
│                                                              │
│  ─────────────────────────────────────────────────────────────│
│  OPERATION CARD GRID (auto-fill: minmax(280px, 1fr))         │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────┐    │
│  │ Sort by time     │ │ Swap coords      │ │ Dedupe   │    │
│  │ Apply time-order │ │ [x ↔ y]          │ │ [Drop]   │    │
│  │ sort            │ │ Switch lat/lon   │ │ invalid  │    │
│  │                 │ │                  │ │ points   │    │
│  │   [APPLY]       │ │   [APPLY]        │ │ [APPLY]  │    │
│  └──────────────────┘ └──────────────────┘ └──────────┘    │ card per
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────┐    │ operation
│  │ Decimate         │ │ Smoothing (MA)   │ │ Time     │    │
│  │ [n = 10 points] │ │ [window = 5]     │ │ shift    │    │
│  │ Keep every N-th  │ │ Moving average   │ │ [offset  │    │
│  │ point           │ │ filter           │ │ = 0 sec] │    │
│  │   [APPLY]       │ │   [APPLY]        │ │ [APPLY]  │    │
│  └──────────────────┘ └──────────────────┘ └──────────┘    │
│  [more cards...] (simplify, Hampel, EMA, elev shift, etc.) │
│                                                              │
│  ─────────────────────────────────────────────────────────────│
│                                                              │
│ NOTIONAL SMOOTHING (generative, separate section)           │ creates
│  Extrapolate gaps: [yes] Method: [linear ▼]                │ new
│  [+ Create smoothed dataset]                                │ dataset
│                                                              │
└──────────────────────────────────────────────────────────────┘

Undo/redo available if history exists. Operation history log is
collapsible; "Replay verified history" disabled if no source snapshot.
Named recipes show Load/Replay/Delete-with-confirm.

═══════════════════════════════════════════════════════════════════════════

█ TAB READOUT: PROJECT (Tab 10)

Save/reopen `.jddc-project` archives. Bounded session state + report export.

┌──────────────────────────────────────────────────────────────┐
│ PROJECT NAME & NOTES                                         │
│  Project name: [F-16 climb profile analysis]                │
│  Project notes: [Multi-line text editor]                    │
│                                                              │
│  Status: [DIRTY ●] ← unsaved changes                        │
│  Last saved: 2024-06-15 14:22:00                            │
│                                                              │
│ ─────────────────────────────────────────────────────────────│
│                                                              │
│  [↓ Open .jddc-project]  [↓ Save as .jddc-project]         │ file I/O
│                                                              │
│  What's in the archive:                                     │ contents:
│  ✓ All datasets (full data + metadata)                      │ datasets,
│  ✓ Undo/redo history (snapshots)                           │ history,
│  ✓ Display settings (chart zoom, map center, etc.)         │ settings,
│  ✓ Bookmarks & segment list                                │ bookmarks,
│  ✓ Operation history (verified, replayable)                │ operation log
│  ✓ Workspace view state (lastWorkspaceTab, etc.)           │
│                                                              │
│ ─────────────────────────────────────────────────────────────│
│                                                              │ REPORT EXPORT
│  ┌──────────────────────────────┐                           │ MODAL
│  │ [📋 Export HTML Report ▶] ▲  │ ← opens modal            │ dialog-
│  └──────────────────────────────┘  (checklist config form)  │ checklist
│                                                              │
│    REPORT EXPORT MODAL (center overlay, max-width 560px)   │
│    ┌───────────────────────────────────────────────────┐   │
│    │ SELECT REPORT CONTENTS                            │   │
│    │                                                   │   │
│    │ ☑ Statistics summary (metric grid, channel stats)│   │
│    │ ☑ Quality evidence (detected events w/ details) │   │
│    │ ☑ Warnings & caveats (any metadata warnings)    │   │
│    │ ☑ Bookmarks & landmarks                         │   │
│    │ ☑ Transform history (operations applied)        │   │
│    │                                                   │   │
│    │           [Cancel]  [Export Report]              │   │ callback:
│    │                                                   │   │ generates
│    │ (generates self-contained HTML in VectorPunk     │   │ print-ready
│    │  light theme, ready for PDF print)               │   │ HTML
│    └───────────────────────────────────────────────────┘   │
│                                                              │
└──────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════

█ TAB READOUT: EXPORT (Tab 11)

Strict two-column layout (1fr/1fr): format selection + options left,
live preview pane right.

┌──────────────────────────────┬──────────────────────────────┐
│ FORMAT CARDS (2×N grid)      │ LIVE PREVIEW PANE (monospace)│
│ ┌──────────┐ ┌──────────┐   │ <?xml version="1.0"?>        │
│ │ ● GPX    │ │ CSV      │   │ <gpx version="1.1">          │
│ │ Exchange │ │ Comma-   │   │   <metadata>                 │
│ │ format   │ │ sep      │   │     <name>track.gpx</name>   │
│ │ (teal)   │ │ values   │   │     <time>2024-06-15T14:…    │
│ │ └─────┘  │ │ (plain)  │   │ …                            │
│ └──────────┘ └──────────┘   │ (first 1.4KB, scrollable)    │
│ ┌──────────┐ ┌──────────┐   │                              │
│ │GeoJSON   │ │ KML/KMZ  │   │ Sanity-check before commit   │
│ │ Features │ │ PlaceMrks│   │                              │
│ │ + Geo    │ │ & paths  │   │                              │
│ └──────────┘ └──────────┘   │                              │
│ ┌──────────┐                │                              │
│ │ GPB      │                │                              │
│ │ Protocol │                │                              │
│ │ Buffers  │                │                              │
│ └──────────┘                │                              │
│                             │                              │
│ ─────────────────────────── │                              │
│                             │                              │
│ OPTIONS BLOCK               │                              │
│ Filename: [track]           │ format-specific
│ Extension: [.gpx ▼]         │ (GPX: sort, include-ext,
│                             │  BOM, precision)
│ ☑ Sort by time             │
│ ☑ Include GPX extensions   │ conditional warning if
│ ☑ Add BOM (UTF-8)          │ notional points present
│ Coordinate precision: [6]   │ → must acknowledge before
│                             │ export enabled
│ ─────────────────────────── │
│                             │ Large GPX routes through
│ ⚠ Dataset contains 47      │ chunked Worker + inline
│ notional/interpolated pts   │ progress bar + Cancel
│ ☑ I acknowledge above       │
│                             │
│      ┌──────────────┐       │
│      │ EXPORT ▼     │ ← teal│
│      └──────────────┘       │
│      (or: [Cancel export])  │
└──────────────────────────────┴──────────────────────────────┘

Preview updates live as format selected. Warning banner conditionally
appears if dataset has notional points (hard-blocks export without ack).
Progress/cancel bar appears for long GPX worker jobs.

═══════════════════════════════════════════════════════════════════════════

█ TAB READOUT: SOURCES (Tab 12)

Simplest panel: multi-dataset visibility control (display-only, non-destructive).

┌──────────────────────────────────────────────────────┐
│ " Visibility is display-only — never changes any data"
│                                                      │
│ ┌────────────────────────────────────────────────┐   │
│ │ •│🟠│ dataset_A.gpx      (4,281) [visible ☑][→]│   │ dot=active
│ │  │  │ dataset_B.csv      (892)   [visible ☑][→]│   │ color swatch
│ │  │  │ dataset_C.kml      (342)   [hidden  ☐][→]│   │ name, count
│ │  │  │ (3 datasets loaded)                       │   │ visibility
│ │ ┌────────────────────────────────────────────┐ │   │ checkbox
│ │ │ Make active │ (right-align button)         │ │   │
│ │ └────────────────────────────────────────────┘ │   │
│ └────────────────────────────────────────────────┘   │
│                                                      │
│ ON MAP:                                              │ how visibility
│  — Active dataset (dataset_A): full color, solid    │ renders on Map
│  — Visible companions (B, C): fixed colors, dashed  │
│  — Hidden datasets: not rendered                    │
│                                                      │
└──────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════

█ TAB READOUT: FUSION (Tab 13)

Multi-source auto-combine workflow. Produces new fused dataset + evidence record.

┌──────────────────────────────────────────────────────────────┐
│ DATASET SELECTOR (pick 2+ datasets to fuse)                 │
│  ☑ dataset_A.gpx (4,281 pts)                                │
│  ☑ dataset_B.csv (892 pts)                                  │
│  ☐ dataset_C.kml (342 pts)                                  │
│                                                              │
│  Alignment: [Nearest-time ▼]  Tolerance: [5 sec]           │
│  Fusion rule: [Average positions ▼]                         │
│                                                              │
│ ─────────────────────────────────────────────────────────────│
│                                                              │
│  [◀ Previous fusion] [Next fusion ▶]  [+ New fusion]       │ navigation
│                                                              │ + start
│                                                              │
│  FUSION EVIDENCE (expandable details blocks)                │
│  ✓ Run #1 (2024-06-15 14:22:00)                            │
│    ├─ Source registrations: [dataset_A, dataset_B] → fused │
│    ├─ Grouping method: time-aligned nearest neighbors      │
│    ├─ Points fused: 4,281 → 3,847 (gap-handling merged 434)│
│    └─ Quality checks: ✓ no cross-reference conflicts       │
│                                                              │
│  ✓ Run #2 (2024-06-15 14:35:00)                            │
│    └─ [Similar expandable summary]                         │
│                                                              │
│  [✓ fused_A_B_20240615 ▼] (active, download/archive)      │ output
│                                                              │
└──────────────────────────────────────────────────────────────┘

Fused datasets viewable/reusable across session. Evidence record persists
with each run; re-openable and inspectable.

═══════════════════════════════════════════════════════════════════════════

█ GLOBAL SIGNAL PATTERNS

No modal-heavy design. Two exceptions:
  1. REPORT EXPORT DIALOG (checklist, center overlay)
  2. NATIVE window.confirm() (delete recipe, delete KML library entry)
     — rare, irreversible actions only.

Everything else: inline panel state.

ERROR BOUNDARY: full-viewport red-bordered card if render error escapes
(data-tool constraint: crash must be unmistakable, not silent/partial).

BUSY SIGNAL: header spinner + label replaces dataset counter during blocking
ops (CSV parse, dataset build). Progress bar at tab-content top (w/ optional
Cancel for cancellable work: CSV build, GPX worker export).

TOAST: short notification (~3.2s auto-dismiss) for load/transform/export/
project actions. Single at a time; new one replaces old. Floats above log dock.

KEYBOARD NAVIGATION (Overview/Table/Chart/3D only):
  ← / → : move cursor one step
  Shift + ← / → : extend range selection
  Enter : commit cursor as persistent selection
  Home / End : jump to track start/end
  Escape : clear all selection

═══════════════════════════════════════════════════════════════════════════

█ DESKTOP (ELECTRON) VS. BROWSER

UI is identical with two conditional exceptions (gated by
`isDesktopKmlLibraryAvailable()`):

  1. Persistent KML/KMZ overlay library (saved to disk, available across
     sessions). Browser build: no persistent filesystem, feature silent-no-op.

  2. Map tab enabled even with zero datasets (purely to browse library).
     Browser build: Map tab disabled until ≥1 dataset loaded.

No other panel, tab, or control differs. Feature-parity otherwise.

═══════════════════════════════════════════════════════════════════════════

█ WRAP-UP

One workbench. Thirteen capabilities. Sparse, dense, focused. The tab bar
is the navigator, the sidebar is the manifest, the log console is the
autopsy report. Selection is synchronized. Quality problems are marked
once and visible everywhere. No redundant context switches.

Cold boot to first useful analysis: Import → CSV Mapping → Overview (3 tabs).
Full exploration suite: Map + Charts + Table + 3D + Compare for
multi-axis inspection.

Transformation + Project + Export + Sources + Fusion for pipeline/output.

All 13 tools always visible (disabled if locked out by preconditions), not
hidden behind progressive disclosure or hamburger menus. Learn the surface
area at a glance. This is an engineering tool, not a consumer app. Density
and context permanence over chrome minimalism.

┌──────────────────────────────────────────────────────────────────────────┐
│ SIGNAL LOST                                                              │
│ Scan complete. All 13 panels logged. Navigation model documented.       │
│ Passing to style/theme phase for color/motion/typography readout.       │
└──────────────────────────────────────────────────────────────────────────┘
