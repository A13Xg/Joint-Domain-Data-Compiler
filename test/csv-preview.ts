import assert from 'node:assert/strict'
import {
  HEADER_PREVIEW_ROW_LIMIT,
  inferHeaderRow,
  inferHeaderRowFromRows,
} from '../src/core/parsers/csvPreview'

// --- Headered rows: clear text header, numeric data below --------------
{
  const rows = [
    ['latitude', 'longitude', 'elevation'],
    ...Array.from({ length: 10 }, (_, i) => [String(34.5 + i * 0.1), String(-118.2 - i * 0.1), String(120 + i * 10)]),
  ]
  const result = inferHeaderRowFromRows(rows)
  assert.equal(result.inferred, true, 'clear text header should be inferred as header')
  assert.ok(['high', 'medium'].includes(result.confidence), `expected strong confidence, got ${result.confidence}`)
  assert.ok(result.reasons.length > 0, 'expected explanatory reasons')
}

// --- All-numeric / headerless rows --------------------------------------
{
  const rows = Array.from({ length: 10 }, (_, i) => [String(34.5 + i * 0.1), String(-118.2 - i * 0.1), String(100 + i)])
  const result = inferHeaderRowFromRows(rows)
  assert.equal(result.inferred, false, 'all-numeric file should not be inferred as headered')
  assert.ok(result.reasons.some((r) => /numeric/i.test(r)), 'expected a numeric-related reason')
}

// --- Dates as a first-row signal (dates are NOT typical header text) ---
{
  const rows = [
    ['2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z', '2024-01-03T00:00:00Z'],
    ['2024-01-04T00:00:00Z', '2024-01-05T00:00:00Z', '2024-01-06T00:00:00Z'],
    ['2024-01-07T00:00:00Z', '2024-01-08T00:00:00Z', '2024-01-09T00:00:00Z'],
    ['2024-01-10T00:00:00Z', '2024-01-11T00:00:00Z', '2024-01-12T00:00:00Z'],
  ]
  const result = inferHeaderRowFromRows(rows)
  assert.equal(result.inferred, false, 'first row full of ISO datetimes should read as data, not headers')
  assert.ok(
    result.reasons.some((r) => /date|timestamp/i.test(r)),
    'expected a reason calling out date-like first-row cells',
  )
}

// --- Coordinates as a first-row signal -----------------------------------
{
  const rows = [
    ['34.5', '-118.2'],
    ['34.6', '-118.3'],
    ['34.7', '-118.4'],
    ['34.8', '-118.5'],
  ]
  const result = inferHeaderRowFromRows(rows)
  assert.equal(result.inferred, false, 'first row of coordinate pairs should read as data')
  assert.ok(
    result.reasons.some((r) => /coordinate/i.test(r)),
    'expected a reason calling out coordinate-like first-row cells',
  )
}

// --- Duplicate header names ----------------------------------------------
{
  const rows = [
    ['value', 'value', 'value'],
    ['a', 'b', 'c'],
    ['d', 'e', 'f'],
    ['g', 'h', 'i'],
  ]
  const result = inferHeaderRowFromRows(rows)
  assert.ok(
    result.reasons.some((r) => /duplicate/i.test(r)),
    'expected a reason calling out duplicate first-row cells',
  )
}

// --- Blank header names ----------------------------------------------------
{
  const rows = [
    ['name', '', 'elevation'],
    ['alpha', 'x', '120'],
    ['bravo', 'y', '130'],
    ['charlie', 'z', '140'],
  ]
  const result = inferHeaderRowFromRows(rows)
  assert.ok(
    result.reasons.some((r) => /blank/i.test(r)),
    'expected a reason calling out a blank first-row cell',
  )
}

// --- Mixed / ambiguous data: too little data to establish a baseline ---
{
  const rows = [['a', 'b', 'c']]
  const result = inferHeaderRowFromRows(rows)
  assert.equal(result.confidence, 'ambiguous', 'a single row with no data baseline should be ambiguous')
}

{
  // Mixed numeric/text first row and mixed data rows: no strong signal
  // either way. Confidence should not be forced to high/medium.
  const rows = [
    ['id1', 'ok', '12'],
    ['id2', 'maybe', 'x'],
    ['id3', 'no', '14'],
    ['id4', 'ok', 'y'],
    ['id5', 'no', '16'],
  ]
  const result = inferHeaderRowFromRows(rows)
  assert.ok(
    ['ambiguous', 'low'].includes(result.confidence),
    `expected low/ambiguous confidence for mixed data, got ${result.confidence}`,
  )
}

// --- Empty input -----------------------------------------------------------
{
  const result = inferHeaderRowFromRows([])
  assert.equal(result.inferred, false)
  assert.equal(result.confidence, 'ambiguous')
  assert.ok(result.reasons.length > 0)
}

// --- Blank first row ---------------------------------------------------
{
  const result = inferHeaderRowFromRows([['', '', ''], ['1', '2', '3']])
  assert.equal(result.inferred, false)
  assert.equal(result.confidence, 'ambiguous')
  assert.ok(result.reasons.some((r) => /blank/i.test(r)))
}

// --- Bounded sampling: only the first HEADER_PREVIEW_ROW_LIMIT rows count ---
{
  assert.equal(HEADER_PREVIEW_ROW_LIMIT, 20)
  const headerRow = ['latitude', 'longitude']
  const numericRows = Array.from({ length: 100 }, (_, i) => [String(i), String(i)])
  const withExcessRows = [headerRow, ...numericRows]
  const truncatedToLimit = [headerRow, ...numericRows.slice(0, HEADER_PREVIEW_ROW_LIMIT - 1)]
  const full = inferHeaderRowFromRows(withExcessRows)
  const truncated = inferHeaderRowFromRows(truncatedToLimit)
  assert.deepEqual(full, truncated, 'rows beyond the preview limit must not affect the result')
}

// --- Delimiter variants: comma, tab, semicolon --------------------------
{
  const comma = inferHeaderRow('name,latitude,longitude\nalpha,34.5,-118.2\nbravo,34.6,-118.3\ncharlie,34.7,-118.4\n')
  assert.equal(comma.inferred, true, 'comma-delimited header should be detected')

  const tab = inferHeaderRow('name\tlatitude\tlongitude\nalpha\t34.5\t-118.2\nbravo\t34.6\t-118.3\ncharlie\t34.7\t-118.4\n', '\t')
  assert.equal(tab.inferred, true, 'tab-delimited header should be detected')

  const semicolon = inferHeaderRow('name;latitude;longitude\nalpha;34.5;-118.2\nbravo;34.6;-118.3\ncharlie;34.7;-118.4\n', ';')
  assert.equal(semicolon.inferred, true, 'semicolon-delimited header should be detected')
}

// --- Quoted commas and embedded newlines in the sampled text ------------
{
  const csvText =
    'name,description,latitude,longitude\n' +
    '"Smith, John","Multi-line\nnote here",34.5,-118.2\n' +
    '"Doe, Jane","Another, quoted, field",34.6,-118.3\n' +
    'plain,text,34.7,-118.4\n'
  const result = inferHeaderRow(csvText)
  assert.equal(result.inferred, true, 'quoted commas/newlines in the sample must not break header inference')
}

console.log('CSV preview (header inference) tests passed')
