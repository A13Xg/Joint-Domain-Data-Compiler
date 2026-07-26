# Joint Domain Data Compiler — Full Project Review

**Review date:** 2026-07-26  
**Reviewed branch:** `agent/roadmap-integration`  
**Reviewed head:** `eca3579ef1e7aebe02d42a2d77f593f18e95015b`  
**Pull request:** #25  
**Result:** Functional engineering workbench with a solid core, but not yet a production-complete release.

## Review scope and evidence

This review covered the project from the following angles:

- product purpose and scope;
- user workflow and UI behavior;
- normalized data model and metadata semantics;
- import and export correctness;
- analytics, segmentation and transforms;
- map, chart, table and 3D visualization;
- multi-dataset comparison;
- project persistence and reproducibility;
- Worker and large-data architecture;
- code structure and maintainability;
- automated testing and fixture coverage;
- Electron, CI, release and supply-chain security;
- roadmap accuracy and sequencing;
- accessibility, privacy and offline behavior;
- browser/runtime compatibility and operational diagnostics.

Evidence included the exact CI source snapshot for the reviewed head (artifact digest `sha256:266c485a48c6e2a514ab1e46b75cbd68dccba4a790c2ea5c505679133df6e52b`), the PR diff, all current roadmap/audit documents, package and Electron configuration, 61 TypeScript/TSX source modules, and 20 Node-based regression harnesses. The reviewed head passed CI, the complete regression suite, TypeScript/Vite build, Semgrep, runtime dependency audit, project checks and focused selection checks.

## Executive assessment

JDDC is no longer a basic converter. It is a usable, local-first trajectory/TSPI engineering workbench with:

- six import families and five export families;
- a normalized point/channel/provenance model;
- linked chart, map, table and 3D inspection;
- point, cursor, index-range, time-range and segment selection;
- a practical transform set with undo/redo;
- tested analytical, recipe, plugin, Worker and project foundations;
- two-track relative-position analysis;
- self-contained compressed project archives;
- a hardened Electron shell and meaningful CI/security automation.

The project’s strongest area is its deterministic core logic. Its weakest areas are product-state centralization, end-to-end UI validation, semantic treatment of time/altitude references, memory behavior on large data, and documentation that previously described several foundations as fully integrated features.

## Product and scope review

### Current product identity

The product is best defined as a **single-user, local-first trajectory and telemetry engineering workbench**. Its primary workflow is:

1. import and map source data;
2. normalize it into a common TSPI model;
3. inspect quality and metadata;
4. derive channels and identify intervals;
5. select points, times or segments;
6. correct or transform data;
7. compare tracks;
8. inspect in charts, map, table and 3D;
9. save the workspace;
10. export data and eventually produce reports.

### Near-term non-goals

The following are intentionally not near-term priorities:

- real-time telemetry streaming;
- multi-user collaboration;
- a cloud backend or account system;
- general-purpose GIS editing;
- unrestricted runtime third-party plugins;
- a Cesium globe before the existing map and 3D workflows are mature;
- adding many vendor formats before parser quality, scale and report workflows are complete.

## Capability truth matrix

| Area | Current level | Review conclusion |
|---|---|---|
| Import and CSV mapping | Functional | Usable UI for CSV/TSV, GPX, GeoJSON, KML, NMEA and GPB. Parser validation and fixture coverage are uneven. |
| Normalized data model | Functional | Good common model and provenance fields. Metadata semantics are not consistently enforced after transforms or in altitude-sensitive analysis. |
| Linked selection | Complete | Feature scope is delivered and independently audited. Rendered-component automation is still a cross-cutting QA gap. |
| Analytics | Functional + foundation | Basic distance/speed/heading derivation is wired. Full versioned kinematics is tested but not wired into the normal UI workflow. |
| Segmentation | Functional | Default flight/data-state segmentation is available and selectable. Configuration exists in code, not as a complete UI. |
| Transforms | Functional | Practical transform set, selection scoping and undo/redo. No preview, operation ledger or recipe UI. |
| Charts | Functional | One SVG chart surface with presets, downsampling, brushing and readouts. Multi-pane scale/axis behavior and export remain. |
| Map | Functional | Linked Leaflet map with range emphasis. Core processing is offline, but the default OSM basemap requires network access. |
| 3D | Functional | Software Canvas perspective/orthographic trajectory renderer with orbit/pan/zoom, cursor, selection and playback. Not WebGL and not timestamp-accurate. |
| Comparison | Functional | Two-track nearest-time relative analysis. Not yet linked to multi-track charts/map/3D and lacks interpolation/drift handling. |
| Workers | Foundation + one wired task | Resampling runs in a Worker. Chart task exists but is not used by the chart UI. Progress is coarse and cancellation is not cooperative during synchronous work. |
| Projects | Functional | Self-contained gzip archive with datasets and histories. It is not yet complete workspace persistence or a migration-capable project format. |
| Recipes | Foundation | Versioned contracts, registry, hashing and replay are tested but not connected to transform history or UI. |
| Plugins | Foundation/deferred | Compile-time contracts and atomic registry are tested. Product menus still use hard-coded registries; runtime discovery is intentionally deferred. |
| Export/reporting | Functional export, planned reporting | GPX/CSV/GeoJSON/KML/GPB export exists. No analysis report system. Some formats are not full metadata round trips. |
| Release/security | Partial | Strong CI, CSP, Electron isolation, Semgrep, audits, SBOMs and checksums. No signing, packaged-app smoke automation or fuzzing. |

