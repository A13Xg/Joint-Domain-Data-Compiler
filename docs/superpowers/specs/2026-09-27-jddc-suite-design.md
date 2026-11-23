# JDDC Suite Architecture & Implementation Plan

**Date:** 2026-09-27  
**Status:** Design Specification (Planning Phase)  
**Scope:** Multi-app suite with shared core, format design, IPC coordination, and implementation roadmap

---

## Executive Summary

JDDC is evolving from a single-screen workbench into a **modular suite of specialized applications**, all compiled from one codebase and sharing a precision-critical core data layer. The suite enables specialized workflows: analysis/transformation (Workbench), tactical playback (Playback), and numerical analysis (Graph Analysis), while maintaining data integrity and allowing optional real-time coordination via IPC.

---

## 1. Architecture Overview

### 1.1 Suite Components

```
┌─────────────────────────────────────────────────────────────┐
│                    JDDC Suite (v0.8+)                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐ │
│  │ JDDC Workbench   │  │ JDDC Playback    │  │JDDC Graph  │ │
│  │ (src/workbench/) │  │ (src/playback/)  │  │(src/graph/ │ │
│  │                  │  │                  │  │)          │ │
│  │ • Import 8 fmt   │  │ • Load & play    │  │ • Analytics│ │
│  │ • Transform      │  │ • Multi-track    │  │ • Speed    │ │
│  │ • Compare        │  │ • Metrics        │  │ • Altitude │ │
│  │ • Export         │  │ • Overlays (v2+) │  │ • Rate     │ │
│  └────────┬─────────┘  └────────┬─────────┘  └─────┬──────┘ │
│           │                      │                  │         │
│           └──────────────────────┼──────────────────┘         │
│                                  │ IPC Layer                 │
│                                  │ (src/ipc/)                │
│                                  ▼                           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │           Shared Core (src/core/)                       │ │
│  │                                                          │ │
│  │  • Dataset, TrackPoint model                           │ │
│  │  • Parsers (GPX, CSV, KML, NMEA, GPB, EAG, GeoJSON)   │ │
│  │  • Transforms & Operations                             │ │
│  │  • Quality detection                                   │ │
│  │  • Analytics (speed, climb-rate, closure-rate, etc.)   │ │
│  │  • Recipes & versioning                                │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │         Persistence & Formats (src/persistence/)       │ │
│  │                                                          │ │
│  │  • .jddc-project (full dataset + history + recipes)   │ │
│  │  • .jddc-playback (entities + points, no history)     │ │
│  │  • .jddc-graph (analytics export, curated metrics)     │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Core Principles

1. **No data duplication** — parsers, Dataset model, transforms, analytics live once in `src/core/`
2. **Precision over speed** — correctness invariants apply to all apps equally
3. **Independent operation** — each app can launch and function without others
4. **Optional coordination** — when multiple apps are running, IPC enables "send to playback" workflows
5. **Modular extensibility** — new apps can be added (e.g., reporting tool, data fusion server) without touching existing apps
6. **Format resilience** — formats are schema-versioned; old files remain compatible

### 1.3 Critical Decisions (Tier 1)

**Process Topology:** Single Electron main process with multiple BrowserWindows. Desktop shortcuts launch the same executable with `--app=workbench|playback|graph`. Later launches via `requestSingleInstanceLock` route to the running process.

**Data Interchange:** Lossless archive format (gzip-compressed profile of existing `.jddc-project`), sent via IPC as `Uint8Array` (not JSON strings). Eliminates V8 string-length limits.

**Entity Identity:** Use Dataset.id (existing uuid-based). Callsign is an editable label. Prevents hash collisions and aligns with data integrity invariants.

**Analytics Strategy:** Per-track channels (speed, heading, etc.) reused from existing registry. Pairwise metrics (range, bearing, closure-rate) computed on-demand in Playback/Graph, never stored. Roll rate shown only when source provides roll channel.

---

## 2. App Specifications

### 2.1 JDDC Workbench (`src/workbench/`)

**Purpose:** The analysis and transformation hub. Users import data, explore, transform, compare, and export in any format or specialized format.

**Key Features:**
- Import 8 formats → Dataset normalization
- 13 tabs: Overview, Import, Map, Charts, Table, 3D, Compare, Fusion, Transform, Sources, Project, Export, History
- Cross-tab state (selection, workspace, history)
- Persists full project state to `.jddc-project` (with history/recipes)
- **New:** Export to `.jddc-playback` or `.jddc-graph` formats
- **New:** "Launch Playback" button to send current dataset to Playback app via IPC

**Window:** Main Electron BrowserWindow  
**Entry point:** `electron/main-workbench.cjs` (or single shared main with window type)  
**State:** Full dataset, history, recipes, workspace state (in `src/state/`)

**Interactions:**
- On export → `.jddc-playback`: prompt for entity metadata (callsign, aircraft type, color); serialize Dataset as playback format
- On "Launch Playback" button → IPC to playback app (or launch if not running) with Dataset payload
- On "Launch Graph Analysis" button → IPC to graph app (or launch if not running) with Dataset payload

---

### 2.2 JDDC Playback (`src/playback/`)

**Purpose:** Tactical review and animation. Users load a project or receive a dataset from Workbench, then replay the scenario with metrics (range, bearing, closure rate) and visual indicators.

**Key Features:**
- Load `.jddc-playback` or `.jddc-project` files independently
- Receive Dataset from Workbench via IPC
- Time-based playback: play/pause/seek/speed control
- Multi-track rendering (2D overhead view, synchronized animation)
- Real-time metrics: range, bearing, closure-rate per track pair
- Timeline scrubber with "now" indicator
- Entity list with visibility toggle + color override
- **v2+:** overlays (terrain, imagery), drawing tools, contact marking, tactical symbols
- **v2+:** save annotations (marks, drawings) to a separate format

**Window:** Dedicated Electron BrowserWindow (independent of Workbench)  
**Entry point:** `electron/main-playback.cjs`  
**State:** Playback state (current time, speed, selection) lives in this window only

**Data Flow:**
- Load file: parse `.jddc-playback` or `.jddc-project` → load entities into local state → initialize playback
- Receive IPC: unmarshall Dataset payload → create temporary entities → initialize playback
- Render loop: requestAnimationFrame → update "now" time → update entity positions based on interpolated points → render

**Format support:**
- Read `.jddc-playback` natively
- Read `.jddc-project` (extracts datasets, ignores history/recipes)
- Receive Dataset object via IPC from Workbench

---

### 2.3 JDDC Graph Analysis (`src/graph/`)

**Purpose:** Numerical and statistical deep-dive. Users explore kinematic and dynamic metrics without animation or spatial visualization.

**Key Features:**
- Load `.jddc-playback` or `.jddc-project` files independently
- Receive Dataset from Workbench via IPC
- Pre-built charts: speed, altitude, climb-rate, closure-rate, roll-rate (over time and per entity)
- Statistical summaries: mean, std-dev, min, max, percentiles
- Correlation analysis (e.g., closure-rate vs. altitude)
- Export chart data as CSV
- **v2+:** anomaly detection, trending, multi-entity overlays

**Window:** Dedicated Electron BrowserWindow (independent of Workbench)  
**Entry point:** `electron/main-graph.cjs`  
**State:** Chart selections, filters, date ranges

**Data Flow:**
- Load file or receive IPC → instantiate Dataset → compute analytics channels (already in Dataset.ext) → render charts
- No playback/animation; all data visible at once

---

## 3. Shared Core Layer (`src/core/`)

### 3.1 What's Already There

- `Dataset`, `TrackPoint` model (canonical units, provenance tracking)
- Parsers (all 8 formats)
- Transforms (resample, dedupe, smooth, etc.)
- Operations & Recipe model
- Quality detection
- Fusion layer
- Electron IPC preload (KML library only; will be extended)

### 3.2 What's New

- **Playback format serializers:** convert Dataset ↔ `.jddc-playback` (gzip archive profile)
- **Pairwise metric derivation:** range, bearing, closure-rate computed on-demand in Playback/Graph from `deriveInterpolatedRelativePosition` (existing)
- **Analytics trigger clarification:** per-track channels (`ground_speed_mps`, `heading_deg`, `vertical_speed_mps`, `turn_rate_dps`) are computed at Dataset import via the existing analytics registry. Consumers never re-derive; stale channels are flagged in metadata.
- **Callsign metadata storage:** callsign, aircraft type, color stored in manifest dataset entries (editable labels, not derived)

### 3.3 Invariants

All invariants in ARCHITECTURE.md §10 apply:
1. Never fabricate data
2. Preserve provenance through transforms
3. Transforms are pure
4. Coordinate math is antimeridian-safe
5. Use monotone cubic interpolation (for resampling within Dataset)
6. Validate at boundaries
7. Reports have no executable markup

**New invariants for suite:**
8. **Per-track channels stored, pairwise metrics computed:** Analytics channels like `ground_speed_mps`, `heading_deg`, `vertical_speed_mps` are stored in `Dataset.ext` (per-point, per-track). Pairwise metrics (range, bearing, closure-rate) are computed on-demand in Playback/Graph and never stored in Dataset. This prevents fabrication of values that require two-track alignment.
9. **Format resilience:** all formats must be schema-versioned and support migration. Old files remain readable.

---

## 4. Format Specifications

### 4.1 `.jddc-playback` Format

**Extension:** `.jddc-playback`  
**Content-Type:** `application/vnd.jddc.playback+ndjson`  
**Schema Version:** 1  
**Encoding:** NDJSON (Newline-Delimited JSON), human-readable, UTF-8

**Format:** One JSON object per line. Opens directly in text editors. Streamable (process entity-by-entity without loading entire file).

**Schema (line-by-line):**

```json
{
  "format": "jddc-playback",
  "schemaVersion": 1,
  "manifest": {
    "schema": "jddc-project",
    "schemaVersion": 2,
    "projectId": "playback_...",
    "name": "Scenario Name",
    "createdAt": 1727404800000,
    "updatedAt": 1727404800000,
    "applicationVersion": "0.8.0",
    "datasets": [
      {
        "id": "ds_uuid-here",
        "name": "Aircraft Callsign",
        "sourceFormat": "jddc-playback",
        "sourceHash": "sha256hex",
        "sourceFileName": "Scenario_Aircraft.jddc-playback",
        "embeddedDataPath": "datasets/ds_uuid.json",
        "recipeIds": [],
        "visible": true,
        "callsign": "CALLSIGN1",
        "aircraftType": "F-16C",
        "color": "#FF0000"
      }
    ],
    "recipes": [],
    "bookmarks": [],
    "fusionArtifacts": [],
    "view": {
      "activeDatasetId": "ds_uuid-here",
      "selection": {},
      "chartLayoutIds": []
    }
  },
  "datasets": [
    {
      "id": "ds_uuid-here",
      "name": "Aircraft Callsign",
      "sourceFormat": "jddc-playback",
      "points": [
        {
          "lat": 40.7128,
          "lon": -74.0060,
          "ele": 5000,
          "time": 1727404800000,
          "ext": {
            "ground_speed_mps": 250,
            "heading_deg": 45,
            "vertical_speed_mps": 10
          },
          "provenance": {
            "sourceRecord": 1,
            "sourceSegment": "CALLSIGN1",
            "sourceFeatureIndex": 0,
            "qualityFlags": []
          }
        }
      ],
      "channels": ["ground_speed_mps", "heading_deg", "vertical_speed_mps"],
      "warnings": [],
      "createdAt": 1727404800000,
      "metadata": {
        "coordinateSystem": "WGS84",
        "altitudeReference": "HAE",
        "timeReference": "UTC",
        "source": { "filename": "Scenario_Aircraft.jddc-playback", "checksum": "sha256hex" }
      }
    }
  ],
  "histories": {}
}
```

**Entity Metadata (in manifest):**
- `callsign`, `aircraftType`, `color` stored in dataset entry (not derived from ID)
- Entity ID = `Dataset.id` (existing UUID-based, no derivation from callsign)

**Size & Performance:**
- NDJSON (uncompressed): 10M points ≈ 2-3 GB text (each line ~200-300 bytes per point)
- Parsing on modern hardware: stream-process line-by-line, ~1-3 seconds per entity (no full load needed)
- RAM usage: 50-100 MB at any time (streaming doesn't load entire file)
- Size ceiling: file system limits (no V8 string limit; streaming avoids it)
- Optional: can gzip for archival (80-90% compression), but files open directly without decompression

**Why NDJSON (not flat JSON or gzip)?**
- **Human-readable natively** — open `.jddc-playback` in Notepad++ directly (no decompression step needed)
- **Interoperable** — any tool (Python, Go, JavaScript, curl) can parse line-by-line; no language-specific codec
- **Streaming** — process entity-by-entity without holding entire file in memory
- **User-friendly** — meets requirement "usable within threaded text reader like Notepad++"
- **Future-proof** — can add gzip compression wrapper if bandwidth becomes issue (v2+)

**Tradeoff:**
- NDJSON is larger than gzip (2-3x), but still well under disk/network budgets for typical exercises (5-20 aircraft)
- Text is slightly slower to parse than binary, but streaming mitigates this

**Migration:**
- Schema version 1 → 2: add new optional fields in manifest; old readers skip unknown keys
- Breaking changes increment to version 2 with migration path documented

---

### 4.2 `.jddc-graph` Format (Optional Separate Format)

**Consideration:** Playback format already contains all data needed for graphs. Graph app could:
- Option A: Reuse `.jddc-playback` (simpler, no new format)
- Option B: Export a `.jddc-graph` format with pre-computed analytics (trade-off: larger file, faster load)

**Recommendation:** Option A for v1 (use playback format). If graph app becomes a distribution center (e.g., "export this analysis result to colleagues"), add `.jddc-graph` format in v2.

---

## 5. IPC Coordination Layer (`src/ipc/`)

### 5.1 Purpose

Enable optional real-time communication between Workbench and specialized apps (Playback, Graph) running in the same Electron process. When a user activates "Launch Playback" or similar, the main process opens or focuses the target window and delivers the payload.

### 5.2 Process Topology

**Single Electron main process, multiple BrowserWindows:**
- Desktop shortcuts launch the same executable with `--app=workbench|playback|graph` argument
- `requestSingleInstanceLock` ensures only one process runs
- `second-instance` event routes later launches to the running main process
- Main process calls `openWindow(appType)` or focuses existing window

**Consequences:**
- No spawned subprocesses
- IPC is main ↔ renderer, the existing pattern
- No network IPC needed; everything shares one process

### 5.3 Messages

**Main → Renderer (Playback/Graph launch):**
```typescript
interface SuitePayloadMessage {
  type: 'suite:load';
  target: 'playback' | 'graph';
  payload: Uint8Array;  // gzip-compressed archive
  format: 'jddc-playback';
}
```

**Renderer → Main (ready handshake):**
```typescript
interface RendererReadyMessage {
  type: 'suite:ready';
  app: 'playback' | 'graph';
}
```

Main queues payloads until the target window reports ready; then delivers. Timeout (e.g., 30s) raises a visible error if receiver doesn't connect.

### 5.4 Serialization

**Payload:** Dataset serialized via `encodePlaybackNDJSON()` → `string` (NDJSON, UTF-8)

```typescript
interface IpcPayload {
  type: 'suite:load';
  target: 'playback' | 'graph';
  payload: string;  // NDJSON, one JSON object per line
  format: 'jddc-playback';
}

