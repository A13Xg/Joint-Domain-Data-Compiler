// VTG (course/speed over ground) and ZDA (date/time) sentence support.
// Neither carries a position of its own — this exercises how their values
// ride along on the next GGA/GLL fix, and how ZDA feeds the same date-pairing
// GGA/GLL/RMC already share, using inline synthetic sentences (checksummed
// programmatically) rather than a fixture file.
import { parseNmea } from '../src/core/parsers/nmea.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function checksum(body: string): string {
  let cs = 0
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i)
  return cs.toString(16).toUpperCase().padStart(2, '0')
}

/** `body` excludes the leading `$` and trailing checksum, matching the parser's own split. */
function sentence(body: string): string {
  return `$${body}*${checksum(body)}`
}

const gga = (time: string) => sentence(`GPGGA,${time},4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,`)
const vtg = (courseDeg: string, speedKnots: string) => sentence(`GPVTG,${courseDeg},T,,M,${speedKnots},N,,K`)
const zda = (time: string, day: string, month: string, year: string) => sentence(`GPZDA,${time},${day},${month},${year},00,00`)
const rmc = (time: string, date: string, speedKnots: string, courseDeg: string) =>
  sentence(`GPRMC,${time},A,4807.038,N,01131.000,E,${speedKnots},${courseDeg},${date},,`)

const KNOTS_TO_MPS = 0.514444

// --- VTG rides along on the next GGA that has no course/speed of its own ---
{
  const before = parseNmea([gga('120000.00')].join('\n'))
  check('a GGA fix before any VTG/RMC has no speed_mps channel', before.points[0]?.ext?.speed_mps === undefined)
  check('a GGA fix before any VTG/RMC has no heading_deg channel', before.points[0]?.ext?.heading_deg === undefined)

  const withVtg = parseNmea([vtg('123.4', '10.0'), gga('120001.00')].join('\n'))
  check('parses two points worth of sentences into one fix', withVtg.points.length === 1)
  const fix = withVtg.points[0]!
  check('GGA after VTG carries the VTG heading', fix.ext?.heading_deg === 123.4, `${fix.ext?.heading_deg}`)
  check('GGA after VTG carries the VTG speed, converted from knots', Math.abs((fix.ext?.speed_mps as number) - 10.0 * KNOTS_TO_MPS) < 1e-6, `${fix.ext?.speed_mps}`)
  check('speed_mps is reported in the channel list', withVtg.channels.includes('speed_mps'))
  check('heading_deg is reported in the channel list', withVtg.channels.includes('heading_deg'))
}

// --- VTG's value persists across multiple later fixes until a newer VTG replaces it ---
{
  const result = parseNmea([vtg('90.0', '5.0'), gga('120000.00'), gga('120001.00'), vtg('180.0', '15.0'), gga('120002.00')].join('\n'))
  check('parses three GGA fixes', result.points.length === 3)
  check('the first two fixes carry the first VTG reading', result.points[0]!.ext?.heading_deg === 90.0 && result.points[1]!.ext?.heading_deg === 90.0)
  check('the third fix carries the updated VTG reading', result.points[2]!.ext?.heading_deg === 180.0)
}

// --- ZDA feeds the same date used to pair a GGA/GLL time-of-day into a timestamp ---
{
  const withoutDate = parseNmea([gga('120000.00')].join('\n'))
  check('a GGA fix with no RMC or ZDA date ever seen has no timestamp', withoutDate.points[0]?.time === undefined)

  const withZda = parseNmea([zda('115959.00', '15', '03', '2024'), gga('120000.00')].join('\n'))
  const fix = withZda.points[0]!
  check('GGA after ZDA gets a timestamp built from ZDA\'s date', typeof fix.time === 'number')
  const iso = fix.time !== undefined ? new Date(fix.time).toISOString() : ''
  check('the timestamp uses ZDA\'s 4-digit year and date, and GGA\'s own time-of-day', iso.startsWith('2024-03-15T12:00:00'), iso)
}

// --- RMC's own speed/heading is used for its own point, but is NOT propagated onto a
// later GGA fix — a GGA reporting a speed it never measured, attributed to a different
// timestamp, would be a misattribution. Only VTG (which produces no point of its own)
// rides along onto GGA/GLL. ---
{
  const result = parseNmea([rmc('120000.00', '150324', '20.0', '270.0'), gga('120001.00')].join('\n'))
  check('parses one RMC point and one GGA point', result.points.length === 2)
  const rmcPoint = result.points[0]!
  check('the RMC point carries its own speed/heading', rmcPoint.ext?.heading_deg === 270.0 && Math.abs((rmcPoint.ext?.speed_mps as number) - 20.0 * KNOTS_TO_MPS) < 1e-6)
  const ggaPoint = result.points[1]!
  check('a GGA fix after RMC (no VTG) does NOT inherit RMC\'s course/speed', ggaPoint.ext?.heading_deg === undefined && ggaPoint.ext?.speed_mps === undefined)
  check('RMC\'s 2-digit-year date still pairs correctly with a later GGA\'s time', typeof ggaPoint.time === 'number')
}

// --- a VTG reading is unaffected by an intervening RMC that carries its own, different speed/heading ---
{
  const result = parseNmea([vtg('90.0', '5.0'), rmc('120000.00', '150324', '20.0', '270.0'), gga('120001.00')].join('\n'))
  const ggaPoint = result.points[1]!
  check('GGA after VTG-then-RMC still carries the VTG reading, not RMC\'s', ggaPoint.ext?.heading_deg === 90.0, `${ggaPoint.ext?.heading_deg}`)
}

// --- malformed ZDA fields don't silently produce a bogus date that times every later fix ---
{
  const badMonth = parseNmea([zda('120000.00', '15', '99', '2024'), gga('120001.00')].join('\n'))
  check('ZDA with an out-of-range month is rejected, later GGA gets no timestamp', badMonth.points[0]?.time === undefined)

  const zeroYear = parseNmea([zda('120000.00', '15', '03', '0'), gga('120001.00')].join('\n'))
  check('ZDA with year 0 is rejected, later GGA gets no timestamp', zeroYear.points[0]?.time === undefined)
}

// --- neither VTG nor ZDA produces a point on its own ---
check('a VTG-only stream yields zero points', parseNmea(vtg('90', '5')).points.length === 0)
check('a ZDA-only stream yields zero points', parseNmea(zda('120000.00', '01', '01', '2024')).points.length === 0)

console.log(`\n${failures === 0 ? 'ALL NMEA VTG/ZDA CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
