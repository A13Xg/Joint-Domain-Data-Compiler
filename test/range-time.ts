import assert from 'node:assert/strict'
import { autoDetectEpochMs, parseRangeTimeToEpochMs, parseTimeToEpochMs } from '../src/core/format'
import { parseDateLike } from '../src/core/parsers/csvPreview'
import { buildPointsFromCsvRows } from '../src/core/parsers/csv'
import { analyzeRawRows } from '../src/core/csvAnalysis'

// A fixed anchor keeps every expectation exact: 2026-06-15T00:00:00Z sits in
// 2026, which is not a leap year, so DOY 160 is 9 June.
const ANCHOR = Date.UTC(2026, 5, 15)

// --- IRIG day-of-year: DDD:HH:MM:SS.ffffff -------------------------------
{
  const ms = parseRangeTimeToEpochMs('160:16:33:14.572000', ANCHOR)
  assert.equal(ms, Date.UTC(2026, 5, 9, 16, 33, 14, 572), 'DOY 160 of 2026 is 9 June')
  assert.equal(new Date(ms as number).toISOString(), '2026-06-09T16:33:14.572Z')
}

// Sub-second precision is preserved to the millisecond, and the microsecond
// tail rounds rather than truncating.
{
  assert.equal(parseRangeTimeToEpochMs('001:00:00:00.000000', ANCHOR), Date.UTC(2026, 0, 1))
  assert.equal(parseRangeTimeToEpochMs('001:00:00:00.0006', ANCHOR), Date.UTC(2026, 0, 1) + 1)
  assert.equal(parseRangeTimeToEpochMs('366:23:59:59.999', ANCHOR), Date.UTC(2026, 0, 1) + 365 * 86_400_000 + 86_399_999)
}

// --- Bare clock time anchors to the anchor's own day ----------------------
{
  assert.equal(parseRangeTimeToEpochMs('16:33:14.572', ANCHOR), Date.UTC(2026, 5, 15, 16, 33, 14, 572))
  assert.equal(parseRangeTimeToEpochMs('1:2:3', ANCHOR), Date.UTC(2026, 5, 15, 1, 2, 3))
}

// --- Rejections: field values that cannot be a time ----------------------
{
  for (const bad of ['', '160', '160:16:33', '000:00:00:00', '367:00:00:00', '160:24:00:00', '160:16:60:00', '160:16:33:61', 'abc', '2026-06-09T16:33:14Z', '1749487994572']) {
    assert.equal(parseRangeTimeToEpochMs(bad, ANCHOR), null, `${JSON.stringify(bad)} must not parse as range time`)
  }
}

// --- Reachable through the public entry points ---------------------------
{
  // Explicit format.
  const explicit = parseTimeToEpochMs('160:16:33:14.572000', 'irig_doy')
  assert.ok(explicit !== null, 'irig_doy format must parse range time')

  // Auto-detect: the path an unattended import actually takes.
  const auto = autoDetectEpochMs('160:16:33:14.572000')
  assert.ok(auto !== null, 'auto-detect must recognise range time')
  assert.equal(auto, explicit, 'auto-detect and explicit format must agree')

  // Auto-detect must not have been broken for the formats it already handled.
  assert.equal(autoDetectEpochMs('2026-06-09T16:33:14.572Z'), Date.UTC(2026, 5, 9, 16, 33, 14, 572))
  assert.equal(autoDetectEpochMs('1749487994'), 1749487994000)
  assert.equal(autoDetectEpochMs('1749487994572'), 1749487994572)
}

// --- Column analysis types the column as a datetime and maps it -----------
{
  const rows = [
    ['TIME', 'GPS_LATITUDE', 'GPS_LONGITUDE', 'GPS_ALTITUDE'],
    ...Array.from({ length: 12 }, (_, i) => [
      `160:16:33:${String(14 + i).padStart(2, '0')}.500000`,
      String(37.798 + i * 0.0001),
      String(-116.78 - i * 0.0001),
      String(5516 + i * 4),
    ]),
  ]
  const analysis = analyzeRawRows(rows, ',', 'single')
  const timeColumn = analysis.columns.find((column) => column.name === 'TIME')
  assert.ok(timeColumn, 'TIME column should be detected')
  assert.equal(timeColumn.estimatedType, 'datetime', 'IRIG range time should be typed as a datetime, not text')
  assert.equal(timeColumn.candidates[0]?.field, 'timestamp', 'TIME should win the timestamp candidacy')
}

