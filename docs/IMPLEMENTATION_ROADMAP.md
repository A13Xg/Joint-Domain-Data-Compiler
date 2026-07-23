# Joint Domain Data Compiler — Incremental Implementation Roadmap

**Plan ID:** `JDDC-ROADMAP-2026-01`  
**Status:** Proposed development authority  
**Repository:** `A13Xg/Joint-Domain-Data-Compiler`  
**Primary objective:** Evolve the current local-first TSPI conversion workbench into a robust flight-data analysis, correction, visualization, comparison, and reproducibility platform without destabilizing the existing converter.

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
    scene3d/           React Three Fiber local trajectory view
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
- Add branch protection requiring CI before merge.

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

A user can select a range in the chart and see the same range reflected in the map, table, statistics, and transform target.

### PR segmentation

- `PR-101: Add shared workspace selection model`
- `PR-102: Link chart, map, and table selections`
- `PR-103: Add selection-scoped statistics and transforms`

---

## 6. Phase 2 — Derived analytics and flight segmentation

**Goal:** make common engineering channels first-class and repeatable.

### 6.1 Derivation registry

Create a registry rather than hard-coding all calculations into one transform.

```ts
interface DerivedChannelDefinition {
  id: string
  outputChannels: ChannelDefinition[]
  requiredInputs: string[]
  derive(context: DerivationContext): DerivationResult
}
```

### 6.2 Initial derived channels

- cumulative distance;
- ground speed;
- vertical speed;
- horizontal acceleration;
- vertical acceleration;
- total acceleration;
- heading;
- turn rate;
- sample interval;
- sample frequency;
- climb angle;
- path angle;
- distance from start;
- bearing from start;
- quality score;
- gap and discontinuity flags.

### 6.3 Flight/event segmentation

Add deterministic event detectors:

- stationary;
- taxi/low-speed;
- takeoff transition;
- climb;
- level segment;
- descent;
- landing transition;
- data gap;
- timestamp reset;
- positional jump;
- high-acceleration event;
- rapid-turn event.

Detectors must expose thresholds and confidence rather than claiming universal classification accuracy.

### 6.4 Outputs

- derived channels;
- segment list;
- event markers;
- segment statistics;
- chart annotations;
- optional export of segment/event metadata.

### Acceptance criteria

Users can generate standard kinematic channels, inspect the formula and units, and view detected segments on charts and maps.

### PR segmentation

- `PR-201: Introduce derivation registry and channel dependencies`
- `PR-202: Add vertical speed, acceleration, turn rate, and sample metrics`
- `PR-203: Add configurable flight and data-quality segmentation`

---

## 7. Phase 3 — Time-series analysis workspace

**Goal:** replace the basic chart experience with a high-performance engineering signal workspace.

### 7.1 Chart engine

Recommended primary engine: **uPlot** behind an internal chart adapter.

Reasons:

- high performance for dense time series;
- zoom, pan, cursor, scales, and synchronized charts;
- small runtime compared with general dashboard libraries;
- suitable for engineering signal inspection.

Do not expose uPlot types throughout the application. Use an adapter so another renderer can be substituted later.

### 7.2 Core chart capabilities

- time or sample-index x-axis;
- distance x-axis;
- independent and shared y-scales;
- units and formatted axis labels;
- zoom and pan;
- range brushing;
- synchronized crosshair;
- multiple stacked plots;
- channel search;
- presets;
- raw and processed overlay;
- event markers;
- gap visualization;
- anomaly markers;
- min/max/mean and percentile bands;
- export to PNG/SVG/CSV;
- persistent chart layouts.

### 7.3 Initial presets

- altitude over time;
- speed over time;
- vertical speed over time;
- heading and turn rate;
- acceleration;
- sample interval and frequency;
- quality metrics;
- altitude versus distance;
- climb profile;
- raw versus smoothed comparison.

### 7.4 Statistical visualizations

Add a second adapter, preferably Apache ECharts, only for non-time-series views:

- histogram;
- scatter plot;
- box plot;
- correlation matrix;
- missing-data heatmap;
- channel summary distributions.

### Performance requirements

- display-resolution-aware downsampling;
- no full DOM/SVG path for hundreds of thousands of samples;
- cursor lookup using binary search when timestamps are ordered;
- worker-computed aggregates for large selections.

### Acceptance criteria

A 100,000-point dataset supports responsive zooming, panning, linked selection, and synchronized chart/map/table inspection.

### PR segmentation

- `PR-301: Add chart adapter and uPlot time-series foundation`
- `PR-302: Add linked zoom, brushing, cursor, and chart presets`
- `PR-303: Add statistical charts and distribution analysis`
- `PR-304: Add chart export and saved layouts`

