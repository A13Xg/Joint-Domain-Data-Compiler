import {
  METERS_PER_FOOT,
  METERS_PER_NAUTICAL_MILE,
  METERS_PER_SECOND_PER_KNOT,
  UNIT_SYSTEM_IDS,
  UNIT_SYSTEM_LABELS,
  convertDistance,
  convertSpeed,
  distanceUnitLabel,
  formatAltitude,
  formatDistance,
  formatSpeed,
  speedUnitLabel,
  toFeet,
  toKnots,
  toNauticalMiles,
} from '../src/core/units.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// --- the definitions themselves ---------------------------------------------
// Both the foot and the nautical mile are exact by definition, so these are
// equalities, not tolerances. If one of these ever drifts, every readout in the
// nautical system is silently wrong by that amount.
check('a foot is exactly 0.3048 m', METERS_PER_FOOT === 0.3048)
check('a nautical mile is exactly 1852 m', METERS_PER_NAUTICAL_MILE === 1852)
check('a knot is one nautical mile per hour', METERS_PER_SECOND_PER_KNOT === 1852 / 3600)
check('the knot factor matches the conventional rounded value', Math.abs(1 / METERS_PER_SECOND_PER_KNOT - 1.94384) < 1e-5)
check('the foot factor matches the conventional rounded value', Math.abs(1 / METERS_PER_FOOT - 3.28084) < 1e-5)

check('one nautical mile converts to exactly one', toNauticalMiles(1852) === 1)
check('one foot converts to exactly one', toFeet(0.3048) === 1)
check('one knot converts to exactly one', Math.abs(toKnots(1852 / 3600) - 1) < 1e-12)
check('a thousand feet round-trips', Math.abs(toFeet(1000 * METERS_PER_FOOT) - 1000) < 1e-9)

// --- unit system inventory ---------------------------------------------------
check('both unit systems are offered', UNIT_SYSTEM_IDS.length === 2 && UNIT_SYSTEM_IDS.includes('metric') && UNIT_SYSTEM_IDS.includes('nautical'))
check('every unit system has a label', UNIT_SYSTEM_IDS.every((id) => UNIT_SYSTEM_LABELS[id].length > 0))
check('metric labels distance in metres', distanceUnitLabel('metric') === 'm')
check('nautical labels distance in feet', distanceUnitLabel('nautical') === 'ft')
check('metric labels speed in m/s', speedUnitLabel('metric') === 'm/s')
check('nautical labels speed in knots', speedUnitLabel('nautical') === 'kn')

// --- bare-number conversion (table cells that carry the unit in the header) ---
check('metric distance conversion is the identity', convertDistance(1234.5, 'metric') === 1234.5)
check('nautical distance conversion yields feet', Math.abs(convertDistance(100, 'nautical') - 328.0839895) < 1e-6)
check('metric speed conversion is the identity', convertSpeed(58.2, 'metric') === 58.2)
check('nautical speed conversion yields knots', Math.abs(convertSpeed(100, 'nautical') - 194.384449) < 1e-5)
check('a negative separation converts with its sign intact', convertDistance(-100, 'nautical') < 0)

// --- formatDistance: metric ---------------------------------------------------
check('metric renders sub-km values in metres', formatDistance(500, 'metric') === '500.0 m')
check('metric renders km-scale values in kilometres', formatDistance(1500, 'metric') === '1.50 km')
check('metric switches unit exactly at the km boundary', formatDistance(1000, 'metric') === '1.00 km')
check('metric stays in metres one metre below the boundary', formatDistance(999, 'metric') === '999.0 m')
check('metric groups thousands past a thousand km', formatDistance(2_000_000, 'metric') === '2,000.00 km')

// --- formatDistance: nautical --------------------------------------------------
check('nautical renders short distances in feet', formatDistance(100, 'nautical') === '328.1 ft')
check('nautical switches unit exactly at one nautical mile', formatDistance(1852, 'nautical') === '1.00 NM')
check('nautical stays in feet just below one nautical mile', formatDistance(1851, 'nautical').endsWith(' ft'))
check('nautical renders multi-mile distances in NM', formatDistance(18_520, 'nautical') === '10.00 NM')
check('nautical groups thousands of feet', formatDistance(500, 'nautical') === '1,640.4 ft')

// The magnitude decides the unit, so a signed separation reads the same either
// side of zero rather than flipping to metres only when it goes negative.
check('a large negative distance still switches unit (metric)', formatDistance(-1500, 'metric') === '-1.50 km')
check('a large negative distance still switches unit (nautical)', formatDistance(-1852, 'nautical') === '-1.00 NM')

// --- formatAltitude: never switches unit ----------------------------------------
check('metric altitude stays in metres at any magnitude', formatAltitude(12_000, 'metric') === '12,000 m')
check('nautical altitude stays in feet at any magnitude', formatAltitude(12_000, 'nautical') === '39,370 ft')
check('altitude honours a requested precision', formatAltitude(120.456, 'metric', 2) === '120.46 m')
check('altitude defaults to whole units', formatAltitude(120.456, 'metric') === '120 m')
check('a negative vertical separation keeps its sign', formatAltitude(-50, 'metric', 1) === '-50 m')
// The precision argument is a ceiling: a round value must not grow trailing
// zeros, which is what the Point Inspector's elevation field relies on.
check('altitude precision is a ceiling, not a fixed width', formatAltitude(300, 'metric', 3) === '300 m')
check('altitude keeps digits it actually needs', formatAltitude(300.5, 'metric', 3) === '300.5 m')

// --- formatSpeed ------------------------------------------------------------------
check('metric speed renders m/s', formatSpeed(58.2, 'metric') === '58.2 m/s')
check('nautical speed renders knots', formatSpeed(58.2, 'nautical') === '113.1 kn')
check('speed honours a requested precision', formatSpeed(58.234, 'metric', 2) === '58.23 m/s')
check('speed precision is a ceiling, not a fixed width', formatSpeed(58, 'metric') === '58 m/s')
check('a stationary sample is zero, not blank', formatSpeed(0, 'metric') === '0 m/s')

// --- non-finite input -------------------------------------------------------------
// Every one of these is reachable: a track with one point has no speed, and a
// zero-length interval divides by zero. An em dash is the app's existing
// "no value" convention (formatDuration already uses it) and is never mistaken
// for a measurement the way "NaN m" or "Infinity kn" would be.
check('NaN distance renders as an em dash', formatDistance(NaN, 'metric') === '—')
check('Infinite distance renders as an em dash', formatDistance(Infinity, 'nautical') === '—')
check('NaN altitude renders as an em dash', formatAltitude(NaN, 'metric') === '—')
check('NaN speed renders as an em dash', formatSpeed(NaN, 'nautical') === '—')
check('Infinite speed renders as an em dash', formatSpeed(Infinity, 'metric') === '—')

console.log(`\n${failures === 0 ? 'ALL UNIT CHECKS PASSED' : `${failures} UNIT CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
