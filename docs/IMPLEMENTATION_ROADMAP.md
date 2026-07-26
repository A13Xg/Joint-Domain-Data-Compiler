# Joint Domain Data Compiler — Incremental Implementation Roadmap

**Plan ID:** `JDDC-ROADMAP-2026-01`  
**Status:** Active development authority  
**Repository:** `A13Xg/Joint-Domain-Data-Compiler`  
**Primary objective:** Evolve the current local-first TSPI conversion workbench into a robust flight-data analysis, correction, visualization, comparison, and reproducibility platform without destabilizing the existing converter.

> **Repository policy update — 2026-07-26:** Branch protection and GitHub rulesets are optional administration choices and are not implementation, merge, acceptance, or release requirements. This decision supersedes any earlier branch-protection requirement in this roadmap.

---

## 1. Product direction

Joint Domain Data Compiler should remain:

- local-first and offline-capable;
- format-agnostic through a normalized dataset model;
- deterministic and auditable;
- useful for both quick conversion and deeper engineering analysis;
- performant on large TSPI datasets;
- releasable as a browser application and signed desktop application;
- extensible without coupling parsers, transforms, charts, maps, and exporters.

The target product is not merely a converter. It is a modular flight-data workbench supporting:

1. ingestion and normalization;
2. data-quality assessment;
3. correction and signal processing;
4. synchronized 2D, tabular, chart, and 3D inspection;
5. multi-dataset comparison;
6. reproducible transformation recipes;
7. high-confidence export and reporting.

---

## 2. Delivery rules

Every roadmap item must follow these rules.

### 2.1 Incremental pull requests

Each pull request must deliver one coherent vertical slice. Avoid broad rewrites that simultaneously replace storage, charts, state, and rendering.

Recommended maximum scope:

- one architectural primitive plus its first user-visible use;
- one transform family;
- one visualization mode;
- one import/export format;
- one performance boundary.

### 2.2 Implementation and audit phases

Every increment has two required stages:

1. **Implementation**
   - code;
   - tests;
   - fixtures;
   - documentation;
   - migration handling;
   - telemetry/logging where applicable.

2. **Audit**
   - inspect the complete diff;
   - run lint, typecheck, tests, and builds;
   - verify no mock or placeholder behavior;
   - test malformed and edge-case data;
   - record performance observations;
   - produce a concise audit report in the PR.

### 2.3 No hidden data changes

Any operation that changes data must:

- produce a human-readable summary;
- identify affected point count and channels;
- preserve operation parameters;
- support undo;
- avoid silently fabricating values;
- add quality flags or warnings for ambiguous repairs;
- preserve source provenance when possible.

### 2.4 Correctness before feature count

A new format, transform, or graph is incomplete without:

- representative fixtures;
- malformed-input tests;
- boundary-condition tests;
- unit semantics;
- explicit null and invalid-value behavior;
- round-trip tests where applicable.

### 2.5 Performance budgets

Initial budgets should be treated as engineering targets, not marketing guarantees.

- 100,000-point dataset: interactive chart/map navigation.
- 500,000-point dataset: import and basic analysis without renderer lockup.
- 1,000,000-point dataset: supported through workers, progressive rendering, downsampling, or columnar storage.
- User-triggered operations longer than a brief interaction must expose progress and cancellation.
- Visualization must not render every point when the display resolution cannot represent them.

---

## 3. Target architecture

The codebase should gradually converge on these layers.

```text
src/
  core/
    model/             Dataset, channel, units, provenance, quality flags
    parsing/           Parser interfaces, detection, fixtures
    transforms/        Pure transformation and signal-processing operations
    analytics/         Derivations, segmentation, statistics, comparisons
    export/            Exporter interfaces and validation
    recipes/           Serializable operations and replay
  compute/
    workers/           Worker protocol and compute tasks
    columnar/          Optional typed-array storage and adapters
    cancellation/      Abort/progress primitives
  state/
    workspace/         Datasets, active dataset, visibility, references
    selection/         Cursor, selected point, ranges, regions, segments
    history/           Undo/redo and operation provenance
  visualization/
    charts/            Time-series and statistical chart adapters
    map2d/             Leaflet/deck.gl adapters
    scene3d/           Interactive local trajectory view
    playback/          Shared timeline and synchronization
  persistence/
    project/           Project archive/session format
    settings/          User preferences and presets
  ui/
    panels/
    dialogs/
    common/
```

This is a migration target. Existing files should be moved only when a feature requires it.

---

## 4. Phase 0 — Stabilize the current foundation

**Goal:** establish a clean, releasable baseline before expanding functionality.

### Scope

- Fix all lint failures in the active hardening PR.
- Confirm tests and production build pass.
- Run the Windows packaging workflow manually.
- Verify generation of:
  - NSIS installer;
  - portable executable;
  - Windows checksum manifest.
- Verify Linux and macOS artifacts remain present.
- Merge the hardening PR only after CI passes.
- Tag the baseline release and confirm all binaries are attached to GitHub Releases.
- Add this roadmap to the repository.

### Acceptance criteria

- `npm ci`, lint, tests, and build pass on CI.
- GPX XSD validation is mandatory on Linux.
- Manual Windows packaging creates both expected executables.
- Version-tag release publishes all expected platform artifacts.
- No known red CI checks remain.

### Recommended PR boundary

`PR-000: Stabilize correctness, CI, packaging, and roadmap`

---

## 5. Phase 1 — Shared analysis selection and synchronization

**Goal:** create the state backbone needed for linked charts, map, table, playback, and transforms.

### 5.1 Selection model

Introduce a UI-independent selection state:

```ts
interface WorkspaceSelection {
  datasetId: string | null
  pointIndex: number | null
  timeCursorMs: number | null
  indexRange: { start: number; end: number } | null
  timeRange: { startMs: number; endMs: number } | null
  segmentIds: string[]
}
```

### 5.2 Required behaviors

- Hovering a chart updates a shared cursor.
- Selecting a chart range highlights the corresponding map path.
- Clicking a map point selects the nearest record.
- Selecting a table row moves the chart cursor and map marker.
- A selected range can be used as transform scope.
- Statistics recalculate for either the full dataset or selection.
- Selection changes must not mutate source data.

### 5.3 UI additions

- Selection summary bar.
- Clear-selection action.
- Full dataset / selected range toggle.
- Selected point details.
- Selected range duration, distance, and point count.

### Tests

- time-to-index lookup;
- nearest-point lookup;
- empty and untimed datasets;
- non-monotonic timestamps;
- selection after sort, filter, undo, and redo;
- linked component integration tests.

### Acceptance criteria

A user can select a range in the chart and see the same range reflected in the map, table, statistics, transform target, and 3D view.

### PR segmentation

- `PR-101: Add shared workspace selection model`
- `PR-102: Link chart, map, and table selections`
- `PR-103: Add selection-scoped statistics and transforms`

---

## 6. Phase 2 — Derived analytics and flight segmentation

**Goal:** make common engineering channels first-class and repeatable.