---

## 8. Phase 4 — Data-massaging pipeline v2

**Goal:** provide explicit, testable, stackable correction and processing operations.

### 8.1 Operation contract

Each operation must serialize into a recipe:

```ts
interface OperationRecord<TParams = unknown> {
  id: string
  version: number
  params: TParams
  inputDatasetHash: string
  affectedRange?: SelectionRange
  createdAt: number
  summary: string
}
```

### 8.2 Time operations

- fixed-rate resampling;
- distance-based resampling;
- linear interpolation;
- nearest-neighbor interpolation;
- hold-last-value;
- monotone cubic interpolation;
- short-gap bridging;
- split on large gaps;
- timestamp de-jitter;
- duplicate timestamp resolution;
- constant clock offset;
- linear clock-drift correction;
- alignment to reference event or dataset;
- GPS/UTC/TAI/local-time conversion.

### 8.3 Signal filtering

- moving average;
- exponential moving average;
- median filter;
- Hampel filter;
- Savitzky-Golay filter;
- configurable Butterworth low-pass/high-pass;
- derivative;
- integral;
- normalization;
- clipping;
- scale and offset;
- rolling statistics;
- saturation and flatline detection.

Filters must document edge behavior, phase effects, and required sample assumptions.

### 8.4 Spatial operations

- ENU offset;
- ECEF and geodetic conversion;
- local tangent-plane projection;
- antimeridian-safe smoothing;
- geofence crop;
- polygon crop;
- stationary cluster consolidation;
- positional jump removal;
- short GPS-gap interpolation;
- track split and merge;
- spatial resampling;
- cross-track smoothing.

### 8.5 Altitude operations

- feet/meters conversion;
- MSL/HAE/AGL metadata handling;
- constant altitude correction;
- reference-point zeroing;
- barometric versus GPS channel selection;
- geoid-model correction when an approved local dataset is available;
- altitude-step detection;
- vertical profile smoothing;
- terrain-clearance derivation when terrain data is present.

### 8.6 Transform UX

- before/after preview;
- point-count and channel-impact summary;
- parameter validation;
- selected-range scope;
- apply/cancel;
- undo/redo;
- saved presets;
- recipe export;
- warnings for destructive operations.

### Acceptance criteria

A user can build, preview, apply, undo, save, and replay a deterministic sequence of transforms.

### PR segmentation

- `PR-401: Add serializable operation and recipe framework`
- `PR-402: Add resampling, interpolation, and time-gap operations`
- `PR-403: Add engineering signal filters`
- `PR-404: Add spatial and altitude correction operations`
- `PR-405: Add transform preview, presets, and recipe replay`

---

## 9. Phase 5 — Compute and large-data architecture

**Goal:** prevent advanced analysis and visualization from freezing the browser or Electron renderer.

### 9.1 Worker protocol

Create a generic worker request protocol:

```ts
interface ComputeRequest<T> {
  requestId: string
  task: string
  payload: T
}

interface ComputeProgress {
  requestId: string
  completed: number
  total?: number
  message?: string
}
```

Required support:

- progress;
- cancellation;
- typed errors;
- deterministic task versions;
- transferables;
- worker pooling only when justified.

### 9.2 Move heavy operations off the main thread

Prioritize:

- CSV/NMEA parsing;
- statistics;
- resampling;
- filtering;
- correlation;
- segmentation;
- multi-dataset comparison;
- visualization downsampling;
- project checksums.

### 9.3 Columnar storage investigation

Introduce a compatibility layer before replacing `TrackPoint[]`.

Candidate internal structure:

```ts
interface ColumnarDataset {
  lat: Float64Array
  lon: Float64Array
  ele?: Float64Array
  time?: Float64Array
  numericChannels: Map<string, TypedArray>
  stringChannels: Map<string, string[]>
}
```

Use adapters so parsers, transforms, and UI do not all change simultaneously.

### 9.4 Progressive rendering

- decimated preview during import;
- progressively refined chart;
- point budget per viewport;
- map simplification by zoom;
- virtualized table;
- cancellation when the user switches dataset.

### Acceptance criteria

Large computations expose progress and cancellation, and the renderer stays responsive during supported operations.

### PR segmentation

- `PR-501: Add shared compute worker protocol`
- `PR-502: Move analytics and transforms into workers`
- `PR-503: Add visualization downsampling and progressive rendering`
- `PR-504: Add optional columnar dataset adapter`

---

## 10. Phase 6 — Multi-dataset workspace and comparison

