# JDDC Feature Inventory

An exhaustive reference for every control, behavior, and rule in the workbench. It is the source
material behind `public/user-guide.html`, and stands on its own as a developer reference.

**Organization:** By functional area (shell, pipeline, visualization, desktop).
**Scope note:** this describes what each control *does*. For why the app is shaped this way, see
`FUTURE_CONSIDERATIONS.md`; for what is planned, `ROADMAP.md`; for what shipped, `CHANGELOG.md`.

---

## Part 1: App Shell & Global Controls

### Main Window
- **App title/subtitle** — "Joint Domain Data Compiler" / "TSPI flight-data conversion & analysis workbench" (static branding)
- **Spinner** — displayed next to status light while async operations (import/analysis/build) are in progress; shows operation text ("Analyzing…", "Building dataset…", "Parsing…")
- **StatusLight** — persistent indicator: `idle` ("No datasets loaded"), `busy` ("Working"), `ok` ("Ready", shows dataset count), `warn` (N warnings), `error` (N errors); precedence: errors > warnings > ok

### Sidebar
- **"+ Load data" button** — opens hidden `<input type="file" multiple>` picker; accepts `.csv,.tsv,.txt,.gpx,.geojson,.json,.kml,.kmz,.nmea,.gps,.log,.gpb,.bin`
- **Dataset list** — one row per loaded dataset (name, source format, point count `format · N pts`)
  - Click row → sets active dataset; if on Import/Mapping tab, switches to Overview
  - **Remove button (×)** — deletes dataset, history, operation records, recipes, bookmarks, fusion artifacts; reconciles Comparison refs; re-selects another dataset if removed one was active
- **"Supported in:" footer** — informational format badges (title = format description)

### Tab Bar
Always present; tabs enabled/disabled by state:
1. **Import** — always enabled
2. **CSV Mapping** — enabled only if pending CSV
3. **Overview** — enabled if dataset active
4. **Map** — enabled if dataset active OR desktop KML library available
5. **Charts** — enabled if dataset active
6. **Table** — enabled if dataset active
7. **Points** — enabled if dataset active
8. **Compare** — enabled if ≥2 datasets
9. **3D** — enabled if dataset active
10. **Transform** — enabled if dataset active
11. **Project** — enabled if ≥1 dataset
12. **Export** — enabled if dataset active
13. **Sources** — enabled if ≥1 dataset
14. **Fusion** — enabled if ≥2 datasets
15. **Settings** — always enabled

**Active dataset name** shown at right of tab bar.

### Global Progress & Control
- **Progress bar** — visible when `progress !== null` (CSV analysis/build); shows % + busy text
- **Cancel button** — visible only while building CSV; sets cancel flag, produces "CSV import cancelled." toast

### Global Undo/Redo
- **Undo button (↶)** — pops history; disabled when no history
- **Redo button (↷)** — re-applies future state; disabled when no future stack

### Log Dock
- **Collapsed bar** — shows "▲ log" button, single most-recent log line, counters (N err, N warn, N total)
- **Expanded state** — shows "▼ log" button, level filter select, text filter input, autoscroll checkbox, counters, Export & Clear buttons, scrollable log stream (time, level badge, category, message, detail JSON)

### Toast Stack
- Up to 3 toasts visible simultaneously; older ones drop off
- Each toast: icon (info/success/warn/error), message + optional detail, auto-dismiss (info/success 3.6s, warn 6s, error 9s), manual dismiss (×)
- Tone auto-inferred from message text unless explicit
- Roles: info/success → `role="status" aria-live="polite"`; warn/error → `role="alert" aria-live="assertive"`

### Global Escape Key
- Clears all point/range selection app-wide unless modal (RepairPreviewDialog, ConfirmDialog) intercepts with `stopPropagation()`

### Unsaved Changes Guard
- Browser: `beforeunload` prompt when `projectDirty`
- Electron: native close-confirmation dialog (text: "This project has unsaved changes. Closing now discards every change made since the last save."); buttons: "Close without saving" (closes) / "Cancel" (default, aborts close)

---

## Part 2: Import & Data Loading

### ImportView Tab
- **Dropzone** — "Drop TSPI data here" / "or click to browse"; drag-over toggles `.drag` class
- **Format pills** — one per INPUT_FORMATS (CSV/TSV, GPX, GeoJSON, KML/KMZ, NMEA 0183, GPB, EAG); informational
- **Conversion matrix note** — explains unified point model, export targets, auto-detection (DMS/comma decimals, epoch/Excel/ISO times)

### File Ingestion Logic
- **`.kml/.kmz` on desktop** → saved to persistent KML/KMZ library; `.kmz` requires Electron
- **`.txt` ambiguity** → sniffs content to disambiguate EAG vs CSV
- **CSV/needs-mapping** → routed to `analyzeCsv` (Web Worker), opens Mapping tab on completion
- **All other formats** → parsed directly, added via `addDataset`
- **Every imported file** (except KML/KMZ) mirrored into local file archive (desktop best-effort)

### File Archive (Electron Only)
- **`archiveFile(direction, name, data)`** — saves timestamped+UUID-suffixed copy of imported/exported file
- **`revealFileArchive()`** — opens archive folder in OS file manager
- Exposed in ProjectPanel as "Open archive folder" button

### KML Library (Electron Only)
- **`listKmlLibrary()`** — enumerate stored KML/KMZ files (sorted newest-first)
- **`saveKmlLibraryFile(file)`** — persist imported KML/KMZ
- **`readKmlLibraryText(name)`** — read/extract KMZ
- **`removeKmlLibraryFile(name)`** — delete from library
- **`reseedKmlLibrary()`** — re-fetch bundled/remote overlays
- **`revealKmlLibrary()`** — open library folder in OS file manager

---

## Part 3: CSV Mapping Panel

### Summary Strip
- Delimiter, column count, sampled rows, "N valid in sample" (read-only)
- Valid count shown with `warn` styling if 0

### Preview & Configuration
- **"Preview first N physical rows" `<details>`** — expands raw sampled table
- **"Header interpretation override" checkbox** — toggles `additionalHeaders` mode; shows auto-detected count + confidence + reason
- **"Data begins after row" number input** — sets `dataStartRow` (min 0, max sampled-1)
- **"Why row 1 looks like a header / does not" `<details>`** — lists heuristic reasons per column

### Column Mapping (Required: Lat/Lon)
- **Latitude dropdown** — required; shows confidence % when ≥45%; includes InfoTooltip (column name, type, 4 sample values)
- **Longitude dropdown** — required; same as above
- **Build disabled** until both lat/lon mapped