// Receiver:
const lines = message.payload.split('\n').filter(line => line.trim());
for (const line of lines) {
  const obj = JSON.parse(line);
  if (obj.type === 'header') { /* validate version */ }
  else if (obj.type === 'entity') { /* create entity */ }
  else if (obj.type === 'point') { /* add point to entity */ }
}
```

**Why NDJSON over binary:**
- Human-readable and interoperable (receiver doesn't need special decoders)
- Still fits within typical IPC message size limits (browsers allow 100MB+)
- Streaming-friendly (can process line-by-line without loading entire message)

---

## 6. Directory Structure & Build Configuration

### 6.1 Source Layout

```
src/
  workbench/
    App.tsx                      # Main workbench component (existing)
    index.tsx                    # Workbench entry point
    electron-preload.cjs         # Preload script for workbench window
    ipc-sender.ts                # IPC client: send messages to other apps
  
  playback/
    App.tsx                      # Main playback component (new)
    PlaybackControl.tsx          # Timeline, play/pause, speed
    EntityList.tsx               # Entity visibility + color picker
    PlaybackRenderer.tsx         # 2D animation render + metrics
    PlaybackState.ts             # Playback state machine (time, speed, selection)
    index.tsx                    # Playback entry point
    electron-preload.cjs         # Preload script for playback window
    ipc-receiver.ts              # IPC server: listen for dataset from workbench
  
  graph/
    App.tsx                      # Main graph component (new)
    ChartGrid.tsx                # Multi-chart layout
    index.tsx                    # Graph entry point
    electron-preload.cjs         # Preload script
    ipc-receiver.ts              # IPC server: listen for dataset from workbench
  
  core/
    model.ts                     # Dataset, TrackPoint (existing)
    parsers/                     # Format parsers (existing)
    transforms.ts                # Pure transforms (existing)
    operations/                  # Operation definitions (existing)
    analytics/
      index.ts                   # Speed, heading, climb-rate, closure-rate, roll-rate derivations (new/extended)
    playback-format.ts           # NEW: Dataset ↔ .jddc-playback serialization
    entity-id.ts                 # NEW: Callsign → numeric ID, verification
  
  state/
    pointSelection.ts            # (existing, workbench-only)
    workspaceDisplay.ts          # (existing, workbench-only)
    workspace.ts                 # (existing, workbench-only)
  
  ui/
    (all existing workbench components)
  
  persistence/
    project/                     # .jddc-project (existing)
      archive.ts
      manifest.ts
      migrations.ts
    playback/
      index.ts                   # NEW: Load/save .jddc-playback
      serializer.ts              # NEW: JSON ↔ in-memory format
  
  visualization/                 # Existing (used by workbench)
  
  ipc/
    messages.ts                  # NEW: Type definitions for all IPC messages
    sender.ts                    # NEW: Workbench IPC client
    receiver.ts                  # NEW: Generic listener setup for playback/graph
    constants.ts                 # NEW: Channel names, timeouts

