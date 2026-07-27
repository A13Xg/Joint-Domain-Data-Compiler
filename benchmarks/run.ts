import { generateSyntheticTrack } from './generate.ts'
import type { Dataset } from '../src/core/model.ts'
import { dedupe, sortByTime } from '../src/core/transforms.ts'
import { standardKinematicsDerivation } from '../src/core/analytics/kinematics.ts'
import { detectQualityEvents } from '../src/core/quality/events.ts'
import { exportDataset } from '../src/core/exporters/index.ts'

// Default to sizes safe in a memory-constrained CI/sandbox runner. Pass
// explicit sizes to exercise the full 100k/500k/1M range on a machine with
// more headroom, e.g.: node --expose-gc scripts/run-benchmarks.mjs 100000 500000 1000000
const DEFAULT_SIZES = [10_000, 50_000, 100_000]
const SIZES = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0)
const sizesToRun = SIZES.length > 0 ? SIZES : DEFAULT_SIZES

function timeMs(fn: () => void): number {
  const start = process.hrtime.bigint()
  fn()
  return Number(process.hrtime.bigint() - start) / 1e6
}

function heapMb(): number {
  if (global.gc) global.gc()
  return process.memoryUsage().heapUsed / (1024 * 1024)
}

function makeDataset(points: ReturnType<typeof generateSyntheticTrack>): Dataset {
  return { id: 'bench', name: 'bench', sourceFormat: 'gpx', points, warnings: [], channels: ['hdop', 'sat'], createdAt: 0 }
}

export async function run(): Promise<void> {
  console.log('JDDC scale benchmark — Tranche 8 Task 8.1')
  console.log('Node', process.version, '| gc exposed:', typeof global.gc === 'function')
  console.log('Covers: dataset construction, sortByTime, dedupe, standard-kinematics derivation, quality-event detection, GPX export.')
  console.log('Does NOT cover (deferred): chart preparation, map/3D geometry, comparison, project archive save/open.\n')

  const header = ['points', 'generate ms', 'sortByTime ms', 'dedupe ms', 'kinematics ms', 'quality-events ms', 'gpx export ms', 'heap MB (post-GC)']
  console.log(header.join('  |  '))

  for (const size of sizesToRun) {
    const heapBefore = heapMb()
    let points: ReturnType<typeof generateSyntheticTrack> = []
    const generateTime = timeMs(() => { points = generateSyntheticTrack(size) })
    let dataset: Dataset | null = makeDataset(points)

    const sortTime = timeMs(() => { sortByTime(dataset!.points) })
    const dedupeTime = timeMs(() => { dedupe(dataset!.points, 0) })
    const kinematicsTime = timeMs(() => { standardKinematicsDerivation.derive({ dataset: dataset!, points: dataset!.points }) })
    const qualityTime = timeMs(() => { detectQualityEvents(dataset!.points) })
    const exportTime = timeMs(() => { exportDataset(dataset!, 'gpx') })
    const heapAfter = heapMb()

    console.log([
      size.toLocaleString(),
      generateTime.toFixed(0),
      sortTime.toFixed(0),
      dedupeTime.toFixed(0),
      kinematicsTime.toFixed(0),
      qualityTime.toFixed(0),
      exportTime.toFixed(0),
      `${heapBefore.toFixed(0)} → ${heapAfter.toFixed(0)}`,
    ].join('  |  '))

    // Drop references before the next (larger) iteration so its heapBefore
    // reading reflects a clean baseline rather than this iteration's data.
    points = []
    dataset = null
  }

  if (!global.gc) {
    console.log('\nNote: run with `node --expose-gc` (see the npm script) for a meaningful heap-usage column; without it, heap deltas include uncollected garbage from prior steps.')
  }
}
