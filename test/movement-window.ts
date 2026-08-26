import type { TrackPoint } from '../src/core/model.ts'
import { derivePointSpeeds, detectMovementWindow } from '../src/core/quality/movementWindow.ts'
import { DEFAULT_TRACK_HEALTH_CONFIG } from '../src/core/quality/trackHealthConfig.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const config = DEFAULT_TRACK_HEALTH_CONFIG.movementWindow
const START = 1_700_000_000_000

/** `moving` marks which samples carry an under-way ground speed. */
function track(moving: (index: number) => boolean, count = 60, withTime = true): TrackPoint[] {
  const points: TrackPoint[] = []
  for (let index = 0; index < count; index++) {
    points.push({
      lat: 40 + index * 0.001,
      lon: -100,
      ...(withTime ? { time: START + index * 1000 } : {}),
      ext: { ground_speed_mps: moving(index) ? 150 : 0 },
    })
  }
  return points
}

const parked = track((index) => index >= 20 && index <= 40)
const window = detectMovementWindow(parked, config)
check('Trims a parked prefix', window?.startIndex === 20)
check('Trims a parked suffix', window?.endIndex === 40)

const throughout = detectMovementWindow(track(() => true), config)
check('Covers the whole track when always under way', throughout?.startIndex === 0 && throughout?.endIndex === 59)

const stationary = detectMovementWindow(track(() => false), config)
check('Falls back to the whole track when nothing ever moves', stationary?.startIndex === 0 && stationary?.endIndex === 59)

check('Returns null without timestamps', detectMovementWindow(track(() => true, 60, false), config) === null)
check('Returns null for an empty track', detectMovementWindow([], config) === null)

// A single fast sample surrounded by stationary ones must not open the window.
const blip = track((index) => index === 30)
const blipWindow = detectMovementWindow(blip, config)
check('Ignores an isolated speed blip below the sustained-sample requirement', blipWindow?.startIndex === 0)

// Speed precedence and derivation.
const recorded = derivePointSpeeds([
  { lat: 0, lon: 0, time: START, ext: { ground_speed_mps: 12, speed_mps: 99 } },
  { lat: 0, lon: 0, time: START + 1000, ext: { speed_mps: 34 } },
])
check('Prefers ground_speed_mps over speed_mps', recorded[0] === 12)
check('Falls back to speed_mps', recorded[1] === 34)

// 0.001 degrees of latitude is ~111 m; over one second that is ~111 m/s.
const derived = derivePointSpeeds([
  { lat: 40, lon: -100, time: START },
  { lat: 40.001, lon: -100, time: START + 1000 },
])
check('Derives speed from distance over time when no channel is present', (derived[1] ?? 0) > 100 && (derived[1] ?? 0) < 120)

const zeroInterval = derivePointSpeeds([
  { lat: 40, lon: -100, time: START },
  { lat: 40.001, lon: -100, time: START },
])
check('Leaves speed undefined across a zero-length interval', zeroInterval[1] === undefined)

console.log(`\n${failures === 0 ? 'ALL MOVEMENT WINDOW CHECKS PASSED' : `${failures} MOVEMENT WINDOW CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
