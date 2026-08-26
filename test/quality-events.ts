import type { TrackPoint } from '../src/core/model.ts'
import {
  DEFAULT_QUALITY_EVENT_CONFIG,
  detectQualityEvents,
  eventSourceIndices,
  eventsOverlappingIndexRange,
  eventsOverlappingTimeRange,
  sortQualityEvents,
} from '../src/core/quality/events.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const points: TrackPoint[] = [
  { lat: 0, lon: 0, time: 0 },
  { lat: 0, lon: 0.0001, time: 1_000 },
  { lat: 0, lon: 0.0002, time: 1_000 },
  { lat: 0, lon: 0.0003, time: 12_000 },
  { lat: 50, lon: 50, time: 13_000 },
  { lat: 91, lon: 0, time: 14_000 },
]

const events = detectQualityEvents(points, { ...DEFAULT_QUALITY_EVENT_CONFIG, gapMs: 5_000, coordinateJumpMeters: 10_000 })

check('Detects duplicate timestamps at the affected point', events.some((event) => event.kind === 'duplicate-timestamp' && event.startIndex === 2 && event.endIndex === 2))
check('Detects a timestamp gap spanning the adjacent points', events.some((event) => event.kind === 'gap' && event.startIndex === 2 && event.endIndex === 3 && event.measurements?.durationMs === 11_000))
check('Detects an implausible coordinate jump', events.some((event) => event.kind === 'coordinate-jump' && event.startIndex === 3 && event.endIndex === 4 && (event.measurements?.distanceMeters ?? 0) > 1_000_000))
check('Detects invalid coordinates without crashing later checks', events.some((event) => event.kind === 'invalid-coordinate' && event.startIndex === 5 && event.endIndex === 5))
check('Leaves untimed points free of time-derived events', detectQualityEvents([{ lat: 0, lon: 0 }, { lat: 0, lon: 0.1 }]).length === 0)

const selected = eventsOverlappingIndexRange(events, { start: 2, end: 3 })
check('Selects events overlapping inclusive index ranges', selected.some((event) => event.kind === 'duplicate-timestamp') && selected.some((event) => event.kind === 'gap'))
check('Selects events overlapping inclusive time ranges', eventsOverlappingTimeRange(events, { startMs: 1_000, endMs: 12_000 }).some((event) => event.kind === 'gap'))
check('Maps event spans to all source indices', [...eventSourceIndices(selected)].join(',') === '2,3,4')
check('Sorts events deterministically by source index and severity', sortQualityEvents([...events].reverse())[0]?.startIndex === 2)

let invalidConfigRejected = false
try { detectQualityEvents(points, { ...DEFAULT_QUALITY_EVENT_CONFIG, gapMs: 0 }) } catch { invalidConfigRejected = true }
check('Rejects invalid thresholds', invalidConfigRejected)
check('Treats a dateline crossing as local movement', !detectQualityEvents([{ lat: 0, lon: 179.999, time: 0 }, { lat: 0, lon: -179.999, time: 1_000 }], { ...DEFAULT_QUALITY_EVENT_CONFIG, coordinateJumpMeters: 1_000 }).some((event) => event.kind === 'coordinate-jump'))

// --- Elevation spike (Task 4.1) ---------------------------------------------
{
  const spikeTrack: TrackPoint[] = [100, 101, 100, 500, 99, 100, 100].map((ele, i) => ({ lat: i * 0.001, lon: 0, ele, time: i * 1000 }))
  const spikeEvents = detectQualityEvents(spikeTrack, { ...DEFAULT_QUALITY_EVENT_CONFIG, elevationSpikeMeters: 100 })
  check('Detects a single-sample elevation spike', spikeEvents.some((event) => event.kind === 'elevation-spike' && event.startIndex === 3))
  check('Does not flag a gradual climb as a spike', !spikeEvents.some((event) => event.kind === 'elevation-spike' && event.startIndex === 1))
}
{
  const climbTrack: TrackPoint[] = [100, 200, 300, 400].map((ele, i) => ({ lat: i * 0.001, lon: 0, ele, time: i * 1000 }))
  check('A sustained climb (no reversal) is never flagged as a spike', !detectQualityEvents(climbTrack, { ...DEFAULT_QUALITY_EVENT_CONFIG, elevationSpikeMeters: 50 }).some((event) => event.kind === 'elevation-spike'))
}

// --- Elevation flatline (Task 4.1) ------------------------------------------
{
  const flatlineTrack: TrackPoint[] = [100, 101, 102, 250, 250, 250, 250, 250, 103, 104].map((ele, i) => ({ lat: i * 0.001, lon: 0, ele, time: i * 1000 }))
  const flatlineEvents = detectQualityEvents(flatlineTrack, { ...DEFAULT_QUALITY_EVENT_CONFIG, flatlineMinRun: 5 })
  const flatline = flatlineEvents.find((event) => event.kind === 'elevation-flatline')
  check('Detects a run of identical elevation values', flatline !== undefined && flatline.startIndex === 3 && flatline.endIndex === 7)
  check('Flatline records the frozen value and run length', flatline?.measurements?.value === 250 && flatline?.measurements?.runLength === 5)
}
{
  const shortRun: TrackPoint[] = [100, 101, 102, 102, 103].map((ele, i) => ({ lat: i * 0.001, lon: 0, ele, time: i * 1000 }))
  check('A short repeat below the minimum run is not flagged', !detectQualityEvents(shortRun, { ...DEFAULT_QUALITY_EVENT_CONFIG, flatlineMinRun: 5 }).some((event) => event.kind === 'elevation-flatline'))
}
{
  const trailingFlatline: TrackPoint[] = [100, 101, 100, 100, 100, 100, 100].map((ele, i) => ({ lat: i * 0.001, lon: 0, ele, time: i * 1000 }))
  const events2 = detectQualityEvents(trailingFlatline, { ...DEFAULT_QUALITY_EVENT_CONFIG, flatlineMinRun: 5 })
  check('A flatline running to the end of the track is still closed and flagged', events2.some((event) => event.kind === 'elevation-flatline' && event.endIndex === 6))
}

console.log(`\n${failures === 0 ? 'ALL QUALITY EVENT CHECKS PASSED' : `${failures} QUALITY EVENT CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