**Goal:** support reference-versus-test and multiple-platform analysis.

### 10.1 Workspace model

- load several datasets;
- control visibility;
- assign colors;
- designate reference dataset;
- independently offset time;
- independently show/hide channels;
- retain dataset-specific provenance.

### 10.2 Alignment methods

- absolute timestamp;
- manual offset;
- named event;
- nearest spatial point;
- maximum cross-correlation for selected numeric channels;
- shared start;
- reference marker.

Automatic alignment must show the calculated offset and confidence and require user acceptance.

### 10.3 Relative analytics

- relative north/east/down;
- slant range;
- horizontal range;
- bearing;
- altitude separation;
- closure rate;
- along-track error;
- cross-track error;
- nearest approach;
- closest point of approach time;
- residuals against reference;
- aggregate error statistics.

### 10.4 Comparison visualization

- synchronized multi-track map;
- overlaid or stacked charts;
- residual charts;
- separation timeline;
- closest-approach marker;
- reference-relative 3D vectors;
- comparison report export.

### Acceptance criteria

Two datasets can be aligned, compared, and exported with transparent alignment parameters and derived relative metrics.

### PR segmentation

- `PR-601: Add multi-dataset workspace state`
- `PR-602: Add manual and event-based alignment`
- `PR-603: Add relative-position and residual analytics`
- `PR-604: Add comparison visualizations and report`

---

## 11. Phase 7 — Local 3D trajectory viewer

**Goal:** add an analytically useful 3D flight-path view without immediately taking on global-globe complexity.

### 11.1 Technology

Use:

- `three`;
- `@react-three/fiber`;
- `@react-three/drei`.

Keep the 3D view isolated behind a visualization adapter.

### 11.2 Coordinate system

- choose a configurable reference origin;
- convert WGS84 geodetic coordinates to ECEF;
- convert ECEF to local ENU;
- render in meters;
- expose altitude exaggeration;
- clearly label reference frame and scale.

Do not render latitude and longitude directly as Cartesian x/y coordinates.

### 11.3 Initial scene

- trajectory line;
- channel-colored segments;
- ground grid;
- north/east/up axes;
- vertical drop lines or profile curtain;
- orbit controls;
- reset view;
- fit trajectory;
- selected point marker;
- linked chart cursor;
- selected range emphasis.

### 11.4 Playback

- play/pause;
- frame step;
- speed control;
- scrub timeline;
- moving vehicle marker;
- trail length;
- chase and orbit camera;
- event jump list;
- synchronized map/chart/table cursor.

### 11.5 Advanced 3D modes

Add only after the basic scene is stable:

- trajectory ribbon;
- uncertainty tube;
- speed/quality-dependent width;
- multiple tracks;
- separation vectors;
- closest-approach marker;
- optional simple aircraft model;
- screenshot export.

### Performance requirements

- decimate geometry based on display resolution;
- use buffer geometry;
- avoid one React component per sample;
- update playback marker without rebuilding the entire path;
- cap labels and annotations.

### Acceptance criteria

A user can inspect and play a local ENU flight trajectory, color it by a selected channel, and synchronize selection with the 2D analysis workspace.

### PR segmentation

- `PR-701: Add ENU coordinate conversion and tests`
- `PR-702: Add React Three Fiber trajectory scene`
- `PR-703: Link 3D selection and channel coloring`
- `PR-704: Add synchronized playback and camera modes`
- `PR-705: Add multi-track vectors and advanced geometry`

---

## 12. Phase 8 — GPU map visualization and optional global view

**Goal:** scale geospatial rendering and add global context only where justified.

### 12.1 deck.gl integration

Use deck.gl when Leaflet path rendering becomes a bottleneck or advanced layers are required.

Candidate layers:

- PathLayer;
- TripsLayer;
- ScatterplotLayer;
- PointCloudLayer;
- HeatmapLayer;
- GeoJsonLayer;
- ColumnLayer.

Capabilities:

- GPU trajectory rendering;
- animated trails;
- point-density heatmaps;
- channel-colored points;
- large multi-track overlays;
- map-linked range selection.

### 12.2 CesiumJS decision gate

Only add CesiumJS if at least one real requirement needs:

- global Earth visualization;
- terrain;
- satellite or space tracks;
- long-distance trajectories;
- 3D Tiles;
- globe-scale camera navigation.

Cesium should be an optional visualization module, not a dependency of the core workbench.

### Acceptance criteria

deck.gl provides measurable improvement for large map datasets. Cesium is introduced only after a documented use-case decision.

### PR segmentation

