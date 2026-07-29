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
- chart-series preparation,
- 3D trajectory geometry construction,
- nearest-time alignment plus relative-position comparison,
- project archive JSON serialization and validation-backed re-open,
- GPX parse/export (DOM parsing is intentionally capped at 100k points; see below).

**Not covered yet** (deferred — these need their own harnesses): CSV/KML/NMEA/GPB parsing,
GPX parsing above 100k points and browser map rendering. Task 6.1 explicitly calls for measuring all
of these; this pass established the mechanism and a larger, but still incomplete, matrix.

## Results

Measurements were captured in explicit 100k and 500k/1M runs: `npm run bench -- 100000` and
`npm run bench -- 500000 1000000`.

| Points | Generate | sort | dedupe | kinematics | quality | chart | 3D geometry | comparison | archive write | archive read | archive size | GPX parse | GPX export | Heap (post-GC) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 100,000 | 20 ms | 10 ms | 20 ms | 41 ms | 25 ms | 4 ms | 9 ms | 40 ms | 170 ms | 176 ms | 13.3 MB | 2,845 ms | 184 ms | 7 → 104 MB |
| 500,000 | 80 ms | 64 ms | 79 ms | 220 ms | 32 ms | 25 ms | 33 ms | 232 ms | 859 ms | 975 ms | 66.6 MB | skipped >100k | 783 ms | 7 → 166 MB |
| 1,000,000 | 101 ms | 116 ms | 289 ms | 358 ms | 52 ms | 44 ms | 49 ms | 482 ms | 1,750 ms | 1,847 ms | 133.1 MB | skipped >100k | 1,612 ms | 8 → 325 MB |

### Browser map activation (offline basemap)

`npm run bench:map` imports deterministic GPB tracks so this measures the map path rather than CSV preview/mapping work. The benchmark retains every raw point but asserts that the map draws no more than its 4,000-point visual budget.

| Points | Map activation | Drawn points |
|---:|---:|---:|
| 100,000 | 1,136 ms | ≤4,000 |
| 500,000 | 1,061 ms | ≤4,000 |

The browser-map benchmark deliberately caps at 500k points: that is the practical ceiling for this evidence pass, and larger CSV inputs predominantly measure CSV analysis/import rather than the downsampled map view.

## Reading these numbers

- **GPX DOM parsing is not scale-safe in this runner.** The 100k parse took ~3.1 seconds and grew
  post-GC heap to 90 MB; the uncapped 500k parse exhausted Node's ~4 GB heap. The benchmark now
  refuses DOM-parser timing above 100k rather than risking an OOM. This is evidence of a parser
  architecture limitation, not a successful 500k/1M parsing claim.
- **GPX export dominates among the full-range operations** (~1.6 s at 1M points, ~64% of the measured per-size
  total) and scales roughly linearly (~1.7 µs/point). It is the first thing to profile if export
  responsiveness at scale becomes a product concern — likely string-building overhead in the GPX
  writer, not investigated further here.
- **Comparison is the second-largest measured analytical cost** (~0.8 µs/point at 1M), while
  kinematics is ~0.3 µs/point. Both remain synchronous, so either is a candidate for a future
  worker decision only if interaction profiling shows a real UI responsiveness problem.
- **Project archive I/O is a measured scale limit.** At 1M points, JSON archive serialization is
  ~1.8 s and parse/validation/reconstruction is ~1.8 s for a 133 MB uncompressed archive. These
  are synchronous benchmark measurements; UI workflows should keep their existing save/open
  feedback and must not imply that multi-million-point project I/O is instant.
- **Map activation remains bounded by the visual point budget.** The map retains raw points for selection and analysis while drawing at most 4,000 valid points. A previous `maxPoints + 1` endpoint edge case was corrected; the budget is now strict.
- **Kinematics derivation** already clones the full
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
  work — map rendering, archive I/O, parsing, and UI thread blocking during synchronous transforms
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
2. Add parser benchmarks.
3. Add an operation-history/undo-stack memory growth benchmark (N operations × snapshot size).
4. Only after this fuller picture exists: decide whether Stage 10's columnar Worker architecture
   is justified, and where specifically (the plan is explicit that this should be evidence-led,
   not assumed).
