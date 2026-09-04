// Generates the synthetic demo flight used by the user guide's screenshots.
//
// Synthetic on purpose. The guide's screenshots are committed to a public repo
// and packaged inside every release binary, so they cannot be shot against real
// recorded telemetry. This produces a track that still exercises every view
// honestly: positions are integrated from a heading/speed profile rather than
// drawn as a shape, so derived kinematics, the Track Health altitude and speed
// envelope checks, and the turn-rate ceilings all see a physically consistent
// flight instead of a curve that merely looks like one.
//
// Deterministic: no randomness anywhere, so a regenerated fixture is
// byte-identical and a screenshot re-run produces the same pictures.
//
// Usage: node scripts/generate-demo-flight.mjs

import { writeFileSync } from 'node:fs'

const START_EPOCH_MS = Date.parse('2026-06-09T16:00:00.000Z')
const HZ = 1
const DURATION_S = 600
// Round-number origin, near the locale the existing comparison fixtures use.
// Field elevation is deliberately below the Track Health altitude floor
// (304.8 m / 1000 ft) so the track can climb through it and descend back below
// it, which is what that check looks for in a complete flight.
const ORIGIN_LAT = 38.9
const ORIGIN_LON = -77.0
const FIELD_ELEVATION_M = 20
const EARTH_RADIUS_M = 6_371_008.8

/**
 * The flight, as a piecewise profile of commanded airspeed, vertical speed, and
 * turn rate. Turn rates stay well inside the Aircraft motion profile's ceiling
 * and the climb/descent gradients stay inside its vertical-speed ceiling, so a
 * scan of this track reports a clean profile rather than flagging the fixture
 * itself.
 */
const PHASES = [
  { until: 40, label: 'takeoff', speedMps: 75, verticalMps: 12, turnDegPerS: 0 },
  { until: 120, label: 'climb', speedMps: 110, verticalMps: 14, turnDegPerS: 1.5 },
  { until: 180, label: 'cruise', speedMps: 130, verticalMps: 0, turnDegPerS: 0 },
  { until: 240, label: 'turn-1', speedMps: 125, verticalMps: 0, turnDegPerS: 3 },
  { until: 300, label: 'cruise', speedMps: 130, verticalMps: 0, turnDegPerS: 0 },
  { until: 360, label: 'turn-2', speedMps: 125, verticalMps: 2, turnDegPerS: -3 },
  { until: 480, label: 'descent', speedMps: 115, verticalMps: -9, turnDegPerS: 1.2 },
  { until: 560, label: 'approach', speedMps: 90, verticalMps: -7, turnDegPerS: 0 },
  { until: DURATION_S, label: 'landing', speedMps: 70, verticalMps: -1.5, turnDegPerS: 0 },
]

function phaseAt(second) {
  return PHASES.find((phase) => second < phase.until) ?? PHASES[PHASES.length - 1]
}

/**
 * Airframes roll and pitch into a change over seconds, not instantly. Stepping
 * the commanded profile at a phase boundary puts a genuine discontinuity into
 * the integrated path, which the outlier detector then flags -- correctly, but
 * it would make the fixture look defective in the very screenshots meant to
 * show a healthy track. A centred moving average over the commanded series
 * models the roll-in/roll-out instead of papering over the artefact.
 */
const SMOOTHING_HALF_WIDTH = 12

function smooth(series) {
  return series.map((_, index) => {
    let total = 0
    let count = 0
    for (let offset = -SMOOTHING_HALF_WIDTH; offset <= SMOOTHING_HALF_WIDTH; offset++) {
      const sample = series[Math.min(series.length - 1, Math.max(0, index + offset))]
      total += sample
      count++
    }
    return total / count
  })
}

/** Bank angle implied by a coordinated turn at this speed and turn rate. */
function bankDegrees(speedMps, turnDegPerS) {
  const rateRad = (turnDegPerS * Math.PI) / 180
  return (Math.atan((speedMps * rateRad) / 9.80665) * 180) / Math.PI
}

