import type { Dataset, TrackPoint } from '../src/core/model.ts'
import { buildGpx } from '../src/core/exporters/gpx.ts'
import { buildGpxChunked } from '../src/core/compute/gpxExport.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

function makePoints(count: number): TrackPoint[] {
  const points: TrackPoint[] = []
  for (let i = 0; i < count; i++) {
    points.push({
      lat: 45 + i * 0.0001,
      lon: -122 + i * 0.0001,
      ele: 100 + (i % 50),
      time: i * 1000,
      ext: { hdop: 1.2, custom: i % 7 },
    })
  }
  // Include a couple of invalid/missing points to exercise skip counting.
  points.push({ lat: Number.NaN, lon: -122, time: count * 1000 })
  points.push({ lat: 999, lon: -122, time: (count + 1) * 1000 })
  return points
}

function makeDataset(points: TrackPoint[]): Dataset {
  return {
    id: 'gpx-chunk-test',
    name: 'Chunked GPX test',
    sourceFormat: 'csv',
    createdAt: 0,
    warnings: [],
    channels: ['hdop', 'custom'],
    points,
  }
}

// --- Correctness: chunked output must equal the synchronous, non-chunked builder ---
{
  const dataset = makeDataset(makePoints(1234))
  const expected = buildGpx(dataset)
  const chunked = await buildGpxChunked(dataset, {}, { chunkSize: 100 })
  check('Chunked output matches buildGpx xml exactly', chunked.xml === expected.xml)
  check('Chunked output matches buildGpx pointCount', chunked.pointCount === expected.pointCount)
  check('Chunked output matches buildGpx skippedMissing', chunked.skippedMissing === expected.skippedMissing)
  check('Chunked output matches buildGpx skippedOutOfRange', chunked.skippedOutOfRange === expected.skippedOutOfRange)
}

// --- Chunking must not change results regardless of chunk size ---
{
  const dataset = makeDataset(makePoints(517))
  const expected = buildGpx(dataset)
  for (const chunkSize of [1, 7, 50, 5000]) {
    const chunked = await buildGpxChunked(dataset, {}, { chunkSize })
    check(`chunkSize=${chunkSize} produces identical xml`, chunked.xml === expected.xml)
  }
}

// --- Empty dataset edge case ---
{
  const dataset = makeDataset([])
  const expected = buildGpx(dataset)
  const chunked = await buildGpxChunked(dataset, {}, { chunkSize: 10 })
  check('Empty dataset chunked output matches buildGpx', chunked.xml === expected.xml)
}

// --- Genuine cooperative yielding: control returns to the event loop between chunks ---
{
  const points = makePoints(300)
  const dataset = makeDataset(points)
  const total = points.length
  let yieldCalls = 0
  const marker: string[] = []
  await buildGpxChunked(dataset, {}, {
    chunkSize: 50,
    yieldControl: async () => {
      yieldCalls++
      marker.push('yield-start')
      // A real macrotask hop, not just a resolved microtask, so a queued
      // cancel/progress message would genuinely get a chance to run.
      await new Promise((resolve) => setTimeout(resolve, 0))
      marker.push('yield-end')
    },
  })
  check('Yields control between chunks', yieldCalls === Math.ceil(total / 50) - 1)
  check('Each yield actually awaits an async boundary', marker.length === yieldCalls * 2)
}

// --- Progress checkpoints arrive at expected chunk boundaries ---
{
  const dataset = makeDataset(makePoints(250))
  const progressEvents: { completed: number; total: number }[] = []
  await buildGpxChunked(dataset, {}, {
    chunkSize: 100,
    reportProgress: (progress) => progressEvents.push(progress),
  })
  check('Reports progress once per chunk', progressEvents.length === 3)
  check('Progress completed values are monotonic chunk boundaries', progressEvents.map((p) => p.completed).join(',') === '100,200,252')
  check('Progress total matches full point count', progressEvents.every((p) => p.total === 252))
}

// --- Cancellation genuinely stops work partway through, not just at the end ---
{
  const dataset = makeDataset(makePoints(10_000))
  const controller = new AbortController()
  const progressEvents: { completed: number; total: number }[] = []
  const run = buildGpxChunked(dataset, {}, {
    chunkSize: 500,
    reportProgress: (progress) => {
      progressEvents.push(progress)
      if (progressEvents.length === 2) controller.abort()
    },
    signal: controller.signal,
  })

  let aborted = false
  try {
    await run
  } catch (error) {
    aborted = (error as Error).name === 'AbortError'
  }
  check('Cancellation rejects with AbortError', aborted)
  check('Cancellation happens before all chunks are processed', progressEvents.length < 10_002 / 500)
  check('At least one chunk of progress was reported before cancelling', progressEvents.length >= 1)
}

console.log(`\n${failures === 0 ? 'ALL GPX CHUNKED COMPUTE CHECKS PASSED' : `${failures} GPX CHUNKED COMPUTE CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