// parseDateLike is what feeds the datetimeRatio above; check it directly too.
{
  assert.ok(parseDateLike('160:16:33:14.572000') !== null, 'parseDateLike must accept range time')
  assert.equal(parseDateLike('not a time at all'), null)
}

// --- End to end: rows -> points, with the year assumption surfaced --------
{
  const rows = Array.from({ length: 5 }, (_, i) => ({
    TIME: `160:16:33:${String(14 + i).padStart(2, '0')}.500000`,
    LAT: String(37.798 + i * 0.0001),
    LON: String(-116.78 - i * 0.0001),
  }))
  const result = buildPointsFromCsvRows(rows, {
    latitude: 'LAT', longitude: 'LON', elevation: '', timestamp: 'TIME',
    name: '', description: '', elevationUnit: 'meters', timeFormat: 'auto',
  }, ['TIME', 'LAT', 'LON'])

  assert.equal(result.points.length, 5)
  assert.ok(result.points.every((point) => point.time !== undefined), 'every row must carry a timestamp')
  assert.ok(
    !result.warnings.some((warning) => /could not be parsed/.test(warning)),
    `no timestamp should fail to parse, got: ${result.warnings.join(' | ')}`,
  )
  assert.ok(
    result.warnings.some((warning) => /carry no year/.test(warning)),
    'the year assumption must be stated as an import warning',
  )

  // Consecutive samples are exactly one second apart: relative timing, the thing
  // every downstream analytic consumes, must survive the year assumption intact.
  const deltas = result.points.slice(1).map((point, i) => (point.time as number) - (result.points[i]!.time as number))
  assert.deepEqual(deltas, [1000, 1000, 1000, 1000])
}

// --- No usable timestamp is a prominent warning, not a silent gap ---------
{
  const rows = [{ LAT: '37.798', LON: '-116.78' }]
  const noMapping = buildPointsFromCsvRows(rows, {
    latitude: 'LAT', longitude: 'LON', elevation: '', timestamp: '',
    name: '', description: '', elevationUnit: 'meters', timeFormat: 'auto',
  }, ['LAT', 'LON'])
  assert.equal(noMapping.points.length, 1, 'the point still imports, just without a time')
  assert.ok(noMapping.points[0]!.time === undefined)
  assert.ok(
    noMapping.warnings.some((warning) => /usable timestamp/i.test(warning)),
    `an unmapped timestamp column must surface a prominent warning, got: ${noMapping.warnings.join(' | ')}`,
  )
}
{
  // Every row's timestamp fails to parse: same practical outcome (zero timed
  // points) as an unmapped column, so it gets the same warning, on top of
  // (not instead of) the existing per-row parse-failure count.
  const rows = [{ LAT: '37.798', LON: '-116.78', TIME: 'not-a-time' }]
  const unparseable = buildPointsFromCsvRows(rows, {
    latitude: 'LAT', longitude: 'LON', elevation: '', timestamp: 'TIME',
    name: '', description: '', elevationUnit: 'meters', timeFormat: 'auto',
  }, ['LAT', 'LON', 'TIME'])
  assert.ok(unparseable.warnings.some((warning) => /could not be parsed/.test(warning)))
  assert.ok(unparseable.warnings.some((warning) => /usable timestamp/i.test(warning)))
}
{
  // Regression guard: a normally-timed import gets neither warning.
  const rows = [{ LAT: '37.798', LON: '-116.78', TIME: '2026-06-09T16:33:14Z' }]
  const timed = buildPointsFromCsvRows(rows, {
    latitude: 'LAT', longitude: 'LON', elevation: '', timestamp: 'TIME',
    name: '', description: '', elevationUnit: 'meters', timeFormat: 'auto',
  }, ['LAT', 'LON', 'TIME'])
  assert.ok(!timed.warnings.some((warning) => /usable timestamp/i.test(warning)), 'a fully-timed import must not warn')
}
{
  // No rows at all: nothing to warn about.
  const empty = buildPointsFromCsvRows([], {
    latitude: 'LAT', longitude: 'LON', elevation: '', timestamp: '',
    name: '', description: '', elevationUnit: 'meters', timeFormat: 'auto',
  }, ['LAT', 'LON'])
  assert.ok(!empty.warnings.some((warning) => /usable timestamp/i.test(warning)), 'an empty import must not warn about missing time')
}

console.log('range/IRIG time parsing tests passed')
