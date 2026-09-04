// GSA (DOP + active satellites) and GSV (satellites in view) sentence support.
// Neither carries a position of its own — this exercises how their values ride along on
// the next GGA/GLL fix, the HDOP fallback-only precedence rule (a fix's own HDOP always
// wins over GSA's), and that GSV's "satellites in view" never collides with GGA's
// "satellites used in the fix" (`sat`) — the exact class of silent-overwrite bug that
// motivated keeping them on separate channel keys.
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

function sentence(body: string): string {
  return `$${body}*${checksum(body)}`
}

const gga = (time: string, sats: string, hdop: string) =>
  sentence(`GPGGA,${time},4807.038,N,01131.000,E,1,${sats},${hdop},545.4,M,46.9,M,,`)
const gll = (time: string) => sentence(`GPGLL,4807.038,N,01131.000,E,${time},A,A`)
const gsa = (pdop: string, hdop: string, vdop: string) =>
  sentence(`GPGSA,A,3,04,05,,09,12,,,24,,,,,${pdop},${hdop},${vdop}`)
const gsv = (satsInView: string) => sentence(`GPGSV,1,1,${satsInView},03,03,111,00`)

// --- GSA's PDOP/VDOP ride along onto the next GGA fix; HDOP only fills in when GGA's own is blank ---
{
  const result = parseNmea([gsa('2.5', '1.3', '2.1'), gga('120000.00', '08', '0.9')].join('\n'))
  const fix = result.points[0]!
  check('GGA keeps its own HDOP over GSA\'s', fix.ext?.hdop === 0.9, `${fix.ext?.hdop}`)
  check('GGA gains GSA\'s PDOP', fix.ext?.pdop === 2.5, `${fix.ext?.pdop}`)
  check('GGA gains GSA\'s VDOP', fix.ext?.vdop === 2.1, `${fix.ext?.vdop}`)
  check('pdop is reported in the channel list', result.channels.includes('pdop'))
  check('vdop is reported in the channel list', result.channels.includes('vdop'))
}

// --- GSA's HDOP fills in only when the fix's own field is blank ---
{
  const result = parseNmea([gsa('2.5', '1.3', '2.1'), gga('120000.00', '08', '')].join('\n'))
  const fix = result.points[0]!
  check('GGA with a blank HDOP field falls back to GSA\'s HDOP', fix.ext?.hdop === 1.3, `${fix.ext?.hdop}`)
}

// --- GSV's satellites-in-view never collides with GGA's satellites-used-in-fix ---
{
  const result = parseNmea([gsv('11'), gga('120000.00', '08', '0.9')].join('\n'))
  const fix = result.points[0]!
  check('GGA keeps its own "sat" (used in fix)', fix.ext?.sat === 8, `${fix.ext?.sat}`)
  check('GGA gains a distinct "sat_in_view" from GSV, not overwriting "sat"', fix.ext?.sat_in_view === 11, `${fix.ext?.sat_in_view}`)
  check('sat_in_view is reported in the channel list', result.channels.includes('sat_in_view'))
  check('sat is still reported in the channel list', result.channels.includes('sat'))
}

// --- GLL (no DOP/satellite fields of its own) also picks up GSA/GSV, same as VTG ---
{
  const result = parseNmea([gsa('2.5', '1.3', '2.1'), gsv('11'), gll('120000.00')].join('\n'))
  const fix = result.points[0]!
  check('GLL gains GSA\'s PDOP', fix.ext?.pdop === 2.5, `${fix.ext?.pdop}`)
  check('GLL gains GSV\'s sat_in_view', fix.ext?.sat_in_view === 11, `${fix.ext?.sat_in_view}`)
}

// --- malformed/non-positive DOP fields are rejected rather than entering ext as garbage ---
{
  const zeroHdop = parseNmea([gsa('2.5', '0', '2.1'), gga('120000.00', '08', '')].join('\n'))
  check('a zero GSA HDOP is rejected (fix keeps no hdop at all)', zeroHdop.points[0]?.ext?.hdop === undefined)

  const negativePdop = parseNmea([gsa('-1', '1.3', '2.1'), gga('120000.00', '08', '0.9')].join('\n'))
  check('a negative PDOP is rejected', negativePdop.points[0]?.ext?.pdop === undefined)

  const blankGsa = parseNmea([gsa('', '', ''), gga('120000.00', '08', '0.9')].join('\n'))
  check('an all-blank GSA contributes nothing', blankGsa.points[0]?.ext?.pdop === undefined && blankGsa.points[0]?.ext?.vdop === undefined)
}

// --- a later GSA/GSV replaces the earlier ride-along value ---
{
  const result = parseNmea([gsv('11'), gga('120000.00', '08', '0.9'), gsv('7'), gga('120001.00', '08', '0.9')].join('\n'))
  check('first fix carries the first GSV reading', result.points[0]!.ext?.sat_in_view === 11)
  check('second fix carries the updated GSV reading', result.points[1]!.ext?.sat_in_view === 7)
}

// --- neither GSA nor GSV produces a point on its own ---
check('a GSA-only stream yields zero points', parseNmea(gsa('2.5', '1.3', '2.1')).points.length === 0)
check('a GSV-only stream yields zero points', parseNmea(gsv('11')).points.length === 0)

console.log(`\n${failures === 0 ? 'ALL NMEA GSA/GSV CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