- `PR-801: Add deck.gl map adapter and GPU path layer`
- `PR-802: Add animated trips, point cloud, and heatmap layers`
- `PR-803: Evaluate Cesium global-view proof of concept`
- `PR-804: Add Cesium module only if decision gate passes`

---

## 13. Phase 9 — Format and conversion expansion

**Goal:** prioritize formats that improve interoperability and large-data workflows.

### Tier 1

- Apache Arrow IPC;
- Parquet;
- project-native JDDC archive;
- CZML;
- KMZ;
- IGC.

### Tier 2

- FIT;
- TCX;
- MAVLink logs;
- common ADS-B CSV/JSON layouts;
- SQLite;
- configurable fixed-width text.

### Tier 3 / research

- HDF5;
- MATLAB MAT;
- NetCDF;
- LAS/LAZ;
- schema-defined binary import.

### Requirements for every format

- format descriptor;
- content detection;
- parser/exporter version;
- unit conversion;
- metadata mapping;
- representative fixtures;
- malformed fixtures;
- round-trip or golden-output tests;
- compatibility notes;
- file-size and point-count limits;
- licensing review for dependencies.

### Acceptance criteria

Formats are added based on documented demand and are fully tested, not merely accepted by extension.

### PR segmentation

One format or tightly related family per PR.

---

## 14. Phase 10 — Projects, reproducibility, and reporting

**Goal:** make analysis sessions durable and defensible.

### 14.1 Project archive

Introduce a versioned `.jddc-project` archive containing:

- project manifest;
- dataset references or embedded data;
- source hashes;
- metadata;
- transformation recipes;
- annotations;
- chart layouts;
- selections/bookmarks;
- alignment parameters;
- application and parser versions.

Use a ZIP container with JSON manifests and optional binary/Arrow payloads.

### 14.2 Reproducibility

- deterministic recipe replay;
- source checksum verification;
- operation version migration;
- immutable audit log;
- explicit warnings when source files differ;
- export of recipe-only files;
- comparison of current versus saved outputs.

### 14.3 Reports

Generate HTML and PDF-ready reports containing:

- source summary;
- quality findings;
- transforms applied;
- selected charts;
- map image;
- 3D screenshot;
- segment/event table;
- export details;
- checksums and software versions.

### Acceptance criteria

A project can be saved, reopened, verified against source hashes, and reproduced with the same operations and outputs.

### PR segmentation

- `PR-1001: Define versioned project manifest`
- `PR-1002: Add project save/open and migrations`
- `PR-1003: Add recipe verification and audit history`
- `PR-1004: Add analytical report generation`

---

## 15. Phase 11 — Extensibility and plugin boundaries

**Goal:** make new formats, transforms, derivations, and visualizations addable without modifying central orchestration code.

### Plugin contracts

- parser plugin;
- exporter plugin;
- transform plugin;
- derived-channel plugin;
- chart preset plugin;
- report section plugin.

Initial implementation should remain compile-time registered. Runtime third-party plugins should not be enabled until security, versioning, and sandbox requirements are defined.

### Developer tooling

- plugin templates;
- fixture conventions;
- contract tests;
- typed registration;
- compatibility version;
- documentation generator.

### Acceptance criteria

A new parser, transform, or derivation can be added through a documented contract with automated contract tests and minimal central-file changes.

---

## 16. Phase 12 — Release, security, and enterprise hardening

**Goal:** make desktop distribution trustworthy and repeatable.

### Scope

- Windows code signing;
- macOS signing and notarization;
- Electron fuses;
- dependency and license scanning;
- SBOM generation;
- artifact checksums for every platform;
- provenance/attestation;
- reproducible release notes;
- crash-report export without automatic data transmission;
- local settings and cache controls;
- offline basemap strategy;
- secure project-file validation;
- file-size and decompression-bomb limits;
- parser fuzz testing;
- threat model and security review.

### Release channels

- stable;
- prerelease/beta;
- optional nightly artifact builds.

### Acceptance criteria

Release artifacts are signed where supported, checksummed, attached to GitHub Releases, and generated only from validated source revisions.

---

## 17. Cross-cutting test strategy

### Unit tests

- geodesic helpers;
- coordinate transforms;
- time conversions;
- filters;
- interpolation;
- resampling;
- derived channels;
- segment detectors;
- selection mapping;
- recipes and migrations.

### Golden fixtures

Maintain versioned fixtures for every supported input and output format.

### Property and fuzz tests

Use generated inputs for:

- parser robustness;
- invalid coordinates;
- non-monotonic time;
- antimeridian and poles;
- empty and single-point tracks;
- extreme values;
- malformed XML/JSON/binary;
- operation invariants.