function buildTrack({ headingOffsetDeg = 0, lateralOffsetM = 0, timeOffsetMs = 0 } = {}) {
  const rows = []
  let lat = ORIGIN_LAT
  let lon = ORIGIN_LON
  let ele = FIELD_ELEVATION_M
  let heading = 45 + headingOffsetDeg
  const step = 1 / HZ
  const count = DURATION_S * HZ + 1

  const seconds = Array.from({ length: count }, (_, index) => index * step)
  const speeds = smooth(seconds.map((second) => phaseAt(second).speedMps))
  const verticals = smooth(seconds.map((second) => phaseAt(second).verticalMps))
  const turns = smooth(seconds.map((second) => phaseAt(second).turnDegPerS))

  for (let index = 0; index < count; index++) {
    const second = seconds[index]
    const phase = phaseAt(second)
    const speed = speeds[index]
    const turn = turns[index]
    const vertical = verticals[index]

    // Offset the companion track perpendicular to its own heading, so the two
    // stay a constant distance apart through the turns instead of crossing.
    const perpendicular = ((heading + 90) * Math.PI) / 180
    const offsetNorth = (lateralOffsetM * Math.cos(perpendicular)) / EARTH_RADIUS_M
    const offsetEast = (lateralOffsetM * Math.sin(perpendicular)) / (EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180))

    rows.push({
      timeMs: START_EPOCH_MS + second * 1000 + timeOffsetMs,
      lat: lat + (offsetNorth * 180) / Math.PI,
      lon: lon + (offsetEast * 180) / Math.PI,
      ele,
      speed,
      heading: ((heading % 360) + 360) % 360,
      bank: bankDegrees(speed, turn),
      phase: phase.label,
    })

    // Integrate forward: great-circle displacement along the current heading.
    const headingRad = (heading * Math.PI) / 180
    const distance = speed * step
    const deltaNorth = (distance * Math.cos(headingRad)) / EARTH_RADIUS_M
    const deltaEast = (distance * Math.sin(headingRad)) / (EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180))
    lat += (deltaNorth * 180) / Math.PI
    lon += (deltaEast * 180) / Math.PI
    ele = Math.max(FIELD_ELEVATION_M, ele + vertical * step)
    heading += turn * step
  }
  return rows
}

/**
 * HDOP and satellite count vary smoothly with bank angle: a banked airframe
 * masks part of the sky. Gives the GPS fix-quality check real data to report
 * without ever crossing its thresholds, so the guide can show that check
 * populated rather than "not applicable".
 */
function fixQuality(bankDeg) {
  const masking = Math.min(1, Math.abs(bankDeg) / 30)
  return { hdop: 0.8 + masking * 0.9, sat: Math.round(12 - masking * 3) }
}

function toCsv(rows) {
  const header = 'time,latitude,longitude,altitude_m,ground_speed_mps,true_heading_deg,bank_deg,hdop,sat,phase'
  const lines = rows.map((row) => {
    const { hdop, sat } = fixQuality(row.bank)
    return [
      new Date(row.timeMs).toISOString(),
      row.lat.toFixed(7),
      row.lon.toFixed(7),
      row.ele.toFixed(1),
      row.speed.toFixed(2),
      row.heading.toFixed(2),
      row.bank.toFixed(2),
      hdop.toFixed(2),
      String(sat),
      row.phase,
    ].join(',')
  })
  return [header, ...lines].join('\n') + '\n'
}

const lead = buildTrack()
// The companion sits 400 m abeam and two seconds in trail — close enough that
// the Compare tab's defaults align it, far enough that the ranges are legible.
const wing = buildTrack({ lateralOffsetM: 400, timeOffsetMs: 2000, headingOffsetDeg: 0 })

writeFileSync('test/fixtures/demo-flight-a.csv', toCsv(lead))
writeFileSync('test/fixtures/demo-flight-b.csv', toCsv(wing))
console.log(`demo-flight-a.csv: ${lead.length} points`)
console.log(`demo-flight-b.csv: ${wing.length} points`)
