import { generateSyntheticTrack } from './generate.ts'
import type { Dataset } from '../src/core/model.ts'
import { dedupe, sortByTime } from '../src/core/transforms.ts'
import { standardKinematicsDerivation } from '../src/core/analytics/kinematics.ts'
import { detectQualityEvents } from '../src/core/quality/events.ts'
import { exportDataset } from '../src/core/exporters/index.ts'
import { extractChartSeries } from '../src/visualization/charts/series.ts'
import { buildTrajectory3dGeometry } from '../src/visualization/scene3d/trajectory.ts'
import { alignTracksByNearestTime, deriveRelativePosition } from '../src/core/analytics/relative.ts'
import { parseGpx } from '../src/core/parsers/gpx.ts'
import { buildProjectManifest, createProjectArchive, parseProjectArchive, serializeProjectArchive } from '../src/persistence/project/archive.ts'
import { EMPTY_WORKSPACE_SELECTION } from '../src/core/selection.ts'
import { DOMParser } from 'linkedom'

// Browser parsing uses the platform DOMParser. The Node benchmark runner
// supplies the same lightweight XML-compatible shim used by parser tests.
if (typeof globalThis.DOMParser === 'undefined') globalThis.DOMParser = DOMParser as unknown as typeof globalThis.DOMParser

// Default to sizes safe in a memory-constrained CI/sandbox runner. Pass
// explicit sizes to exercise the full 100k/500k/1M range on a machine with
// more headroom, e.g.: node --expose-gc scripts/run-benchmarks.mjs 100000 500000 1000000
const DEFAULT_SIZES = [10_000, 50_000, 100_000]
const SIZES = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0)
const sizesToRun = SIZES.length > 0 ? SIZES : DEFAULT_SIZES
const MAX_DOM_PARSE_BENCHMARK_POINTS = 100_000

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
  console.log('Covers: dataset construction, sortByTime, dedupe, standard-kinematics derivation, quality-event detection, chart/3D preparation, nearest-time comparison, GPX parse/export, and project archive serialize/parse.')
  console.log('Does NOT cover (deferred): other parser formats and browser map rendering.\n')

  const header = ['points', 'generate ms', 'sortByTime ms', 'dedupe ms', 'kinematics ms', 'quality-events ms', 'chart ms', '3D geometry ms', 'comparison ms', 'archive write ms', 'archive read ms', 'archive MB', 'gpx parse ms', 'gpx export ms', 'heap MB (post-GC)']
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
    const chartTime = timeMs(() => { extractChartSeries(dataset!.points, 'elevation', 'time') })
    const geometryTime = timeMs(() => { buildTrajectory3dGeometry(dataset!.points) })
    const comparisonTime = timeMs(() => {
      const pairs = alignTracksByNearestTime(dataset!.points, dataset!.points, { toleranceMs: 0 })
      deriveRelativePosition(dataset!.points, dataset!.points, pairs)
    })
    const manifest = buildProjectManifest({
      datasets: [dataset], activeDatasetId: dataset.id, activeTab: 'project',
      selection: { ...EMPTY_WORKSPACE_SELECTION, datasetId: dataset.id }, applicationVersion: '0.1.0',
    })
    const archive = createProjectArchive({ manifest, datasets: [dataset], histories: {} })
    const archiveWrite = timeMs(() => { serializeProjectArchive(archive) })
    const serializedArchive = serializeProjectArchive(archive)
    const archiveRead = timeMs(() => { parseProjectArchive(serializedArchive) })
    const parseTime = size <= MAX_DOM_PARSE_BENCHMARK_POINTS
      ? timeMs(() => { parseGpx(exportDataset(dataset!, 'gpx').text) })
      : null
    const exportTime = timeMs(() => { exportDataset(dataset!, 'gpx') })
    const heapAfter = heapMb()

    console.log([
      size.toLocaleString(),
      generateTime.toFixed(0),
      sortTime.toFixed(0),
      dedupeTime.toFixed(0),
      kinematicsTime.toFixed(0),
      qualityTime.toFixed(0),
      chartTime.toFixed(0),
      geometryTime.toFixed(0),
      comparisonTime.toFixed(0),
      archiveWrite.toFixed(0),
      archiveRead.toFixed(0),
      (Buffer.byteLength(serializedArchive) / (1024 * 1024)).toFixed(1),
      parseTime === null ? `skipped >${MAX_DOM_PARSE_BENCHMARK_POINTS.toLocaleString()}` : parseTime.toFixed(0),
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
