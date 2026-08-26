# JDDC Architecture — How It Works

`ONBOARDING.md` describes **what** JDDC does. This document describes **how** it does it:
the data model everything else is built on, the layers data moves through, and the
invariants you must not break while changing any of it.

Read this before making a non-trivial change. Every claim here is derived from the
source; when they disagree, the source wins and this file is the bug.

---

## 1. The mental model

JDDC is an **N-to-M conversion and analysis matrix**, not a pipeline.

Any of 7 input formats is normalized into one internal `Dataset`. Every transform,
analysis, visualization, and exporter consumes that same `Dataset`. That single
decoupling is the reason adding a parser does not touch exporters, and adding an
exporter does not touch parsers.

```
                       ┌──────────────────────────┐
 CSV  GPX  GeoJSON     │                          │     GPX  CSV  GeoJSON
 KML  NMEA  GPB  EAG ─▶│   Dataset / TrackPoint   │──▶  KML  GPB  HTML report
                       │  (the ONLY shared shape) │
                       └──────────────────────────┘
                          ▲                    │
                          │                    ▼
                   Operations /          Map · Charts · Table
                   Transforms            3D · Compare · Fusion
```

Everything below is a detail of that picture.

---

## 2. The core data model

Defined in [`src/core/model.ts`](../src/core/model.ts). This is the most important
file in the repository.

### Canonical units — never violated

| Quantity | Unit | Field |
|---|---|---|
| Latitude / longitude | decimal degrees | `lat`, `lon` |
| Elevation | **meters** (converted at import) | `ele` |
| Time | **epoch milliseconds**, UTC unless metadata says otherwise | `time` |

A parser that reads feet converts at the boundary. Nothing downstream ever
re-interprets units.

### `TrackPoint`

One time/space sample. `lat`/`lon` are required; everything else is optional.

- `ext` — an open bag of derived/passthrough channels (`speed_mps`, `heading_deg`,
  arbitrary CSV columns). This is the extension point that keeps the core type stable
  while supporting unknown source columns.
- `provenance` — source lineage (`sourceRecord`, `sourceSegment`, `sourceFeatureIndex`,
  `qualityFlags`). **Transforms must preserve this.** It is what makes an operation
  auditable after the fact.
  - `sourceSegment` is a human-readable label and *may repeat* (a polygon's outer ring
    and inner hole share a Placemark name).
  - `sourceFeatureIndex` is unique per geometry block. Use it — not `sourceSegment` —
    when you must avoid connecting unrelated shapes (e.g. the map overlay renderer).

### `Dataset`

A normalized in-memory track: `points`, `channels` (union of `ext` keys in stable
discovery order), `warnings` (non-fatal parse issues, also logged), and optional
`metadata` carrying `coordinateSystem`, `altitudeReference`, `timeReference`,
`ChannelDefinition[]`, and `SourceMetadata` (filename, checksum, parser id/version).

`metadata` is optional purely for backward-compatible imports. New code should populate it.

---

## 3. Layer map

| Directory | Responsibility |
|---|---|
| `src/core/parsers/` | Format → `ParseResult`. Sniffing, budgets, CSV mapping. |
| `src/core/transforms.ts` | Pure point-array primitives (`TransformResult`). |
| `src/core/operations/` | Registered, versioned, replayable operations. |
| `src/core/recipes/` | Operation registry, `OperationRecord`, `Recipe` model. |
| `src/core/analytics/`, `derivations/` | Derived channels (kinematics etc.). |
| `src/core/quality/` | Quality-event detection over a dataset. |
| `src/core/fusion/` | Multi-source registration and combination. |
| `src/core/exporters/` | `Dataset` → file bytes/text. |
| `src/core/reports/` | HTML debrief generation. |
| `src/core/plugins/` | Registry unifying parsers/exporters/operations/presets. |
| `src/compute/` | Worker protocol, task host, client, cancellation. |
| `src/state/` | Cross-tab state (selection, workspace, display, history). |
| `src/persistence/project/` | `.jddc-project` archive, manifest, migrations. |
| `src/ui/` | Tab panels and shared components. |
| `src/visualization/` | Chart and 3D scene rendering. |
| `electron/`, `src/electron/` | Desktop main process, preload IPC. |

`src/App.tsx` is the shell: it owns the dataset list, the active dataset, the tab
router, and the wiring between panels. There is **no router library** — tabs render
inline, deliberately.

---

## 4. Import path

```
File ─▶ detectFormat (extension)
     ─▶ sniffTextSignature (content) ─▶ mismatch warning
     ─▶ assertByteBudget / assertPointBudget
     ─▶ parser ─▶ ParseResult ─▶ makeDataset ─▶ Dataset
```

**Format budgets** ([`src/core/parsers/limits.ts`](../src/core/parsers/limits.ts))
fail fast with an actionable message rather than stalling the UI or exhausting
renderer memory mid-parse:

| Format | Max bytes | Max points |
|---|---|---|
| `csv` | 500 MB | 2,000,000 |
| `gpx` / `geojson` / `kml` | 150 MB | 1,000,000 |
| `nmea` / `eag` | 150 MB | 2,000,000 |
| `gpb` | 300 MB | 3,000,000 |
| `unknown` | 50 MB | 500,000 |

Extension detection is a *hint*; content sniffing is the check. A `.txt` file may be
CSV or EAG TSPI, and `resolveTextFormat` disambiguates by content.

**CSV is the exception to automatic import.** It routes through an interactive
mapping step (`MappingPanel`) because column semantics are ambiguous and silent
misinterpretation of a timestamp or coordinate column is the worst failure mode in
this domain. Do not add auto-magic mapping that bypasses user confirmation.

---

## 5. Transforms vs. Operations — the distinction that matters

These are two different layers and are easy to confuse.

**Transforms** (`src/core/transforms.ts`) are pure functions over `TrackPoint[]`
returning `TransformResult { points, summary }`. They clone their input — including
`ext` and `provenance` — and never mutate. Purity is what lets the UI preview, stack,
and undo deterministically.

**Operations** (`src/core/operations/`, registered via `src/core/recipes/registry.ts`)
wrap transforms with the metadata needed for audit and replay:

```ts
interface OperationDefinition<TParams> {
  id: string            // stable, e.g. 'offset-elevation'
  version: number       // bump on behavior change
  label, description: string
  validateParams(value: unknown): TParams   // throws on bad input
  execute(ctx): { dataset, summary }
}
```

Executing one produces an `OperationRecord` carrying `operationId`,
`operationVersion`, `params`, `inputDatasetHash`, `outputDatasetHash`, `scope`,
`summary`, and `warnings`. A `Recipe` is an ordered list of those records plus a
`sourceDatasetHash`.

**Why both hashes:** they let a recorded sequence be re-applied to the original
dataset and the result verified, rather than trusted. Undo/redo uses snapshots
(O(1), capped at `MAX_HISTORY_SNAPSHOTS = 50`); replay is the independent audit path.

**If you add an operation:** register it, validate params defensively (`validateParams`
receives `unknown` and must throw on anything malformed), and bump `version` if you
ever change what existing params mean — old recipes must not silently do something new.

---

## 6. Compute / Worker layer

`src/compute/` moves expensive work off the main thread behind a typed message protocol.

- `protocol.ts` — `ComputeRequest` / `Progress` / `Success` / `Failure` / `Cancelled`.
  Every message carries a task id **and version**; a version mismatch is rejected
  before execution.
- `tasks.ts` — the registry. Currently `chartSeriesTask`, `fixedRateResampleTask`,
  `gpxExportTask` (`PRODUCTION_COMPUTE_TASKS`).
- `client.ts` / `host.ts` — the two sides. Cancellation rejects with `AbortError`;
  disposal rejects everything in flight.

Work routes to a worker **by threshold**, not always — e.g.
`GPX_EXPORT_WORKER_THRESHOLD = 50_000` points. Below it, the synchronous path is
faster than the postMessage round trip. Tests assert both sides of the threshold and
that cancellation is genuine (work actually stopped mid-flight, not run to completion).

---

## 7. Quality events

`src/core/quality/` detects, in a single O(n) pass per dataset:
`invalid-coordinate`, `duplicate-timestamp`, `gap`, `coordinate-jump`,
`elevation-spike`, `elevation-flatline`.

Detected **once** and shared across every view, so no two panels can disagree about
what is wrong with the data. Helpers map events onto an index or time range
(`eventsOverlappingIndexRange`, `eventsOverlappingTimeRange`) so panels can highlight
without re-detecting.

---

## 8. Cross-tab state

Each module in `src/state/` is pure and framework-light so it can be unit tested
without a renderer.

| Module | Owns |
|---|---|
| `pointSelection.ts` | The linked cursor (point, hover, index range, time range, segments) shared by Table/Chart/Map/3D via a subscription snapshot. |
| `workspaceDisplay.ts` | Per-dataset color, visibility, opacity, label. Sync is referentially stable — no change returns the *same object*. |
| `workspace.ts` | Durable per-tab view settings persisted into the project archive. |
| `mapOverlays.ts` | KML/KMZ overlay library state (`bundled` / `library` / `project`), and the `BUNDLED_KML_SEED_NAMES` set that marks which overlays ship with the build. |
| `history.ts` | Undo/redo snapshot ring, capped at 50. |

Restore paths **validate and backfill** rather than trust persisted input — malformed
entries are rejected and regenerated, never used as-is.

### Where bundled overlays come from

`KML-KMZ/` is one directory reached three different ways, because the browser has no
filesystem and the Windows installer must stay small:

| Build | Source of the overlay files | Wired by |
|---|---|---|
| Dev (web and desktop) | the repo directory itself | vite middleware / `kmlSeedDirectory()` |
| Web build | `dist/kml-library/` over HTTP | `jddc-bundled-kml-library` in `vite.config.ts` |
| Linux package | `resources/kml-seed` | `build.linux.extraResources` → `electron/kml-seed.cjs` |
| Windows package | not bundled; fetched on demand | `REMOTE_KML_OVERLAYS` in `electron/main.cjs` |