### Integration tests

- import → transform → export;
- save project → reopen → reproduce;
- linked chart/map/table selection;
- multi-dataset alignment;
- 3D playback synchronization;
- desktop open/import/export smoke test.

### Performance tests

Track:

- import duration;
- peak memory;
- transform duration;
- chart interaction latency;
- map frame rate;
- 3D frame rate;
- project save/open duration.

Performance regressions should be reported even before hard failure thresholds are introduced.

---

## 18. User-experience requirements

Across all phases:

- preserve the current quick conversion path;
- provide beginner-safe defaults and advanced controls;
- show units everywhere;
- distinguish source, derived, corrected, and interpolated values;
- expose warnings without blocking safe work;
- provide reset and undo;
- never hide point removal or repair;
- keep advanced tools discoverable but not mandatory;
- maintain keyboard and accessible control support;
- retain useful behavior without internet access.

Recommended workspace layout:

```text
Top bar: project, import, save, export, undo/redo
Left panel: datasets, channels, segments, operations
Center: map / charts / 3D tabs or split layout
Right panel: selection details, transform configuration, statistics
Bottom: timeline, logs, warnings, progress
```

---

## 19. Recommended execution order

The strict dependency order is:

1. Phase 0 — baseline stability;
2. Phase 1 — shared selection;
3. Phase 2 — derived analytics;
4. Phase 3 — chart workspace;
5. Phase 4 — massaging pipeline;
6. Phase 5 — worker/performance architecture;
7. Phase 6 — multi-dataset comparison;
8. Phase 7 — local 3D;
9. Phase 8 — GPU map/global options;
10. Phase 9 — formats;
11. Phase 10 — project persistence/reporting;
12. Phase 11 — plugin boundaries;
13. Phase 12 — distribution hardening.

Limited format additions may occur earlier when required by real users, but should not interrupt the foundational sequence.

---

## 20. First implementation tranche

The first tranche after the active hardening PR should contain four separate pull requests:

### PR-101 — Shared selection model

Deliver:

- workspace selection store;
- time/index range conversion;
- selected-range statistics;
- unit tests;
- no chart-library replacement yet.

### PR-102 — Linked map/chart/table selection

Deliver:

- chart hover cursor;
- map nearest-point selection;
- table row synchronization;
- selected-range highlighting;
- integration tests.

### PR-201 — Derived analytics registry

Deliver:

- derivation contract;
- vertical speed;
- acceleration;
- turn rate;
- sample interval/frequency;
- quality flags;
- documentation and tests.

### PR-301 — Chart workspace foundation

Deliver:

- uPlot adapter;
- altitude, speed, vertical-speed, heading, and quality presets;
- zoom/pan;
- synchronized cursor;
- range brushing;
- selected-range export.

Do not begin the 3D viewer until these linked-analysis primitives are stable.

---

## 21. Agent execution guidance

Recommended default model assignment:

| Work type | Suggested model | Reasoning |
| --- | --- | --- |
| Architecture and cross-cutting design | Claude Sonnet or GPT Codex | High |
| Focused TypeScript implementation | GPT Codex | Medium–High |
| UI component implementation | Claude Sonnet | Medium |
| Numerical/geospatial algorithms | strongest available reasoning model | High |
| Tests, fixtures, and audit | independent model from implementer | High |
| Documentation and migration notes | Claude Sonnet | Medium |

For every PR, the implementation agent must receive:

- exact scope;
- excluded scope;
- acceptance criteria;
- files likely involved;
- required tests;
- performance considerations;
- backward-compatibility rules.

The audit agent must independently verify claims and produce a report that can be pasted back into the main planning conversation.

---

## 22. Definition of done

A phase or PR is complete only when:

- implementation is real and reachable through the UI or documented API;
- no mock data or placeholder action is presented as complete;
- types compile;
- lint passes;
- tests pass;
- production web build passes;
- applicable desktop build passes;
- fixtures and documentation are included;
- warnings and failure modes are visible;
- data mutations are auditable and undoable;
- performance impact is considered;
- the PR contains implementation and audit summaries;
- unresolved risks are explicitly recorded.

---

## 23. Immediate next action

Complete Phase 0:

1. fix the active PR's lint failure;
2. rerun CI;
3. manually run and inspect the Windows artifact build;
4. merge the hardening PR;
5. publish the baseline tagged release;
6. start `PR-101: Add shared workspace selection model`.

This sequence creates the stable foundation required for every charting, massaging, multi-dataset, and 3D capability that follows.