electron/
  main.cjs                       # UPDATED: Multi-window coordination
  main-workbench.cjs             # Workbench-specific main (or conditional in main.cjs)
  main-playback.cjs              # Playback-specific main (or conditional)
  main-graph.cjs                 # Graph-specific main (or conditional)
  preload-workbench.cjs          # (or shared preload with context)
  preload-playback.cjs           # (or shared preload)
  preload-graph.cjs              # (or shared preload)

test/
  ipc.spec.ts                    # NEW: IPC message roundtrip tests
  playback-format.spec.ts        # NEW: .jddc-playback serialization tests
  entity-id.spec.ts              # NEW: ID derivation and verification
  playback-state.spec.ts         # NEW: Playback state machine tests
```

### 6.2 Build Configuration

**Vite:**
- Single build with multi-page setup: `rollupOptions.input` includes three HTML entry points
- Or: one HTML entry, detect app type at runtime from `window.location.hash` or data attribute
- Output: one optimized bundle (or three lazy-loaded chunks per app)

**Electron:**
- Single `electron/main.cjs` (existing, no separate per-app mains)
- Supports `--app=workbench|playback|graph` command-line argument
- `requestSingleInstanceLock` ensures single process
- `second-instance` event routes subsequent launches to running process

**Packaging (Electron Builder):**
- Single installer (NSIS on Windows, DMG on macOS, AppImage on Linux)
- Three desktop shortcuts/menu entries (Windows Start Menu, macOS Applications, Linux desktop)
- Each shortcut passes `--app=` argument to the single executable
- Portable version: no shortcuts (user launches manually with `--app=` or edits .ini)

**npm scripts:**
```bash
npm run dev                       # Dev server (workbench tab, current)
npm run dev:playback              # Dev playback tab (or `npm run dev -- --app=playback`)
npm run dev:graph                 # Dev graph tab (or `npm run dev -- --app=graph`)
npm run build                     # Build all three apps (one bundle, multi-page)
npm run check:all                 # Existing quality gate (updated to include all apps)
```

---

## 7. Implementation Roadmap & Phases

### Phase 1: Shared Core & Format (2-3 weeks)

**Goal:** Establish the playback format (lossless gzip archive profile) and wire export from Workbench.

**Tasks:**
1. Verify existing `encodeProjectArchive` / `decodeProjectArchive` handles playback profile (should be automatic)
2. Add optional metadata fields to manifest dataset entries (`callsign`, `aircraftType`, `color`)
3. Add `src/persistence/playback/index.ts` (load/save `.jddc-playback` wrappers around archive codec)
4. Verify analytics registry computes `ground_speed_mps`, `heading_deg`, `vertical_speed_mps`, `turn_rate_dps` at import
5. Add "Export to Playback" button in Workbench's ExportPanel; prompt for entity metadata
6. Tests: serialization round-trip (Dataset → archive → Dataset), metadata preservation, gzip integrity
7. **Deliverable:** Workbench can export any dataset to `.jddc-playback` (gzip) with metadata

**Risks:**
- Gzip compression size assumptions (expect 80-90% reduction; measure on real data)
- Metadata fields in manifest may need schema migration path

---

### Phase 2: Playback App Core (6-8 weeks)

**Goal:** Standalone playback application that loads and animates `.jddc-playback` files.

**Tasks:**
1. Create `src/playback/` directory structure
2. Implement `PlaybackState.ts` (state machine: time, speed, selection, visibility)
3. Implement `PlaybackRenderer.tsx` (2D overhead view, entity paths, current positions)
4. Implement `PlaybackControl.tsx` (play/pause, seek, speed slider)
5. Implement `EntityList.tsx` (visibility toggle, color picker)
6. Implement metrics display (range, bearing, closure-rate between selected pair)
7. Set up Electron window in `electron/main-playback.cjs`
8. Tests: state transitions, interpolation accuracy, metrics calculation
9. **Deliverable:** Playback app launches and animates `.jddc-playback` files independently

**Risks:**
- Interpolation accuracy (monotone cubic must not overshoot)
- 60fps rendering with 10M+ points (may need downsampling strategy)
- Synchronization between playback time and UI updates

---

### Phase 3: Multi-Window IPC & Launch Coordination (1-1.5 weeks)

**Goal:** Workbench can launch Playback (and Graph) in the same process via window opening + IPC.

**Tasks:**
1. Update `electron/main.cjs` to support multi-window launch via `--app=` argument and `requestSingleInstanceLock`
2. Implement `openWindow(appType)` and focus logic in main process
3. Implement preload IPC messages: `suite:load` (main → renderer) and `suite:ready` (renderer → main)
4. Add "Launch Playback" button to Workbench's ExportPanel; call main process to open playback window
5. Implement IPC payload queue in main: buffer until receiver reports ready (30s timeout)
6. Implement receive flow in Playback/Graph renderers: listen for `suite:load`, decode archive, initialize view
7. Tests: payload delivery, timeout handling, window focus, multiple rapid launches
8. **Deliverable:** Workbench can launch Playback/Graph and send datasets via IPC; apps receive and initialize

**Risks:**
- Window ready timing (ensure preload is injected before sending payload)
- Payload size (test with 500MB+ gzip payloads)

---

### Phase 4: Graph Analysis App (4-6 weeks)

**Goal:** Standalone graph analysis application (parallel with Phase 3, can start early).

**Tasks:**
1. Create `src/graph/` directory structure
2. Identify key charts: speed vs. time, altitude vs. time, climb-rate vs. time, closure-rate vs. time, roll-rate vs. time
3. Implement `ChartGrid.tsx` (responsive layout, 2-3 charts per row)
4. Implement chart rendering (use existing Recharts setup from Workbench? or new library?)
5. Implement statistical summaries (mean, std-dev, min, max, percentiles per entity)
6. Implement correlation analysis (closure-rate vs. altitude, etc.)
7. Set up Electron window
8. Tests: chart data accuracy, statistics verification
9. **Deliverable:** Graph app launches and displays analytics for `.jddc-playback` files

**Risks:**
- Chart library choice (Recharts adds dependency, or use lightweight alternative?)
- Correlation analysis complexity

---

### Phase 5: Multi-Window Coordination & Polish (2-3 weeks)

**Goal:** Refine IPC, test all three apps running together, establish clear UX patterns.

**Tasks:**
1. Test Workbench + Playback + Graph running simultaneously
2. Implement sync messages (optional v1, recommended for v2): Playback → Workbench "user clicked here in playback"
3. Desktop shortcuts/launchers for each app
4. Documentation: user guide, architecture reference for future extensions
5. Performance testing: large exercises (100+ aircraft, 10M+ points)
6. **Deliverable:** Suite is stable, all three apps coordinate well, ready for v0.8 release

---

### Phase 6: Future Extensions (v2+, Backlog)

**Playback enhancements:**
- Terrain/imagery overlays
- Drawing tools (circles, lines, annotations)
- Contact marking (friendly, hostile, neutral, unknown)
- Tactical symbols (standard military icons)
- Time-window replay (e.g., "replay last 5 minutes")
- Save session annotations

**Graph enhancements:**
- Anomaly detection (spikes, jumps)
- Trending (linear regression overlay)
- Multi-entity correlation (closure-rate scatter plot: entity A vs. entity B)

**New apps:**
- Reporting utility (curate analysis into PDF/HTML reports)
- Data fusion server (register and fuse external datasets)
- Playback export (save playback as video or GIF)

---

## 8. Success Criteria

### v0.8 (Initial Release) — status as of the 2026-09-27 implementation pass

- [x] `.jddc-playback` format is stable, documented, human-readable — reuses the
      tested `.jddc-project` gzip-JSON codec (§11 item 1); an unchecked
      "gzip-compress" option in the export dialog saves plain JSON, openable
      in any text editor.
- [x] Workbench exports datasets to `.jddc-playback` — "Export to Playback"
      (per-dataset callsign/aircraft-type prompt) and "Launch Playback"/
      "Launch Graph Analysis" (quick-send, no prompt) in the Project panel.
- [x] Playback app loads and animates `.jddc-playback` files independently —
      verified both as a standalone file-open (browser `?app=playback` and
      packaged Electron) and via IPC launch.
- [x] Playback displays range, bearing, closure-rate metrics
- [x] IPC allows Workbench → Playback dataset send — verified against the real
      Electron binary (window open, ready handshake, payload delivery, and
      window reuse on a second launch), not just statically.
- [x] Graph app displays 5+ analytical charts — 3 per-entity (altitude, ground
      speed, vertical speed) + 3 pairwise (closure rate over time, slant range
      over time, closure-rate-vs-range correlation) = 6.
- [~] All three apps are launchable independently — true for Playback/Graph as
      standalone file-openers and via in-app IPC launch from a running
      Workbench. **Not done:** separate desktop shortcuts / `--app=` CLI
      launch routing for the packaged build — deferred per §11 item 10 (macOS
      cannot pass CLI args from a Dock launch; this needs its own design
      decision, not a straightforward addition). This is Phase 5 scope, not
      Phase 3's.
- [ ] Large exercises (100 aircraft, 10M points) load in <10 seconds — target
      revised in §11 item 3 to ~1.5-2M points (the archive codec's real
      ceiling). **Not benchmarked** at any scale in this pass — tested with
      real fixtures up to ~1,200 points across 2 entities, not a synthetic
      large exercise.
- [ ] Playback animation runs at 60fps without stutter on high-end hardware —
      **not benchmarked**. The renderer redraws the full canvas every frame
      with no downsampling strategy; large track counts/point counts have not
      been profiled.
- [x] Suite architecture is documented for future extensions — this
      document's §11, `.agents/ARCHITECTURE.md` §3 and its new "The suite"
      subsection and §10 invariants 8-9, and `FEATURE_INVENTORY.md`'s Part 20
      additions.

### Testing Baseline

- [x] Serialization round-trip: Dataset → `.jddc-playback` JSON → Dataset
      (numerically equivalent) — `test/playback-format.ts`, both gzip and
      uncompressed.
- [~] Interpolation accuracy: `src/core/analytics/pairwise.ts` uses linear
      (not monotone cubic) interpolation between bracketing samples for
      ephemeral, never-persisted position-at-time queries — the same choice
      the pre-existing `deriveInterpolatedRelativePosition` already makes
      elsewhere in this codebase for the same kind of query. Invariant #5
      (monotone cubic) governs *resampling*, i.e. producing new persisted
      `TrackPoint`s; it was never actually applicable to a display-only
      pairwise query, so this criterion as originally written didn't fit what
      got built. What's tested instead: no extrapolation past a track's first/
      last sample, no bridging a gap wider than the caller's limit, and
      antimeridian-safe longitude interpolation (`test/pairwise-metrics.ts`).
- [x] Entity ID resilience: **dropped, not built** — a callsign→ID
      "verification" module contradicted this doc's own decision to use
      `Dataset.id` (§11 item 6); there is nothing to collide.
- [~] IPC reliability: verified correct for normal use (real payload send,
      window reuse, dual-app launch, all against the real Electron binary) —
      not stress-tested under adversarial load (many rapid launches, huge
      payloads near `MAX_ARCHIVE_FILE_BYTES`).
- [ ] Large dataset performance: 100 aircraft × 100k points — **not tested**.

---

## 9. Appendix: Decisions & Remaining Questions

### Decided (Tier 1 Planning)

1. **Process topology:** Single Electron `main.cjs`, multiple BrowserWindows launched via `--app=` argument
2. **Data format:** Lossless gzip archive profile (reuses existing codec)
3. **Entity identity:** Dataset.id (UUID-based), not derived from callsign
4. **Analytics strategy:** Per-track channels stored, pairwise metrics computed on-demand
5. **Desktop shortcuts:** Three separate entries (Workbench, Playback, Graph)
6. **Chart library:** Reuse existing `src/visualization/charts` (not Recharts external dependency)

### Open (Tier 2-3 or Deferred)

1. **Playback v2+ annotations:** Will marks/drawings be stored in separate `.jddc-playback-annotations` sidecar, or inline in manifest?
   - Decision deferred to v2 planning

2. **Playback terrain overlays:** Will terrain be queried from external service, bundled with app, or loaded from user files?
   - Decision deferred to v2 planning

3. **Multi-dataset project loading:** When Playback/Graph loads `.jddc-project` with multiple datasets, prompt user to select or merge all?
   - Recommendation: Prompt for v0.8; merge option for v1.0

4. **Encoding decided:** NDJSON (human-readable, streaming, interoperable). Optional gzip wrapper for v2+ if bandwidth matters.
   - **Decided.** Meets user requirements: readable in Notepad++, interoperable, user-friendly.

---

## 10. References

- `.agents/ARCHITECTURE.md` — Data model, invariants, layers
- `ONBOARDING.md` — Developer setup and workflow (will be updated)
- `src/core/model.ts` — Dataset, TrackPoint definitions
- `src/persistence/project/archive.ts` — `.jddc-project` format (reference for v1)
- Electron IPC docs: https://www.electronjs.org/docs/latest/api/ipc-main
- JSON streaming alternatives (for future): NDJSON, Protocol Buffers, MessagePack

---

**Document Status:** ✅ Ready for verification and review  
**Next Step:** Launch concurrent review agents (architectural consistency + implementation feasibility)

---

## 11. Pre-Implementation Corrections (2026-09-27 review)

An architectural-consistency and feasibility review against the real codebase found two false
claims and several load-bearing gaps in the sections above. These corrections are authoritative —
where they conflict with §1–§9, follow this section.

1. **Format: no NDJSON.** §4.1 and §5.4's NDJSON design is dropped for v1. `.jddc-playback` reuses
   the existing `encodeProjectArchive`/`decodeProjectArchive` gzip-JSON codec with a *playback
   profile* manifest (see below) — it already exists, is tested, and is what `.jddc-project` uses.
   "Readable in Notepad++" is met by also offering an **uncompressed** export option:
   `decodeProjectArchive` already sniffs the gzip magic bytes, so an uncompressed `.jddc-playback`
   is a valid input, not a format fork. True line-delimited NDJSON streaming is deferred to v2, and
   only if real exercises exceed the ceiling below.
2. **IPC payload: `Uint8Array` (gzip bytes), not a string.** Renderer → main (`ipcRenderer.invoke`,
   checked channel name) → target renderer. The receiver runs the *same* decode-and-validate path
   as a file load — one validation boundary, one test surface.
3. **Realistic size ceiling: ~1.5–2M points, not 10M.** The archive codec caps at 512 MB
   decompressed / `MAX_TOTAL_POINTS` 10M / `MAX_DATASETS` 100, and NDJSON wouldn't have helped — at
   ~300 bytes/point, 10M points is ~3 GB, past V8's ~512M-character string limit either way. §8's
   "100 aircraft, 10M points in <10s" target is revised to ~1.5–2M points.
4. **No `src/workbench/` move.** Keep `src/App.tsx`, `src/state/`, etc. exactly where they are.
   Nothing in Phases 1–5's task lists needs the move (only `src/main.tsx` imports `App.tsx`), it
   would mean rewriting ~46 relative imports for no benefit, and `persistence/project/manifest.ts`
   already imports `state/workspace`/`state/workspaceDisplay`, so Playback would end up depending
   on a directory named for a different app. `main.tsx` picks the app to mount via dynamic import
   based on `?app=` / `window.location.hash`. Electron preloads stay in `electron/` (sandboxed
   CommonJS) — they were never going to live under `src/` despite §6.1's listing.
5. **Kinematics channels are NOT computed at import.** §3.2's claim that the analytics registry
   computes `ground_speed_mps` etc. at import is false — `standard-kinematics` is a user-triggered
   Transform (`TransformPanel.tsx`). Playback and Graph must derive missing per-track channels
   on load (respecting the existing stale-channel badge/flag), or display them as absent. This
   replaces Phase 1 task 4 as originally written.
6. **Entity identity: delete `entity-id.ts` from the plan.** A "callsign → numeric ID, verification"
   module contradicts §1.3/§9's own decision to use `Dataset.id`. Don't build it.
7. **Playback-profile export must not destroy data:**
   - Preserve the original `sourceFormat` and `metadata.source` (§4.1's example incorrectly
     rewrites both to `jddc-playback`) — that's provenance, never fabricated/overwritten.
   - Prune `recipes`, `fusionArtifacts`, and `bookmarks` to only entries the exported dataset
     subset still references (validation rejects dangling `recipeIds`/dataset references).
   - `callsign` and `aircraftType` are new optional `ProjectDatasetEntry` fields requiring
     explicit validation in `manifest.ts` (`color` already exists on the type but was never
     validated or populated by `buildProjectManifest` — fix both as part of this work).
8. **Pairwise metrics: one shared helper.** Phase 2 (Playback) and Phase 4 (Graph) both need
   range/bearing/closure-rate. Build a single `src/core/analytics/pairwise.ts` wrapper over
   `deriveInterpolatedRelativePosition` before Phase 4 starts, so the two apps can't compute it
   differently. **Roll rate is dropped from the v1 chart list** — no parser populates a roll
   channel anywhere in the codebase today.
9. **Phase 2 doesn't need Electron yet.** `electron/main-playback.cjs` (§6.2 already says there's
   one `main.cjs`, not per-app mains) is Phase 3 work. Build and test Phase 2 through a browser dev
   route (`?app=playback`) first; wire the real `--app=` Electron routing in Phase 3.
10. **`electron/main.cjs` has single-window assumptions that must become per-window before Phase
    3**: `hasUnsavedChanges` (one process-wide flag), `revealCurrentWindow` (one slot), and the
    splash-to-first-window handoff all currently assume exactly one app window exists.
    `requestSingleInstanceLock` must be acquired *before* `openSplash()` — otherwise a second
    launch flashes a splash before quitting — and needs a bypass or separate `userData` dir for
    parallel Electron test launches (`test/electron-launch.ts`, Playwright). `isAllowedAppUrl` needs
    to accept the `?app=` variant. `test/electron-integration.ts` string-matches `main.cjs` content
    and will need updates. macOS can't pass `--app=` from a Dock/Applications launch, so "three
    desktop shortcuts" there means three bundles or an in-app switcher, not three arguments —
    same gap for the Windows portable build.
11. **Shared preload:** the existing `electron/preload.cjs` exposes the whole workbench API surface.
    IPC channel name constants can't be imported across the sandboxed preload boundary from
    `src/ipc/` — mirror and assert them, the same pattern `IPC_CHANNELS` already uses.

The existing "user guide" secondary window in `electron/main.cjs` (`openUserGuideWindow`,
singleton reuse, `labelWindow`, `ready-to-show` gating) is a working template for the
Playback/Graph window-open pattern in Phase 3 — reuse its shape rather than designing a new one.