### Optional Mappings
- **Elevation dropdown** — optional; unit select ("Meters" / "Feet")
- **Timestamp dropdown** — optional; format select ("Auto-detect", "ISO 8601", "Epoch seconds", "Epoch milliseconds", "Epoch microseconds", "Excel serial date", "IRIG range time")
- **Name dropdown** — optional
- **Description dropdown** — optional

### Column Swap Hint
- **"⚠ Reversing latitude/longitude yields more valid points…"** + **"Swap" button** — shown only if swapped count ≥ max(8, 1.5× current)

### Build Action
- **"Build dataset from full CSV" button** — dynamic label ("Building dataset…" while busy); streams full CSV through mapping, computes checksum, creates dataset, switches to Overview
- Disabled until lat/lon mapped and not already building

---

## Part 4: Data Transformation (TransformPanel)

### Global Controls
- **Undo / Redo buttons** — pops/pushes history; disabled per state
- **Point count readout** — read-only current state
- **"Scope to selection" checkbox** — limits ops to selected index range where supported; disabled when no range selected
- **"Preview repairs" checkbox** — tooltip "Draw original & proposed repair on one frame, apply nothing until Accept"; toggles repair-gate gating (session-only, not persisted)
- **"Restore original" button** — with dynamic title; opens ConfirmDialog; resets to original import, clears operation history

### Operation History & Named Recipes
- **"Operation history (N)" `<details>`** — lists last 20 ops reverse-chrono with time + summary; flags non-replayable entries
- **"Replay verified history" button** — replays all history against retained original snapshot; disabled + shows reason if no source
- **Recipe name field** — placeholder "e.g. clean and derive"
- **"Save named recipe" button** — disabled + shows reason unless history is replayable, source exists, name non-empty
- **"Named recipes (N)" `<details>`** (open by default) — lists recipes with op count; shows "— loaded" tag
  - **"Load" button** per recipe
  - **"Replay" button** per recipe
  - **"Delete" button** per recipe → opens ConfirmDialog

### OpGroup: Validity & Structure
1. **Sort by time** — Apply button; orders points chronologically; untimed last
2. **Swap lat/lon** — Apply / Apply to range button
3. **Drop invalid** — removes points outside valid lat/lon ranges (full dataset only)
4. **De-jitter timestamps** — duplicate policy select (nudge +ε / drop / average); ε(ms) field; Apply / Apply to range
   - drop/average cannot be scoped; Apply button disabled when scoped + non-nudge
5. **Clip to time window** — start/end ISO or epoch fields; "untimed points" select (keep/drop); Apply button
   - Disabled when no time bounds; blank fields fall back to selection/full bounds

### OpGroup: Outliers & Smoothing
1. **Drop outliers** — channel checkboxes (position/elevation/speed); window, σ, motion profile (Aircraft/Ground/Marine/None); "reconstruct" checkbox; context points field
   - Reconstruct disabled + forced off if any point untimed
   - Apply disabled unless channel selected
   - Supports selected-range scope (detection uses full track)
2. **Elevation filter** — mode select (rolling median / EMA / Hampel); mode-specific fields; Apply / Apply to range
3. **Smooth** — window field; position/elevation checkboxes; Apply / Apply to range
   - Apply disabled unless at least one channel checked

### OpGroup: Density & Precision
1. **Reduce points** — mode select (dedupe / decimate / simplify); mode-specific numeric field; Apply button (full dataset only)
2. **Round precision** — coordinate decimals, elevation checkbox + decimals, numeric channels checkbox + decimals; Apply / Apply to range

### OpGroup: Resampling & Gaps
1. **Resample to fixed rate** — rate (Hz) field; interpolation select (linear / step); "skip large gaps" checkbox + field; Apply button with progress + Cancel while running (Web Worker)
   - Full dataset only
2. **Resample by distance** — interval (m) field; Apply button; Fritsch–Carlson monotone cubic (full dataset only)
3. **Fill gaps** — gap threshold, sample interval, context points, motion profile; Apply button
   - Full dataset only; requires strictly increasing timestamps
   - Apply disabled when sample interval > gap threshold
   - Inserted points flagged "interpolated"; fills skipped if motion profile violated

### OpGroup: Derive
1. **Derive kinematics** — Apply button; computes distance, speed, heading, turn rate, accel, sample timing (full dataset only)
2. **Shift time** — seconds field; Apply button
3. **Offset elevation** — meters field; Apply button

### Repair Gate Logic
- With "preview repairs" on + visualizable diff → RepairPreviewDialog, destructive ConfirmDialog never shown for that run
- With "preview repairs" off (or no visualizable diff) → destructive ConfirmDialog used instead
- Resampling also routes through repair gate check

---

## Part 5: Repair Preview Dialog

### Structure
- **Dialog title** — "{operation title} — proposed repair"
- **View tabs** (role=tablist) — "Plan view" / "Profile" (only if multiple views available)
  - Plan: position/geometry changes
  - Profile: elevation/time changes

### Visualization & Details
- **`TrackDiffPlot`** — before (Original, muted/dashed) vs after (Proposed, solid); added/removed/moved markers; scale bar
- **Fact list** — structured before/after facts
- **Optional note** — "Scoped to selected range X–Y" if applicable
- **Warnings list** — if any, shown with `warn` styling

### Actions
- **"Revert" button** — discards repair, track unchanged, logs "Reverted: {summary}"; has initial focus
- **"Accept" button** — applies repair via normal transform pipeline (undoable)
- **Escape key / backdrop click** — both act as Revert; `stopPropagation()` prevents global selection clear
- **Footer note** — "Nothing has been applied yet. Closing this reverts."

---

## Part 6: Point Inspector Panel

Mounted only on Charts tab, next to TimeSeriesChart.

### Visibility & Edit Mode
- Renders `null` if no point selected
- **"✎ Edit" chip button** — tooltip "Edit this point"; begins edit; shows warning box on first unlock per dataset
- **Warning box** — "Editing writes real values into this track. Change recorded as undoable operation, but derived channels (speed/heading) not auto-recomputed."
  - **"Understood, unlock fields" button** — acknowledges, unlocks fields
  - **"Cancel" button** — dismisses without unlocking
- **"✓ Apply" chip button** — tooltip "Apply changes"; validates draft, commits via `edit-point` operation (undoable)
  - Shown only while unlocked
- **"Cancel" chip button** — tooltip "Cancel edit"; discards draft, re-locks fields
  - Shown only while unlocked

### Scalar Fields
All read-only by default; editable text inputs when unlocked:
- Latitude, Longitude, Elevation (m), Time (UTC), Name, Description
- Lat/Lon parsed via `parseCoordinate`; Elevation via `parseNumber`; Time via ISO parse
- Unparsable values → inline error text ("Latitude could not be parsed"); blocks Apply

