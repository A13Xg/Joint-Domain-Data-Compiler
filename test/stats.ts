import { computeStats, formatDistance, formatDuration } from '../src/core/stats.ts'
import type { Dataset, TrackPoint } from '../src/core/model.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function dataset(points: TrackPoint[], channels: string[] = []): Dataset {
  return { id: 'fixture', name: 'fixture', sourceFormat: 'csv', points, warnings: [], channels, createdAt: 0 }
}

// --- basic counts: valid/invalid coordinates, elevation/time/name presence ---
{
  const points: TrackPoint[] = [
    { lat: 40, lon: -105, ele: 100, time: 0, name: 'start' },
    { lat: 999, lon: -105, ele: 110, time: 1000 }, // invalid lat
    { lat: 40.001, lon: 999, ele: 120, time: 2000 }, // invalid lon
    { lat: 40.002, lon: -105.002, time: 3000 }, // no elevation
    { lat: 40.003, lon: -105.003, ele: 130 }, // no time
  ]
  const stats = computeStats(dataset(points))
  check('counts total points', stats.pointCount === 5)
  check('counts valid coordinates', stats.validCoordCount === 3, `${stats.validCoordCount}`)
  check('counts invalid coordinates', stats.invalidCoordCount === 2, `${stats.invalidCoordCount}`)
  check('counts points with elevation', stats.withElevation === 4, `${stats.withElevation}`)
  check('counts points with time', stats.withTime === 4, `${stats.withTime}`)
  check('counts points with a name', stats.withName === 1, `${stats.withName}`)
}

// --- elevation gain/loss/min/max: climb then descend ---
{
  const points: TrackPoint[] = [
    { lat: 40, lon: -105, ele: 100, time: 0 },
    { lat: 40, lon: -105, ele: 150, time: 1000 }, // +50 gain
    { lat: 40, lon: -105, ele: 120, time: 2000 }, // -30 loss
    { lat: 40, lon: -105, ele: 180, time: 3000 }, // +60 gain
  ]
  const stats = computeStats(dataset(points))
  check('elevation min is the lowest sample', stats.elevation?.min === 100)
  check('elevation max is the highest sample', stats.elevation?.max === 180)
  check('elevation gain sums only upward deltas', stats.elevation?.gain === 110, `${stats.elevation?.gain}`)
  check('elevation loss sums only downward deltas', stats.elevation?.loss === 30, `${stats.elevation?.loss}`)
}
check('elevation is null when no point carries it', computeStats(dataset([{ lat: 0, lon: 0, time: 0 }])).elevation === null)

// --- time monotonicity ---
{
  const outOfOrder: TrackPoint[] = [
    { lat: 40, lon: -105, time: 2000 },
    { lat: 40.001, lon: -105.001, time: 1000 }, // backward
  ]
  check('a backward timestamp is detected as non-monotonic', computeStats(dataset(outOfOrder)).timeMonotonic === false)
  const inOrder: TrackPoint[] = [
    { lat: 40, lon: -105, time: 1000 },
    { lat: 40.001, lon: -105.001, time: 2000 },
  ]
  check('strictly increasing timestamps are monotonic', computeStats(dataset(inOrder)).timeMonotonic === true)
  check('a single point is trivially monotonic', computeStats(dataset([{ lat: 0, lon: 0, time: 0 }])).timeMonotonic === true)
}

// --- duplicate coordinates (zero-distance consecutive valid points) ---
{
  const points: TrackPoint[] = [
    { lat: 40, lon: -105 },
    { lat: 40, lon: -105 }, // exact duplicate
    { lat: 40.001, lon: -105.001 },
  ]
  check('an exact-duplicate consecutive coordinate is counted', computeStats(dataset(points)).duplicateCoords === 1)
}