## Correctness findings

### High priority

1. **Dataset identifiers can collide after project restore.** Imported dataset IDs use a process-local sequence. A fresh application that restores archived IDs and then imports new data can generate a duplicate ID.
2. **Altitude-reference semantics are recorded but not enforced.** 3D and relative ENU calculations treat `ele` as a common height even when datasets may declare MSL, HAE, AGL, pressure or unknown references.
3. **The complete kinematics engine is not the UI derivation path.** The UI currently invokes a simpler transform that produces distance, speed and heading; the tested versioned engine additionally produces vertical speed, turn rate, acceleration and sample timing.
4. **Worker cancellation is not truly cooperative for resampling.** The task checks cancellation before a synchronous operation, and reports only start/end progress. The Worker cannot process a cancel message while the synchronous operation is running.
5. **Project decompression has only a compressed-size gate.** Point-count validation occurs after decompression and JSON parsing; a highly compressed oversized payload can still create excessive transient memory pressure.
6. **Project view persistence is incomplete.** Saving from the Project tab records that tab rather than the prior working tab, and chart/map/3D/comparison local state is not centralized or restored.
7. **Transformed metadata can become incomplete.** `withPoints` updates channel IDs but drops semantic definitions for newly derived channels unless those definitions already existed.

### Medium priority

1. The selected-point clear control currently uses an action that also clears range/time/segment selection, despite separate range controls.
2. GPB is described as lossless, but elevation and numeric channels are stored as float32; string/boolean channels, names, descriptions, provenance and semantic metadata are not preserved.
3. Several large-data calculations use array spread with `Math.min`/`Math.max`, which can fail or allocate heavily at large sample counts.
4. Full CSV parsing is chunked but still accumulates all rows before building points, temporarily holding both row objects and point objects.
5. GPX, KML, NMEA and full CSV import paths lack direct parser regression fixtures in the default automated suite.
6. Comparison selectors can retain stale dataset IDs after datasets are removed or replaced.
7. The selection store is keyed by point-array identity and is designed around one active dataset; it is not a multi-track selection model.
8. UI panel state is local and is lost when tabs unmount, which blocks complete project persistence.

### Documentation corrections required

- “Offline” must distinguish local processing from the online OSM tile layer.
- GPB must be described as a compact numeric binary format, not a lossless workspace format.
- Standard kinematics must be described as a tested engine until it is wired into the UI.
- Segmentation is configurable through the core API, but the current UI uses default configuration.
- Current 3D does not include follow mode or automatic rotation.
- Project archives preserve datasets/history and basic selection, not every workspace control or camera/chart layout.
- The chart Worker task is a tested foundation, not a currently used chart-rendering path.

## Architecture and maintainability review

### Strengths

- No detected source-module import cycles.
- Core algorithms are largely pure and testable.
- Parsers and exporters share one normalized model.
- Electron uses context isolation, sandboxing, disabled Node integration and navigation restrictions.
- Worker protocol, recipe system and plugin contracts have clear version fields.
- Source has no `@ts-ignore`, ESLint suppression, explicit `any`, merge artifacts or placeholder production behavior.

### Risks

- `App.tsx` owns import, datasets, history, workspace tabs, project restore and notifications.
- Selection is a global singleton rather than explicit workspace state.
- Transform history stores complete dataset snapshots, causing memory growth proportional to point count and history depth.
- Chart, map, table, 3D and comparison controls do not share a durable workspace-state model.
- `Trajectory3dPanel` is large and redraw lifecycle is React-state-driven; playback recreates render effects frequently.
- `TransformPanel` is a manual control catalog instead of being generated from operation descriptors.
- Global CSS remains large and tightly coupled to component class names.

