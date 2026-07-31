# JDDC Tab → Component → State Quick Reference

Developer lookup table companion to [`UI_LAYOUT.md`](./UI_LAYOUT.md). Maps each navigable tab to its rendering component, the file it lives in, and where its durable/session state comes from. All tabs are rendered conditionally inline in `src/App.tsx`'s `tab-content` section — there is no router.

| Tab id | Label | Component | File | State source |
|---|---|---|---|---|
| `import` | Import | `ImportView` | `src/ui/ImportView.tsx` | local (`dragActive` in `App.tsx`) |
| `mapping` | CSV Mapping | `MappingPanel` | `src/ui/MappingPanel.tsx` | `pendingCsv` in `App.tsx` |
| `overview` | Overview | `StatsPanel` | `src/ui/StatsPanel.tsx` | active `Dataset` + `bookmarks` |
| `map` | Map | `MapView` (+ `MapOverlayPanel`) | `src/ui/MapView.tsx`, `src/ui/MapOverlayPanel.tsx` | `workspace.map`, `workspace.mapOverlays`, `otherTracks` |
| `charts` | Charts | `TimeSeriesChart` | `src/ui/TimeSeriesChart.tsx` | active `Dataset.points`/`channels` |
| `table` | Table | `DataTable` | `src/ui/DataTable.tsx` | active `Dataset.points`/`channels` |
| `compare` | Compare | `ComparisonPanel` | `src/ui/ComparisonPanel.tsx` | `datasets`, `workspace.comparison` |
| `scene3d` | 3D | `Trajectory3dPanel` | `src/ui/Trajectory3dPanel.tsx` | active `Dataset`, `datasets`, `workspace.scene3d` |
| `transform` | Transform | `TransformPanel` + `NotionalSmoothingPanel` | `src/ui/TransformPanel.tsx`, `src/ui/NotionalSmoothingPanel.tsx` | `histories`, `operationRecords`, `namedRecipes` |
| `project` | Project | `ProjectPanel` (+ `ReportExportDialog`) | `src/ui/ProjectPanel.tsx`, `src/ui/ReportExportDialog.tsx` | full workspace: `datasets`, `histories`, `workspace`, `bookmarks`, `fusionArtifacts`, `projectName/Notes/Dirty` |
| `export` | Export | `ExportPanel` | `src/ui/ExportPanel.tsx` | active `Dataset` |
| `sources` | Sources | `SourcesPanel` | `src/ui/SourcesPanel.tsx` | `datasets`, `datasetDisplay` |
| `fusion` | Fusion | `FusionPanel` | `src/ui/FusionPanel.tsx` | `datasets`, `fusionArtifacts` |

## Always-mounted (non-tab) UI

| Component | File | Purpose |
|---|---|---|
| App shell / header / sidebar / tab bar | `src/App.tsx` | Root layout, dataset list, tab enablement logic (`tabs` array, ~line 439) |
| `LogConsole` | `src/ui/LogConsole.tsx` | Bottom log dock, subscribes to singleton `src/core/logger.ts` |
| `Spinner` / `ProgressBar` | `src/ui/Spinner.tsx` | Header busy indicator + global progress bar |
| `ErrorBoundary` | `src/ui/ErrorBoundary.tsx` | Full-shell crash fallback, wraps the app root |
| `InfoTooltip` | `src/ui/InfoTooltip.tsx` | Hover/focus info bubble used in `MappingPanel` |
| Toast | inline in `src/App.tsx` (`flashToast`) | Ephemeral bottom-center confirmation/error |

## Shared cross-panel state modules

| Module | File | Consumed by |
|---|---|---|
| Linked point/range selection | `src/state/pointSelection.ts` (`usePointSelection`) | Overview, Map, Charts, Table, 3D |
| Per-dataset display (color/visibility) | `src/state/workspaceDisplay.ts` | Sources, Map (other tracks), App sidebar |
| Durable workspace/view settings | `src/state/workspace.ts` | Map, Compare, 3D, Project (persisted in project archive) |
| Map overlay (KML/KMZ) state | `src/state/mapOverlays.ts` | Map, `MapOverlayPanel` |
| Undo/redo history | `src/state/history.ts` | Transform, App.tsx `undo`/`redo` |
| Quality-event detection | `src/core/quality/events.ts` | Overview, Map, Charts, Table, 3D (shared detector, per-view rendering) |
| Project archive persistence | `src/persistence/project/*` | Project tab save/restore |

## Design-token & stylesheet map

| File | Scope |
|---|---|
| `src/index.css` | Entire live app UI — tokens, shell, every panel's classes |
| `src/analysis.css` | Supplementary analysis-panel styles |
| `src/core/reports/htmlReport.ts` | Self-contained inline CSS for the exported "VectorPunk/HUD" print report (independent design system — see `UI_STYLE_THEME.md` §7) |

See [`UI_LAYOUT.md`](./UI_LAYOUT.md) for the full narrative walkthrough and [`UI_STYLE_THEME.md`](./UI_STYLE_THEME.md) for the design-token/animation/library reference.
