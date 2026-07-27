# JDDC Performance Baseline

**Established:** 2026-07-27, Tranche 8 Task 8.1.
**Environment:** shared sandbox container, Node v24.14.0, ~7.8 GB total RAM (~1.6 GB free at
measurement time — other processes were concurrently using the machine). Not a dedicated
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

Each size below was run as its own process (`node --expose-gc scripts/run-benchmarks.mjs <size>`)
rather than all three in one invocation — see "Operational note" below.

| Points | Generate | sortByTime | dedupe | kinematics | quality-events | GPX export | Heap (post-GC) |
|---|---|---|---|---|---|---|---|
| 100,000 | 16 ms | 10 ms | 57 ms | 123 ms | 105 ms | 738 ms | 5 → 24 MB |
| 500,000 | 279 ms | 717 ms | 416 ms | 1,036 ms | 77 ms | 2,505 ms | 5 → 97 MB |
| 1,000,000 | 631 ms | 623 ms | 909 ms | 1,990 ms | 139 ms | 4,179 ms | 5 → 191 MB |

## Reading these numbers

- **GPX export dominates at every size** (~4.2 s at 1M points, ~74% of the measured per-size
  total) and scales roughly linearly (~4.2 µs/point). It is the first thing to profile if export
  responsiveness at scale becomes a product concern — likely string-building overhead in the GPX
  writer, not investigated further here.
- **Kinematics derivation is the second-largest cost** (~2 µs/point) and already clones the full
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

## Operational note: run each size as its own process

Running all three sizes (100k, 500k, 1M) sequentially in a single `node` process was killed by
the environment (`SIGTERM`, exit 143) partway through the 1M step in this sandbox, even though
each size completes cleanly as an isolated process — this reflects the shared sandbox's memory
pressure from other concurrent processes, not a bug in the harness or the measured code (confirmed
by running `1000000` alone multiple times without failure). `npm run bench` without arguments
therefore defaults to the safe `10,000 / 50,000 / 100,000` sizes for routine local use; pass
explicit sizes for the full range:

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