### Extension Channels
- One row per `point.ext` key; read-only by default
- Editable text input or checkbox (for booleans) when unlocked
- Value coerced to original type
- **"stale" badge** — tooltip "Computed before manual edit changed an input. Re-run Derive kinematics to refresh."; marks channels in `point.provenance.staleChannels`

### Channel Details
- **"Channels (N)" `<details>`** (open) — expands extension-channel list; only shown if point has extension channels

---

## Part 7: Visualization: Map

### Display & Basemap
- **Display mode select** — "Path + Points" / "Path only" / "Points only"
- **Basemap select** — "OpenStreetMap" / "OpenStreetMap Dark" / "OSM Humanitarian" / "OpenTopoMap" / "offline grid"
- **Basemap error banner** — "⚠ Basemap tiles failed to load (offline?) — track data still fully usable." + "Switch to offline grid" button (only when tiles error and basemap ≠ none)
- **Basemap network notice** — "Basemap requires network access; local track data does not." (while basemap status unknown)

### Visualization Controls
- **Color-by select** — "none", "elevation", plus remaining numeric channels
  - Color legend swatch (gradient bar with min/max labels) shown only when `colorBy !== 'none'` and values exist
- **Split-gaps input** — sets `maxGapMinutes`; gaps beyond threshold break polyline, mark quality events
- **Density toggle** — show/hide spatial density heatmap
- **Density cell size input** — meters (min 1, step 50); only shown when density checked

### Navigation & Fit
- **Fit active button** — fits map to active track's rendered points
- **Fit visible button** (N) — fits to active + all other visible datasets; only shown when `otherTracks > 0`; N = count+1
- **Fit range button** — fits to current index-range selection; disabled unless range with valid positions exists

### Data Summary & Selection
- **Point/valid count readout** — "{n} valid pts · {m} drawn" (m = downsampled to `mapPointBudget` from Settings)
- **Selection chips:**
  - **Point chip** — label "selected #{index}"; jump ("Centre the map on this point") / clear
  - **Range chip** — label "range {start}–{end}", tone `range`; jump ("Fit map to this range") / clear
- **Other-visible-tracks legend** — "other visible:" + colored name chips; only shown when other tracks visible

### Interaction
- **Pan/zoom** — react-leaflet MapContainer with `scrollWheelZoom` enabled
- **Point click-to-select** — clicking CircleMarker toggles point selection (mode ≠ `path`)
- **Point hover** — sets `hoverIndex`, shows cyan ring + "cursor #N" tooltip (mode ≠ `path`)
- **Point tooltip** — mono block: index, lat/lon, notional warning, "selected range", elevation, ISO time, name, channel value

### Quality & Overlays
- **Quality event markers** — amber circle (gap) / red dashed (coordinate jump); tooltip shows event kind + explanation
- **Start/end markers** — green "start" / red "end" circle markers
- **Selection highlight polyline** — thick yellow line for selected index-range (mode ≠ `points`)
- **Other-track rendering** — colored polylines/polygons per dataset (by `sourceFeatureIndex`); capped at MAX_OVERLAY_SHAPES × MAX_OVERLAY_SHAPE_POINTS
- **Empty state** — "No valid coordinates to display." (still shows overlay panel)
- **Auto resize** — ResizeObserver calls `invalidateSize()` on container resize

---

## Part 8: Visualization: Map Overlay Panel

### Library Management
- **Drawer toggle** — "Overlays" / "Overlays (v/n)"; collapses/expands overlay manager with visible/total count
- **Overlay library picker** — `<select>` placeholder "Select a KML/KMZ overlay…"; shows `visibleEntries`
- **Show selected button** — adds picked library file as visible overlay; disabled while busy; rejected if name/source-key too long or MAX_OVERLAY_COUNT reached (specific error messages)
- **Import overlay button** — "+ Import overlay"; opens hidden file input (`.kml,.kmz` multiple)
- **Refresh button** — reloads library from disk/session, reconciles overlay state; disabled while busy
- **Reset bundled seed button** — restores bundled KML files without overwriting existing; Electron-only; disabled while busy
- **Open folder button** — reveals KML/KMZ library folder in OS file explorer; Electron-only
- **Stored file count** — "{n} stored file(s)" (informational)
- **Error line** — "✕ {message}"; `role="alert"` (e.g., rejection reasons, "KMZ requires Electron", "not a .kml/.kmz file")
- **Status line** — "✓ {message}"; `role="status"` (e.g., "Saved N file(s)…", "{name} is now visible…")

### On-the-Map List
- **Heading** — "On the map"
- **Empty state** — "No overlays shown yet. Use 'Show on map' below on a stored file."
- **Per-overlay row:**
  - Visibility checkbox — `aria-label="Toggle visibility of overlay {name}"`
  - Source badge — "📦 Bundled seed" / "🗂 Project" / "📁 Library"
  - Status line — "✓ Ready" / "⚠ Missing source file" / "✕ Failed to load"
  - Opacity slider — 0–1, step 0.05; shows `{pct}%` readout; `aria-label="Opacity for overlay {name}"`
  - Reorder buttons — "▲" / "▼"; `aria-label="Move overlay {name} up/down"`; disabled at list ends
  - Remove from map button — removes overlay (keeps library file)

### KML/KMZ Library Table
- **Columns** — file | kind | size | modified | actions
- **Empty state** — "No KML/KMZ files stored yet."
- **Bundled badge** — "📦 bundled" (marks seed files)
- **Per-row actions:**
  - "Show on map" — same as library picker + Show button
  - "Import as track" — routes KML/KMZ through normal dataset-import flow
  - "Remove" — deletes from library after native `window.confirm` dialog; also removes overlays referencing it

### Explanatory Copy
- "Files uploaded here are separate map overlays, not TSPI datasets…"

---

## Part 9: Visualization: Charts

### Chart Type & Preset
- **Chart type selector** — (delegates to ChartTypeSelector) "Time Series" / "Scatter" / "Area"
- **Mismatch warning banner** — "⚠ This chart type doesn't match your data." + validator reason + "Switch to {recommended}" button
- **Auto-correction toast** — "'{old}' doesn't fit this dataset — switched to '{new}'." (when dataset changes underneath incompatible chart type)
- **Preset select** — options: "Altitude over time", "Ground speed over time", "Vertical speed over time", "Heading and turn rate", "Sample timing", "Altitude over distance"; applies bundled channel/x-axis combo, resets zoom

### Channel Management
- **Channel chips** — one per available channel (label = channel name); toggles that channel on/off in plot; active chip colored per palette
- **X-axis select** — "time" (if `hasTime`), "index", "distance" (if `hasDistance`), plus "{channel} (channel)" options when scatter
  - Manual selection resets preset to "custom", resets zoom