`build.files` carries a `!dist/kml-library/**` negation so the web build's copy never reaches
an installer. `App.tsx` draws any overlay named in `BUNDLED_KML_SEED_NAMES` after first paint,
but only into a session that has no overlays of its own — a restored project always wins.

---

## 9. Persistence

`.jddc-project` is a ZIP with an embedded JSON manifest, currently
**schema version 2**. `src/persistence/project/migrations.ts` is a sequential
migration engine: each `SchemaMigrator` declares `fromVersion` → `toVersion` and they
chain. A project saved by a *newer* app version fails with a clear message instead of
being guessed at.

Add a migrator when you change the manifest shape. Do not mutate schema v2 in place.

---

## 10. Invariants

Breaking any of these is a correctness bug, not a style issue.

1. **Never fabricate data.** Downsampling for display preserves extrema and
   first/last; export always uses the full dataset. If time cannot be honestly
   interpolated, it is dropped with a warning rather than invented.
2. **Preserve provenance and quality flags through transforms.**
3. **Transforms are pure.** Clone; never mutate the input array or its points.
4. **Coordinate math is antimeridian-safe.** Longitude (and angular channels like
   heading/bearing) unwrap across the 0/360 and ±180 seams before interpolation and
   re-wrap after.
5. **Resampling uses monotone cubic** (Fritsch–Carlson), never a naive spline —
   overshoot past true local extrema is a worse error than the linear interpolation
   it replaces.
6. **Validate at the boundary.** `validateParams` and manifest restore take `unknown`
   and must reject malformed input loudly.
7. **Reports contain no executable markup.** Titles and warnings are escaped; tests
   assert this.

---

## 11. Common changes

**Add a parser:** implement in `src/core/parsers/`, return `ParseResult`; register in
`INPUT_FORMATS` (`parsers/index.ts`); add a budget in `limits.ts`; extend
`sniffTextSignature` if it shares an extension with another format; add
`test/<format>-parser.ts` and a `test/fixtures/` fixture.

**Add a transform:** pure function in `transforms.ts` → wrap as an `OperationDefinition`
in `operations/` → register in `ensureBuiltinOperationsRegistered` → add a card in
`TransformPanel.tsx`. Registering is not optional: an unregistered transform makes
`App.tsx` synthesize a fallback history record, which renders as "not replayable" and
disables named-recipe saving for the rest of the session.

Reuse these rather than writing another copy — a second implementation of any of them is a
drift risk, and several were consolidated out of exactly that situation:

| Need | Use |
|---|---|
| Copy a point in a pure transform | `clonePoint` (`core/model.ts`) |
| Longitude / heading seam handling | `core/operations/angular.ts` (`unwrapLongitudes`, `wrapLongitude`, `unwrapDegrees`, `wrapDegrees`, `isAngularChannel`, `shortestAngleDelta`, `initialBearingDegrees`) |
| Interpolation | `fitMonotoneCubic` (`core/operations/monotone-interpolation.ts`) — never a naive spline |
| Parameter validation | `core/operations/params.ts` (`requireRecord`, `requireOneOf`, `rejectUnknownKeys`, …) |
| Full-dataset guard / range scoping | `core/operations/scope.ts` (`rejectScope`, `runPointPreserving`) |

**Add a modal:** follow `ConfirmDialog.tsx` — `.dialog-backdrop` + `.dialog`, `role`,
`aria-modal`, click-out guard, shared `trapFocus` (`ui/focusTrap.ts`), and focus restore on
close. Stop Escape propagation: `usePointSelection` installs a window-level Escape handler
that clears the whole selection, so a dialog that only calls `preventDefault` will close
*and* wipe the user's selection.

**Panel layout:** a tab panel sizes to its own content and lets `.tab-content` scroll. Only
a panel that must fill the viewport (map, charts) gets `min-height: 0` plus its own
scrolling. Never give a tab panel `overflow: hidden` without making it scrollable — that
clips content into a place no scrollbar can reach, which
`test/e2e/layout.spec.ts` now fails on.

**Add a tab:** component in `src/ui/` → entry in the `tabs` array in `App.tsx` with an
`enabled` predicate → render conditionally. Tab state belongs in `src/state/` only if
more than one tab reads it.

**Add an export format:** implement in `exporters/`, register as an
`ExporterPluginDefinition`, add schema validation to `test/validate.ts` if the format
has a schema.

---

## 12. Verifying a change

```bash
npm run check:all     # lint + 71 test harnesses + build + app health
npm run check:e2e     # 10 Playwright workflow tests (needs chromium)
npm run check:full    # check:all + check:e2e (desktop smoke still needs build:desktop:*)
npx tsc -b            # types only, fastest feedback
```

`test/validate.ts` shells out to `xmllint` for GPX/KML schema validation and **skips
silently** when it is missing — install `libxml2-utils` locally or those assertions
are not actually running.

Tests use real data and real archives, no mocks. That is deliberate: it is what
catches format edge cases and round-trip corruption.