## Visualization review

### Charts

The current chart is appropriate for the first functional version, but each series is independently normalized while only one visible Y-axis scale is shown. Future multi-series work must make scales explicit to avoid misleading comparisons. The chart task should move to the existing Worker only after payload and scheduling costs are addressed.

### Map

Leaflet is sufficient for current data volumes because rendering is bounded. Prioritize an offline/no-basemap mode, antimeridian/gap-aware paths, track visibility controls and report image capture before adopting deck.gl or Cesium.

### 3D

The custom Canvas renderer provides meaningful 3D inspection without another dependency. Before migrating to Three.js/WebGL, first implement timestamp-accurate playback, stable render-loop ownership, persisted camera state, multi-track rendering and performance benchmarks. Migrate only if Canvas cannot meet measured requirements.

## User experience, accessibility and privacy review

### Strengths

- The workflow is divided into understandable workspaces rather than exposing raw parser or operation APIs.
- Linked selection reduces the effort required to correlate the same source record across views.
- Long imports and Worker resampling expose status, and parser warnings remain visible.
- Local processing avoids mandatory data upload or account creation.

### Gaps

- The custom chart and Canvas 3D surfaces do not yet provide complete keyboard/screen-reader equivalents for rendered data.
- Several states are communicated primarily by color; selection, range and anomaly states need redundant shapes, labels or patterns.
- Global keyboard shortcuts are documented in one workspace but need a discoverable shortcut/help surface and accessibility review.
- Focus behavior, tab order and reduced-motion behavior are not covered by automated tests.
- The online OpenStreetMap tile layer can disclose the viewed geographic area to tile servers; users need an explicit no-basemap/offline option and network-state indicator.
- The UI and reports are English-only and have no localization framework.

## Runtime compatibility and operations review

- The Electron runtime supplies modern Worker, CompressionStream/DecompressionStream and ResizeObserver support. Browser deployment assumes a current evergreen browser; minimum browser versions are not documented or tested.
- Error handling includes a React error boundary, parser warnings and a logger, but there is no user-exportable diagnostic bundle or crash recovery report.
- Panel-local settings are lost on unmount, which is both a persistence and usability issue.
- The product has no telemetry dependency, which supports privacy, but it also means performance and crash evidence must be gathered through explicit local diagnostics.

## Testing and quality review

### Current strengths

The 20 regression harnesses cover:

- analytics registry and kinematics;
- chart downsampling;
- compute host/client/Worker runtime;
- CSV analyzer contract;
- geodesy;
- selection and linked cursor state;
- plugin and recipe registries;
- project manifest/archive round trips;
- range statistics and scoped transforms;
- relative analytics;
- resampling;
- segmentation;
- 3D geometry;
- core export validation and GPX XSD conformance.

### Gaps

- no rendered React component tests;
- no browser end-to-end suite;
- no automated import smoke matrix for all supported formats;
- no packaged Electron launch tests;
- no performance regression benchmarks;
- no parser fuzzing/property-based tests;
- no project migration tests because migrations do not exist yet.

## Security and release review

### Strengths

- restrictive CSP;
- Electron sandbox/context isolation and navigation controls;
- runtime dependency audit;
- CycloneDX SBOMs;
- Semgrep production-source scan;
- release checksums;
- deterministic `npm ci` builds;
- project archive validation and point-count limits.

### Remaining work

- pin GitHub Actions and the Semgrep container to immutable revisions;
- Windows signing and macOS signing/notarization;
- Electron fuse review;
- decompressed-byte limits for project/future archive formats;
- parser size limits and fuzzing;
- build provenance/attestations;
- packaged application smoke tests;
- crash/diagnostic bundle export.

## Revised execution decision

The previous roadmap emphasized adding broad capabilities. The revised roadmap prioritizes **truth, semantic correctness, workflow completion and scale** before format or platform expansion.

The next sequence is:

1. correctness and state stabilization;
2. end-to-end UI test foundation;
3. semantic analytics/metadata integration;
4. transform previews and reproducible operation history;
5. multi-chart workspace;
6. timestamp-accurate and multi-track visualization;
7. comparison alignment improvements;
8. project v2 and reports;
9. columnar Worker architecture and benchmarks;
10. targeted format and release expansion.

## Final conclusion

JDDC has a credible foundation and a coherent product direction. It should not be treated as production-complete yet. The revised roadmap preserves genuinely complete work, downgrades tested-but-unwired systems to foundations, removes inaccurate claims, and puts correctness, UI verification and engineering workflow depth ahead of feature-count expansion.