### Selection & Navigation
- **Selection chips:**
  - **Point chip** — label "point #{index}"; jump ("Zoom chart to this point") / clear
  - **Range chip** — label "range {start}–{end}", tone `range`; jump ("Zoom chart to this range") / clear
  - **Multi-select chip** — label "set of {n}", tone `set`; clear only (no jump)
  - Shown when corresponding selections active
- **Delete points button** — "Delete {n} point(s)"; confirms via dialog, then deletes set (undoable from operation history); requires `onDeletePoints` prop, non-empty set
- **Reset zoom button** — "Reset zoom ×"; clears both X and Y zoom domains; only shown when zoomed

### Export
- **Export SVG button** — title "Export the current chart view as a standalone SVG file"; serializes & downloads/archives
- **Export PNG button** — title "Export the current chart view as a PNG image"; rasterizes & downloads/archives

### Interaction
- **Click-to-select** — click (no drag) selects nearest sample on reference series; distance-unbounded nearest search
- **Drag-to-zoom** — dragging on plot zooms X to span; pixel span ≥ 5px else treated as click
- **Wheel zoom (X)** — mouse wheel zooms X-axis, cursor-anchored
- **Shift+wheel / trackpad swipe** — pans X domain
- **Ctrl/⌘+wheel** — zooms Y domain (fraction of each series' span), cursor-anchored
- **Ctrl/⌘+shift+wheel** — pans Y domain
- **Ctrl/⌘+click** — toggles nearest sample into delete set (only when reference series not downsampled)
- **Ctrl/⌘+drag** — adds samples between drag endpoints to delete set (same precondition)
- **Shift+click** — extends delete set from anchor to clicked sample (same precondition)

### Display
- **Hover crosshair + readout** — persistent mono line: "cursor {x}" + per-series "{key} ({unit}): {value}"
- **Quality event markers** — vertical lines (solid/dashed/dotted by severity); `title="{kind} ({severity}): {explanation}"`
- **Time/x-range summary** — "{axis} range" / "start {..}" / "end {..}" / "(zoomed view shown above)" when zoomed
- **Range statistics readout** — "{n} pts", distance (m), duration (s), per-channel "μ {mean} · {min}–{max}"; only when range selected
- **Quality event count line** — "⚠ {n} quality event(s) detected…"; only when events exist
- **Usage hint text** — documents gestures; conditional sentence: "Ctrl/⌘+click or +drag adds to delete set…" OR "Zoom in to build delete set…"; note about downsampling budget (Settings)

### Chart Legend
- Per channel: color swatch (8-color palette), human label (dataset displayName+unit or raw key)
- **Show/Hide toggle** per item — calls `onToggleChannel(channelKey)`; toggles item visibility class + label state
- **Note:** deliberately decoupled from TimeSeriesChart's `selected` channels; affects only legend UI

### Chart Type Selector
- **Buttons** — "Time Series" / "Scatter" / "Area" (`role="group"` labeled "Chart type"); `aria-pressed` marks active
- **Disabled-button tooltip** — title = validator reason string when invalid:
  - Time Series: "Dataset has no timestamp data; time-series charts require a time value on each point."
  - Scatter: "Scatter charts require 2+ numeric channels (found {n})."
  - Area (no time): "Dataset has no timestamp data; area charts require a time value on each point."
  - Area (no channels): "Area charts require 1+ numeric channel (found {n})."
- **Accessible label** — `aria-label="{label} chart, unavailable: {reason}"` (screen-reader)

---

## Part 10: Visualization: Data Table

### Filtering & Control
- **Filter input** — placeholder "filter rows…"; free-text substring filter across all values
- **Row count readout** — "{shown} / {total} rows"
- **Export visible CSV button** — downloads/archives currently filtered+sorted rows; disabled when zero rows
- **Quality-events-only checkbox** — filters to quality-event-flagged rows; only shown when events exist
- **Next quality event button** — selects next flagged point after current (wraps); only shown when events exist
- **Selected-range-only checkbox** — filters to active index range; only shown when range exists

### Selection & Navigation
- **Selection chips:**
  - **Point chip** — label "selected #{index}"; jump ("Scroll to this row") / clear
  - **Range chip** — label "range {start}–{end}", tone `range`; jump ("Scroll to start of range"; unchecks "selected range only" on clear) / clear
  - **Multi-select chip** — label "set of {n}", tone `set`; jump ("Scroll to first selected") / clear
- **Delete set button** — "Delete {n} point(s)"; confirms via dialog, then deletes; only shown when set non-empty
- **Selection hint text** — "Ctrl/⌘+click a row to add/remove from delete set; shift+click extends it to a range." OR (when sorted/filtered) "shift+click adds one row at a time."; plus arrow-key navigation hint + role/modifiers

### Interaction
- **Column header sort** — click cycles ascending → descending → unsorted per column; shows "▲"/"▼" arrow
- **Row click select** — click toggles that point (toggle mode)
- **Row Ctrl/⌘+click** — toggles row into delete set
- **Row Shift+click** — extends set-range from anchor (natural order) or single-toggle (when sorted/filtered)
- **Row hover** — sets shared hover selection; syncs Map/Chart/3D cursor
- **Keyboard grid navigation** — ArrowUp/Down/Home/End/PageUp/Down move focus; Enter/Space activate (respects Shift/Ctrl modifiers); implemented in `handleGridKeyDown`
  - Grid has `tabIndex=0`, `role="grid"`
- **Auto cross-panel scroll** — scrolls grid to bring point/hover selected elsewhere into view (unless sorted/filtered/searched)

### Visual Indicators
- **Row flags** — "⚠" prefix on index cell + `quality-flagged` styling + `title` listing event kinds
- **Empty dataset state** — "This dataset has no points to visualize."

---

## Part 11: Visualization: Track Health Panel

### Health Score
- **Health score badge** — numeric score + label ("Excellent"/"Good"/"Fair"/"Poor"), colored by band (≥90 green, ≥75 blue, ≥60 amber, else red)
  - Shown only when scan status `ready` and `report.status === 'scored'` with non-null score
- **Re-scan button** — "Re-scan" / "Scanning…" while busy; disabled while scanning
- **Scanning progress** — Spinner + ProgressBar (indeterminate if no total)

### Loading & Error States
- **Skeleton loading** — 6 placeholder check rows while scanning and no report yet
- **Scan error** — "Scan failed: {error}" + "Retry" button
- **Blocked state** — "Unreliable — cannot score" + blocking reason
- **Unscoreable state** — "Not enough data to score" / "No weighted check could run against this track."

### Per-Check Rows
- Badge "Pass" / "Fail" / "N/A"
- Check label
- Points: "{awarded}/{weight}" or "gate" or "—"
- Summary text
- Optional detail bullet list

### Repair & Drill-Down
- **Repair flagged points button** — runs drop-outliers/reconstruction with same detector thresholds; only for `outlier` check when `status === 'fail'` and flagged
- **Repair helper text** — explains method (reconstruct with Aircraft profile at scan thresholds) OR (removal if untimed points exist); "Undoable."
- **Flag chips** — button per flag (label = flag.label); `title="Show on map"` or `"Show on chart"`
  - Drill-down: selects flagged point/range in selection state, switches to Map or Charts tab
- **Meta footer** — "{n} points", "{n} warning(s)" (warning count only if > 0)

### Hook: useTrackHealthScan.ts
- Runs scan on Web Worker (`track-health-scan` task)
- Auto-triggers on dataset identity change (debounced zero-delay timer)
- Cancels superseded runs
- Exposes `rescan()` for button clicks

---

## Part 12: Visualization: Track Metrics & Stats

### TrackMetricsPanel (read-only report)
- **Metric cards** — "Elapsed", "Distance", "Max speed", "Min speed", "Max altitude", "Min altitude"
- **Time span table** — start, stop, elapsed, avg rate, ordering (ascending / out-of-order)
- **Point accounting table** — total, valid/invalid coords, with timestamp, with elevation, duplicate coords, plus provenance counts (Interpolated, Hampel-corrected elev, EMA-smoothed elev, De-jittered timestamp, etc.)
- **Dropped at import table** — (only if any) humanized reason rows + total offered
- **Metadata detected table** — file/size/parser/imported-at, coordinate system, altitude/time reference, format-specific fields (GPX creator, EAG platform/exercise/mission, GPB track name); or "No metadata detected…"
- **Footnote** — speed derived from great-circle distance (only if speed stats exist)

### StatsPanel (read-only report)
- **Metric cards** — "Points", "Valid coords", "Distance", "Duration", "Avg rate", "Max speed", "Elev gain", "Elev range"
- **Import summary** (if `dataset.metadata.source` exists) — file, accepted/warnings, checksum (sha256 truncated + full in title), parser, references
- **Bookmarks section:**
  - Heading "Bookmarks (n)"
  - Label input (placeholder "Select a point to bookmark it" or "Label (default: Point #{i})"); disabled when no point selected
  - "Bookmark current point" button; disabled when no point selected
  - Bookmark list (button per bookmark = label; shows index + ISO time); empty state: "No bookmarks yet…"
  - Remove bookmark button ("×"; `aria-label="Remove bookmark {label}"`)
- **Selection controls:**
  - Start time / End time `datetime-local` inputs (step 0.001)
  - "Select time range" button; disabled unless both parse
  - Time-range selection chip (label "{isoStart} → {isoEnd}", tone `range`); clear only
- **Segment chips** — button per detected segment ("{kind}", "#{start}–{end}", "{n} pts"); selects that segment as active range; empty state: "No segments available."
- **Keyboard shortcuts hint** — documents ←/→ (cursor), Shift+←/→ (extend range), Enter (select cursor), Home/End (jump), Escape (clear)
  - **Note:** this is documentation only; implementation lives elsewhere
- **Data-quality list** — Coordinate validity / Timestamps present / Time monotonic / Elevation present / Duplicate coords; ✓/! with detail
- **Quality-event summary** — "Detected events: {n}" + counts by kind (gaps, dup timestamps, coord jumps, invalid coords, elev spikes, elev flatlines); or "No additional timing/coord events detected."
- **Time-span / bbox readouts** — ISO start→end, lat/lon bounding box
- **Warnings list** — "⚠ {warning}" per dataset warning; only if warnings exist
- **Channels table** — columns "channel | n | min | max | mean | σ"; per-channel numeric stats; or "No extension channels."

---

## Part 13: Visualization: 3D Trajectory

### Camera & Display
- **Altitude exaggeration** — numeric 0.1–100, step 0.5
- **Color channel** — "single color" / "elevation" / dataset channels
- **Projection** — "perspective" / "orthographic"
- **Gap-split** — seconds, min 0
- **Ground grid checkbox**
- **Vertical curtain checkbox**
- **Points checkbox**
- **Reset camera button**
- **Top / Side view buttons**
- **Fit trajectory button** — resets zoom/pan, keeps yaw/pitch

### Selection & Playback
- **Selection chips:**
  - **Point chip** — label "selected #{index}"; jump ("Centre scene on point") / clear
  - **Range chip** — label "range {start}–{end}", tone `range`; jump ("Centre on range midpoint") / clear
- **Play / Pause buttons** — animates marker along trajectory
- **Restart button** — resets playback position to 0
- **Playback scrubber** — range input 0–1; `aria-label="Playback position"` (manual scrub pauses playback)
- **Playback speed select** — "0.25×", "0.5×", "1×", "2×", "4×"
- **Playback % readout** — "{pct}%"

### Interaction
- **Orbit drag** — left-drag rotates camera (yaw/pitch)
- **Pan drag** — shift+drag or right-drag pans camera; right-click context menu suppressed
- **Wheel zoom** — clamped 0.15×–12×
- **Hover select** — nearest vertex within 18px hit radius sets shared hover
- **Click select** — click (no drag) selects nearest vertex as persistent point selection

### Metadata & State
- **Reference metadata warning** — "Reference metadata is incomplete: 3D geometry is local visualization only and must not be used for cross-source altitude/time comparison." (shown if altitude or time reference UNKNOWN)
- **Companion tracks note** — "Shared ENU frame includes {n} compatible companion track(s) (purple)." (only if compatible companions exist)
- **Incompatible datasets warning** — "{n} dataset(s) excluded from shared 3D…" (only if incompatible)
- **Metric cards** — source points, valid coords, rendered vertices, E/N/U spans
- **Usage hint** — "Drag to orbit, Shift/right-drag to pan, wheel to zoom. Hover/playback updates cursor; click selects persistent point."

### Geometry Building
- `buildSharedTrajectory3dGeometry` / `buildTrajectory3dGeometry` (visualization/scene3d/trajectory.ts)
  - Converts geodetic points to local ENU frame
  - Applies `altitudeExaggeration`
  - Uniformly downsamples to `maxPoints` (default 20,000, driven by `scenePointBudget`)
  - Preserves endpoints
  - Computes per-channel `colorRange` for "color channel" select
  - Throws (surfaced as panel errors) if no valid coordinate or invalid exaggeration/maxPoints

---

## Part 14: Visualization: Point Visualizer Panel

### Navigation
- **Prev button** — "← Prev"; `aria-label="Previous point"`; disabled at index 0
- **Index input** — numeric field; `aria-label="Point index"`; only accepts valid integer in range
- **Next button** — "Next →"; `aria-label="Next point"`; disabled at last index
- **Total count** — "of {n}"
- **Neighbourhood size** — "±5", "±10", "±25", "±50", "±100"
- **Default-view hint** — "Showing first sample — select a point anywhere in workspace to follow…"

### Quality & Visualizations
- **Quality strip** — SVG strip colored by worst severity per column (`strip-error`/`strip-warning`/`strip-info`)
  - Click jumps to sample; hover previews; marker line shows current index
  - Caption: column-to-sample ratio when track is long
- **Neighbourhood plan view** — equal-aspect local SVG with scale bar
  - Click node to select; focus ring on current
  - "No plottable coordinates near this sample." when unavailable
- **Neighbourhood elevation profile** — small SVG line plot
  - Focus ring on current elevation sample
  - "No elevation profile near this sample." when < 2 elevation samples

### Point Details
- **Fields** — Latitude, Longitude, Elevation, Time, Epoch ms, Name, Description, Source record, Source segment, Geometry index (read-only)
  - Optional fields (Name/Desc) shown only if present
- **Quality flag badges** — per `qualityFlags` entry (only if flags exist)
- **Overlapping quality events** — bullet list "{kind} + explanation" (only if any overlap)
- **Neighbour deltas table** — columns "Leg | Δt | Distance | Implied speed | Δ elev | Bearing"
  - Rows: "from previous" / "to next"
  - Computes leg-by-leg kinematics
  - Shows "no neighbouring sample" at track ends
- **Channels details** — "`<details>` Channels (n), expanded by default"
  - Lists every `ext` channel value
  - Stale badge (tooltip: "Computed before manual edit…. Re-run Derive kinematics to refresh.") on stale channels
- **Empty dataset state** — "This dataset has no points to visualize."

---

## Part 15: Visualization: Comparison Panel

### Setup
- **Reference dataset select** — chooses baseline
- **Target dataset select** — dataset compared against reference
- **Tolerance field** — "tolerance (ms)" numeric, min 0; max time gap for nearest-time alignment
- **Target offset field** — "target offset (ms)" numeric; clock-offset correction
- **Interpolate checkbox** — switches between nearest-time and interpolated alignment

### Preconditions
- **Two-dataset guard** — "Load at least two datasets…" (shown if < 2)
- **Same-dataset warning** — "Choose two different datasets." (shown if reference === target)
- **Compatibility error** — blocks comparison when metadata incompatible
- **No-alignment message** — "No timed samples aligned within selected tolerance."

### Results
- **Metric cards** — aligned samples, closest slant range, mean slant range, max slant range, mean horizontal/along-track/cross-track range, max |cross-track|, estimated clock offset, estimated clock drift
  - Offset/drift show "n/a — not meaningful with interpolation enabled" when `interpolateTarget` on
- **Closest-approach summary** — "Closest approach at reference index {i}, target index {j}: bearing {b}°, Δt {d} ms, vertical separation {v} m."
- **Aligned-samples table** — columns "Ref | Target | Kind | Δt ms | Slant m | Horizontal m | Bearing° | Up m | Closure m/s"
  - Rows: time-aligned pairs; `Kind` = interpolated/observed
  - Capped to first 250 rows: "Showing first 250 aligned samples."
  - Reference-index link button per row (`aria-label="Select reference point {i}"`); calls `onSelectReferenceSample`
- **Export comparison CSV** — downloads/archives aligned samples + drift estimate

---

## Part 16: Data Transformation: Comparison Visualization (TrackDiffPlot)

No interactive controls; pure rendering driven by caller (RepairPreviewDialog).

### Plan View
- Original (muted/dashed) vs repaired (solid) track paths, equal-aspect local meters
- Scale bar (with `formatScaleBar`: "250 m", "1.2 km", "50 cm", etc.)
- Added/removed/modified markers (×/+/dot, capped MAX_DIFF_MARKERS=300, evenly sampled)
- Focus ring when `focusIndex` set
- Caption: "Paths drawn from every {Nth} sample (display only — full track applied)." or "Every sample drawn."

### Profile View
- Elevation-vs-x or timestamp-vs-index before/after
- Dashed original underneath solid repair (or "The repair resynthesized samples, so the two lines share only the axes." when `diff.alignment === 'rebuilt'`)

### Empty States
- "No plottable coordinates in either track — compare profile or counts below."
- "Neither track carries elevation/timestamps, so no profile to compare."

---

## Part 17: Fusion Panel

### Configuration
- **Empty state** — "Load at least two datasets to fuse…" (shown if < 2)
- **Explanation text** — "Pick two or more datasets to auto-combine into fused track…"
- **Source table** — columns: include checkbox, name, points, priority number field
  - Toggle dataset as fusion source; set numeric priority (field disabled unless included)
- **Time tolerance field** — "time tolerance (ms)", min 1; sets grouping tolerance
- **Manual source overrides** — `<details>` expands:
  - Point group select — "No point override" + time-aligned group options
  - Point source select — "Select source" + candidate sources (disabled until group chosen)
  - Interval start / end `datetime-local` inputs — define manual override interval
  - Interval source select — "Select source" + included sources (disabled unless interval set)

### Run & Results
- **Run Auto-Combine button** — runs grouping + auto-combine, creates new fused Dataset + FusionArtifact, switches to Fusion tab; disabled when < 2 datasets included
- **Compatibility gate line** — "⚠ Fusion blocked: {reasons}" or "Compatibility gate: {reasons or default}"
  - Styled as error when `level === 'blocked'`; run refused with error if blocked
- **Error line** — "⚠ {message}" (e.g., "Select at least two datasets…", "None have timed points…")
- **Fusion report** — markdown `<pre>` text; shown after successful run
- **Fusion evidence** — `<details>` "Fusion evidence (N persisted run(s))", open by default
  - Lists every past FusionArtifact (timestamp, decision timeline table: group | chosen source | skipped sources | reason/confidence | override)
  - Full markdown report per run
  - Shown only when ≥1 artifact exists

---

## Part 18: Notional Smoothing Panel

### Configuration & Execution
- **Panel header** — "Notional gap-fill (new track)"; explains separate track creation, gap-fill method, inserted-point flagging
- **Gap threshold field** — milliseconds, min 1; sets `gapThresholdMs`
- **Override sample interval checkbox** — toggles `useCustomInterval`
- **Sample interval field** — milliseconds, min 1; sets `sampleIntervalMs` (shown only when override checked)
- **Live preview** — "No gaps above threshold — nothing to fill." or "{N} gap(s) found; would insert {M} notional point(s)." or error text
  - Computed via `useMemo` on param change
- **Create derived track button** — creates + adds new dataset with notional points (never mutates source); disabled if preview errored or 0 gaps

---

## Part 19: Export Panel

### Format Selection
- **Format cards** — "GPX 1.1", "CSV", "GeoJSON", "KML", "EAG TSPI" (from EXPORTERS) + synthetic "GPB (binary)" (extension: 'gpb', description "Lossless JDDC binary container…")
- Active card highlighted

### Output Configuration
- **Output name field** — sets filename stem; extension tag shown (e.g. `.gpx`)
- **GPX-specific options** (shown only when target=gpx):
  - "Sort points by time" checkbox
  - "Include extension channels" checkbox
  - "Prepend UTF-8 BOM (legacy Windows)" checkbox
  - "Coordinate precision" number field (min 4, max 9)
- **EAG-specific options** (shown only when target=eag):
  - "Platform type" text (maxLength 1)
  - "Exercise ID" text
  - "Mission ID" text
  - "Field 4 (constant)" text

### Export Workflow
- **Export warnings list** — dynamic ⚠ lines from `preview.warnings`
- **Notional export gate** — "⚠ This dataset contains {N} notional (interpolated, not observed) point(s)…" + "I understand this export includes notional, non-observed samples" checkbox
  - Export blocked until acknowledged; reset to unacknowledged when active dataset id changes
- **GPX worker progress** — large GPX exports run on chunked, cancellable Web Worker (byte-identical to sync path)
  - Triggered automatically when `shouldUseGpxExportWorker(pointCount)`
- **Export button** — "Export {N} points"; dynamic count; disabled when 0 points or export blocked; tooltip explains block reason
  - Downloads + archives file

### Preview
- **Live preview pane** — "preview" / "first 1.4 KB" of serialized output (or "«binary GPB container» N bytes" for GPB)
- Recomputed on every option change

---

## Part 20: Project Panel

### Project State
- **Unsaved changes badge** — shown when `projectDirty`
- **Project name field** — sets `projectName` (stored in project manifest)
- **Project notes textarea** — placeholder "Purpose, assumptions, provenance, handoff notes…"; sets `projectNotes`

### Save/Open/Export
- **"Save complete project" button** — dynamic "Working…" while busy
  - Encodes full `.jddc-project` gzip archive (datasets, semantic metadata, undo/redo snapshots, active dataset/tab, selection)
  - Archives to local file archive
  - Disabled with 0 datasets or while busy
- **"Open project" button** — opens hidden file input (`.jddc-project,.json`)
  - Uses native `window.confirm("Open this project and discard unsaved workspace changes?")` only if `projectDirty`
  - **Note:** ProjectPanel is the one place `window.confirm` survives (not ConfirmDialog)
- **"Export manifest only" button** — human-readable JSON project manifest without embedded data; disabled with 0 datasets or busy
- **"Export HTML report" button** — opens ReportExportDialog; disabled with 0 datasets or busy

### Diagnostics
- **Diagnostics note textarea** — placeholder "Describe what happened…"; optional free-text included in bundle
- **"Export diagnostic bundle" button** — builds JSON bundle (app/workspace config, dataset summaries, recent logs, optional note; **excludes** raw points, KML/KMZ library)
  - Saves via desktop dialog or downloads in browser
  - Disabled while busy

### Metrics & Utilities
- **Metric grid** — read-only cards: "loaded datasets", "current points", "history snapshots", "history points", "active dataset", "active tab"
- **"Open archive folder" button** — opens desktop local file archive; Electron-only; calls `revealFileArchive()`
- **Error/status line** — dynamic text showing last error or success/status message

### ReportExportDialog (opened from "Export HTML report" button)

#### Configuration
- **Report title field** — prefilled with suggested title (project name + date)
- **Download filename field** — prefilled from suggested filename; sanitized separately; preview shows "{sanitizedFilename}.html"
- **"Evidence sections (n/N included)" `<details>` checklist** — 9 checkboxes:
  1. Source file, checksum, parser, reference-frame metadata
  2. Import/parser warnings
  3. Automated quality-event detection
  4. Bookmarks
  5. Recorded transform/operation history
  6. Cross-dataset comparison analytics
  7. Multi-source fusion decisions
  8. Data quality disclosure (notional/derived, manually edited points)
  9. Map overlay inventory
  - Toggle each section; prefilled from `persistedOptions` if remembered, else DEFAULT_REPORT_OPTIONS (metadata/warnings/quality events/bookmarks/operation history/notional disclosure default true; comparison/fusion/overlays default false)

#### State Persistence
- **"Remember these settings for this project" checkbox** — if checked at confirm time, persists chosen ReportOptions into workspace/project state
  - Always starts unchecked, even if previously remembered
- **"Reset to defaults" button** — resets title, filename, sections, checkbox to defaults

#### Actions
- **"Cancel" button** — closes dialog; no download
- **Escape key / backdrop click** — both close (no download)
- **"Generate report" button** — builds self-contained HTML analysis report
  - Title, generated timestamp, app version, datasets, bookmarks, operation records, overlays
  - Latest fusion run's report if fusion has run ≥1 time (only most recent)
  - Cross-dataset comparison summary, when that section is enabled: re-derived at export time
    from the saved Compare settings, so it is populated even if the Compare tab was never opened
    this session, and always describes the same dataset pair that tab would show. A configured
    comparison that aligned nothing reports zero samples rather than claiming no comparison
    exists. Re-deriving runs the alignment synchronously, so enabling the section on two long
    tracks can briefly block at export time; the work is skipped entirely when it is off.
  - Downloads file

---

## Part 21: Sources Panel

### Display
- **Empty state** — "Load one or more datasets to manage sources." (shown when 0 datasets)
- **Explanation text** — "Toggle which loaded datasets are visible as additional color-coded paths on map…Visibility is display-only — never changes or removes any dataset."
- **Sources table** — columns: active marker (●), color chip, name, format, points, visible checkbox, action
  - Read-only except checkboxes & action button

### Interactions
- **Visibility checkbox** — per dataset, `aria-label="Toggle visibility of {name}"`; toggles WorkspaceDisplay `visible` flag (affects Map `otherTracks`)
- **"Make active" button** — sets that dataset as active dataset; only shown for non-active rows

---

## Part 22: Settings Panel

### Display
- **Header** — "Settings"; note "Stored on this device, not inside any project…"
- **Visualization point budgets group** — three numeric inputs (type=number, step=100, clamped to configured min/max), shown as "Range min–max":
  - Chart point budget
  - Map point budget
  - 3D scene point budget
- **Display units group:**
  - Unit system `<select>` — Metric (m, km, m/s) or Aviation/marine (ft, NM, kn). Changes every
    distance, altitude, and speed *readout* across the Overview metrics, track metrics, Point
    Inspector, Compare tab (summary cards and the aligned-samples table, whose column headers
    carry the active unit), the map's point tooltip, and the chart window readout.
  - Deliberately unaffected: extension channel values and the units inferred from their key
    suffixes (an arbitrary channel is not metres), operation *inputs* such as the map's density
    cell size, and bearings, sample rates, and time deltas.
  - Stored data, every export, and the HTML analysis report stay in canonical metres and m/s
    regardless of this setting — stated in the panel's own help text.
- **Transform defaults group:**
  - Default motion profile `<select>` — populated from MOTION_PROFILE_IDS
- **Reset to defaults button** — disabled when all settings equal defaults; calls `resetSettings()`

---

## Part 23: Infrastructure & Dialogs

### ConfirmDialog
- `confirm(title, message, options)` async function returns boolean promise
- Single modal only; second concurrent request immediately resolves `false` (declined)
- Icon: "!" (destructive) or "?" (non-destructive, default)
- Cancel button (default label "Cancel", or `cancelLabel` option) → resolves `false`
- Confirm button (default "Continue", or `confirmLabel` option, e.g. "Apply", "Delete") → resolves `true`; styled `danger` if destructive, else `primary`; has initial focus
- Escape key / backdrop click → resolves `false` (Cancel); `stopPropagation()` prevents global selection clear
- Focus restore on close

### RepairPreviewDialog
(Covered above in Part 5)

### LogConsole
(Covered above in Part 1)

### Toast Stack
(Covered above in Part 1)

### InfoTooltip
- Small "i" info badge, tabbable; `role="tooltip"` popover on hover/focus
- Shows column name, estimated type, up to 4 example values (used in CSV Mapping UI)
- Renders nothing if no column supplied
- Passive/informational, no state-changing action

### SelectionChip (shared primitive)
Two-button chip: body (optional) jumps via `onJump`/`jumpTitle`; trailing × (`aria-label`/`title` = `clearLabel`) clears via `onClear`.

Tone styling: `point` (default, `chip-on`), `range` (`chip-range`), `set` (`chip-set`).

Call-site labels:
- MapView (point): "selected #{index}" | jumpTitle: "Centre the map on this point" | clearLabel: "Clear point selection"
- MapView (range): "range {start}–{end}" | "Fit the map to this range" | "Clear range selection"
- TimeSeriesChart (point): "point #{index}" | "Zoom the chart to this point" | "Clear point selection"
- TimeSeriesChart (range): "range {start}–{end}" | "Zoom the chart to this range" | "Clear range selection"
- TimeSeriesChart (set): "set of {n}" | (no jump) | "Clear multi-select"
- DataTable (point): "selected #{index}" | "Scroll to this row" | "Clear point selection"
- DataTable (range): "range {start}–{end}" | "Scroll to start of range" | "Clear range selection"
- DataTable (set): "set of {n}" | "Scroll to first selected" | "Clear multi-select"
- Trajectory3dPanel (point): "selected #{index}" | "Centre scene on this point" | "Clear point selection"
- Trajectory3dPanel (range): "range {start}–{end}" | "Centre scene on this range" | "Clear range selection"
- StatsPanel (time range): "{isoStart} → {isoEnd}" | (no jump) | "Clear time range selection"

---

## Part 24: Desktop & Electron Features

### File Archive
- **`archiveFile(direction, name, data)`** — best-effort duplicate-save of every imported/exported file into local archive folder (outside Downloads); failures logged as warnings, never thrown
- **`revealFileArchive()`** — opens archive folder in OS file manager (throws if not in Electron)
- Exposed in ProjectPanel as "Open archive folder" button

### KML Library
- **`listKmlLibrary()`** — enumerate `.kml`/`.kmz` files, sorted newest-first
- **`saveKmlLibraryFile(file)`** — persist imported KML/KMZ
- **`readKmlLibraryText(name)`** — read/parse KML or KMZ (extracts first `.kml` from KMZ zip)
- **`removeKmlLibraryFile(name)`** — delete from library
- **`reseedKmlLibrary()`** — re-copy bundled seed files and/or fetch known remote overlays (e.g. Special_Use_Airspace.kml from GitHub); returns `{ local, remote, failed }`
- **`revealKmlLibrary()`** — open library folder in OS file manager

### Electron Main Process
- **No native menu** — `Menu.setApplicationMenu(null)` explicitly called; all commands in React UI
- **Window** — 1480×920 default, min 1100×700, dark (`#0f172a`), held hidden until `ready-to-show` or 1s fallback
- **External links** — redirected to OS default browser via `shell.openExternal`
- **Unsaved-changes close guard** — native modal dialog; buttons: "Close without saving" (id 0, forces close) / "Cancel" (id 1, default, aborts)
- **DevTools** — auto-opened in detached mode when `isDev`
- **KML library IPC** — handlers: `list`, `save`, `readText`, `remove`, `reseed`, `reveal`
- **File archive IPC** — handlers: `archiveFile`, `revealArchive`
- **Window-state IPC** — `setUnsavedChanges` (one-way send)
- **Diagnostics IPC** — `saveDiagnostics` (native save dialog, returns path or null)
- **Startup KML fetch** — background, non-blocking, caches overlays before Map tab opened

### Electron Preload
- `window.jointDomainCompiler` (contextBridge, sandboxed):
  - `platform`, `isDesktop: true`
  - `kmlLibrary.{list, save, readText, remove, reseed, reveal}`
  - `diagnostics.save(text)`
  - `fileArchive.{save, reveal}`
  - `setUnsavedChanges(dirty)`

---

## Part 25: Cross-Cutting Behaviors & Rules

1. **Repair gate precedence** — with "preview repairs" on + visualizable diff → RepairPreviewDialog (no destructive ConfirmDialog for that run); off (or no visualizable diff) → destructive ConfirmDialog used
2. **Only one modal at a time** — `ConfirmProvider.confirm()` second request immediately resolves `false` rather than queueing
3. **`window.confirm` survives** — ProjectPanel's "Open project" flow uses native browser confirm, not app's ConfirmDialog
4. **Global Escape intercept** — RepairPreviewDialog & ConfirmDialog `stopPropagation()` Escape to trigger their own Revert/Cancel instead of app-wide selection clear
5. **Session-only vs persisted** — "preview repairs" & log-dock state = session-only; "Remember settings" in ReportExportDialog = opt-in exception, always defaults unchecked
6. **Notional-point export gate** — NotionalSmoothingPanel only ever creates new dataset (never mutates source); any dataset with notional points blocked from export until explicitly acknowledged per-dataset-session
7. **Downsampling budgets** — chart/map/3D point budgets from Settings cap display (not export/stats/analysis); chart/map show actual rendered count when downsampled; user notified in usage hints

---

**END OF FEATURE INVENTORY**

Keep this in step with the app: a new control, or a change to what one does, belongs here as well
as in `CHANGELOG.md`. `public/user-guide.html` is written from this document, so a gap here
becomes a gap in the user guide.
