# JDDC Performance Baseline

**Refreshed:** 2026-07-28, Phase 6 Task 6.1.
**Environment:** Windows 10 development host, Node v24.13.0, with exposed GC. Not a dedicated
benchmark machine; treat these as directional, not a certified SLA.

## What this covers

`npm run bench` (`benchmarks/generate.ts` + `benchmarks/run.ts`) measures, on a deterministic
synthetic spiral-climb track:

- dataset construction (in-memory, not a file-parse benchmark),
- `sortByTime`,
- `dedupe` (0 m tolerance),
- the versioned `standard-kinematics` derivation,
- `detectQualityEvents`,
- GPX export.

**Not covered yet** (deferred — these need their own harnesses): CSV/GPX/KML/NMEA/GPB *parsing*
specifically, chart-series preparation, map/3D geometry construction, dataset comparison, and
project archive save/open. Task 8.1 explicitly calls for measuring all of these; this pass
established the mechanism and a first slice, not the complete matrix.

## Results

Measurements were captured in one explicit full-range run: `npm run bench -- 100000 500000 1000000`.

| Points | Generate | sortByTime | dedupe | kinematics | quality-events | GPX export | Heap (post-GC) |
|---|---|---|---|---|---|---|---|
| 100,000 | 23 ms | 10 ms | 20 ms | 40 ms | 28 ms | 157 ms | 5 → 24 MB |
| 500,000 | 66 ms | 52 ms | 87 ms | 280 ms | 36 ms | 810 ms | 5 → 98 MB |
| 1,000,000 | 104 ms | 118 ms | 320 ms | 360 ms | 52 ms | 1,681 ms | 5 → 190 MB |

## Reading these numbers

- **GPX export dominates at every size** (~1.7 s at 1M points, ~64% of the measured per-size
  total) and scales roughly linearly (~1.7 µs/point). It is the first thing to profile if export
  responsiveness at scale becomes a product concern — likely string-building overhead in the GPX
  writer, not investigated further here.
- **Kinematics derivation is the second-largest cost** (~0.4 µs/point) and already clones the full
  point array once; this is consistent with the roadmap's existing note that transform history
  via full dataset snapshots is memory-proportional to point count × history depth.
- Heap growth (24 MB → 97 MB → 191 MB for 100k → 500k → 1M) is roughly linear, with no evidence of
  super-linear blowup in this slice — but this measures one dataset with no undo history retained;
  it does not validate `Stage 10`'s "unlimited full snapshot history" concern, which needs its own
  harness (accumulate N operations, measure history memory growth).
- None of the measured operations approached a multi-second-per-step wall exceeding a few seconds
  even at 1M points on this shared, resource-constrained sandbox — there is no evidence yet that
  the current `TrackPoint[]` representation is a hard blocker at this scale for the operations
  measured. This does **not** by itself justify skipping Stage 10's columnar Worker architecture
  work — chart rendering, map/3D geometry, and UI thread blocking during synchronous transforms
  are unmeasured and are the more likely real-world pain points.

## Operational note: safe routine sizes

`npm run bench` without arguments defaults to the safe `10,000 / 50,000 / 100,000` sizes for
routine local use. The full 100k/500k/1M range completed successfully on the refreshed Windows
host. Pass explicit sizes when collecting the full matrix:

```bash
node --expose-gc scripts/run-benchmarks.mjs 100000
node --expose-gc scripts/run-benchmarks.mjs 500000
node --expose-gc scripts/run-benchmarks.mjs 1000000
```

On a machine with more consistently-available memory, running all three in one invocation should
work fine; this is purely an artifact of this particular shared sandbox at measurement time.

## Recommended next steps (not done here)

1. Add parse-time benchmarks per format (CSV/GPX/KML/NMEA/GPB) using `benchmarks/generate.ts`
   output re-serialized to each format, per the plan's explicit ask.
2. Add a chart-series preparation and map/3D geometry benchmark.
3. Add an operation-history/undo-stack memory growth benchmark (N operations × snapshot size).
4. Only after this fuller picture exists: decide whether Stage 10's columnar Worker architecture
   is justified, and where specifically (the plan is explicit that this should be evidence-led,
   not assumed).