// --- distance/speed: two points 1 second apart, ~111m north (1 degree lat ~= 111.2km) ---
{
  const points: TrackPoint[] = [
    { lat: 40, lon: -105, time: 0 },
    { lat: 40.001, lon: -105, time: 1000 },
    { lat: 40.002, lon: -105, time: 2000 },
  ]
  const stats = computeStats(dataset(points))
  check('distance accumulates across valid consecutive points', stats.distanceMeters > 200 && stats.distanceMeters < 250, `${stats.distanceMeters}`)
  check('speed stats are derived when time and position both advance', stats.speed !== null)
  check('mean speed is between the min and max', stats.speed !== null && stats.speed.meanMps >= stats.speed.minMps && stats.speed.meanMps <= stats.speed.maxMps)
  check('sample rate is derived from timed point count and span', stats.sampleRateHz !== null && Math.abs(stats.sampleRateHz - 1) < 1e-6, `${stats.sampleRateHz}`)
}
check('speed is null when no consecutive pair has both time and valid coordinates', computeStats(dataset([{ lat: 40, lon: -105 }, { lat: 40.001, lon: -105.001 }])).speed === null)
check('a zero or negative time delta contributes no speed sample', computeStats(dataset([
  { lat: 40, lon: -105, time: 1000 },
  { lat: 40.001, lon: -105.001, time: 1000 }, // same timestamp
])).speed === null)

// --- channel stats: numeric coercion, min/max/mean/stddev, unit inference ---
{
  const points: TrackPoint[] = [
    { lat: 0, lon: 0, ext: { speed_mps: 10, heading_deg: 90, note: 'ok' } },
    { lat: 0, lon: 0, ext: { speed_mps: 20, heading_deg: 180 } },
    { lat: 0, lon: 0, ext: { speed_mps: '30' as unknown as number } }, // string-coercible
    { lat: 0, lon: 0, ext: { speed_mps: 'bad' as unknown as number } }, // not coercible
    { lat: 0, lon: 0 }, // missing entirely
  ]
  const stats = computeStats(dataset(points, ['speed_mps', 'heading_deg', 'note']))
  const speed = stats.channels.find((c) => c.key === 'speed_mps')!
  check('channel count includes every point that carries the key, coercible or not', speed.count === 4, `${speed.count}`)
  check('channel numericCount excludes the non-coercible value', speed.numericCount === 3, `${speed.numericCount}`)
  check('a numeric string is coerced for min/max/mean', speed.max === 30 && speed.min === 10, `min ${speed.min} max ${speed.max}`)
  check('mean is the average of only the numeric values', Math.abs(speed.mean! - 20) < 1e-9, `${speed.mean}`)
  check('stddev is null for fewer than two numeric samples', computeStats(dataset([{ lat: 0, lon: 0, ext: { speed_mps: 1 } }], ['speed_mps'])).channels[0]!.stddev === null)
  check('stddev is positive for a spread of values', speed.stddev !== null && speed.stddev > 0, `${speed.stddev}`)
  check('speed_mps infers an m/s unit', speed.unit === 'm/s')
  const heading = stats.channels.find((c) => c.key === 'heading_deg')!
  check('heading_deg infers a degree unit', heading.unit === '°')
  const note = stats.channels.find((c) => c.key === 'note')!
  check('a non-numeric channel has zero numericCount but a nonzero count', note.count === 1 && note.numericCount === 0)
  check('an unrecognized channel name infers no unit', note.unit === undefined)
}
check('a dataset with no declared channels reports an empty channel list', computeStats(dataset([{ lat: 0, lon: 0 }], [])).channels.length === 0)

// --- formatDuration / formatDistance ---
check('formatDuration renders HH:MM:SS', formatDuration(3661_000) === '01:01:01')
check('formatDuration renders zero as 00:00:00', formatDuration(0) === '00:00:00')
check('formatDuration renders null as an em dash', formatDuration(null) === '—')
check('formatDuration renders NaN as an em dash', formatDuration(NaN) === '—')
check('formatDistance renders sub-km values in metres', formatDistance(500) === '500.0 m')
check('formatDistance renders km-scale values in kilometres', formatDistance(1500) === '1.50 km')
check('formatDistance is exactly at the km boundary', formatDistance(1000) === '1.00 km')

console.log(`\n${failures === 0 ? 'ALL STATS CHECKS PASSED' : `${failures} STATS CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
