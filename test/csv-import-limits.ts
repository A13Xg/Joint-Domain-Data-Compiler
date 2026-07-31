// Task 2.3: memory-aware CSV import. Verifies the chunked streamCsvFileToPoints
// path produces the same result as the prior two-pass approach, enforces a
// mid-stream point budget (an explicit refusal checkpoint rather than only a
// post-hoc check), and supports clean cancellation.
import assert from 'node:assert/strict'
import './helpers/nodeFileReaderShim.ts'
import {
  buildPointsFromCsvRows,
  streamCsvFileToPoints,
  CsvImportCancelledError,
  type CsvMapping,
} from '../src/core/parsers/csv.ts'
import { FormatBudgetExceededError } from '../src/core/parsers/limits.ts'
import { inferHeaderRowFromRows } from '../src/core/parsers/csvPreview.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}
async function checkAsync(name: string, fn: () => Promise<boolean>): Promise<void> {
  try {
    check(name, await fn())
  } catch (err) {
    failures++
    console.log(`  [FAIL] ${name} — threw ${(err as Error).message}`)
  }
}
async function checkRejects(name: string, fn: () => Promise<unknown>, isExpected: (err: unknown) => boolean): Promise<void> {
  try {
    await fn()
    check(name, false, 'did not reject')
  } catch (err) {
    check(name, isExpected(err), isExpected(err) ? '' : `unexpected error: ${(err as Error).message}`)
  }
}

const mapping: CsvMapping = {
  latitude: 'lat', longitude: 'lon', elevation: 'ele', timestamp: 'time',
  name: '', description: '', elevationUnit: 'meters', timeFormat: 'auto',
}
const columns = ['lat', 'lon', 'ele', 'time', 'note']

function buildCsvText(rowCount: number): string {
  const lines = [columns.join(',')]
  for (let i = 0; i < rowCount; i++) {
    const lat = (30 + i * 0.0001).toFixed(6)
    const lon = (-100 + i * 0.0001).toFixed(6)
    lines.push(`${lat},${lon},${100 + (i % 20)},2024-01-01T00:00:${String(i % 60).padStart(2, '0')}Z,row-${i}`)
  }
  return lines.join('\n')
}

// --- Regression parity between the streaming and bulk row-mapping paths ---
await checkAsync('Streaming CSV parse matches the bulk row-mapping result', async () => {
  const text = buildCsvText(500)
  const file = new File([text], 'sample.csv', { type: 'text/csv' })

  const bulkRows = text.split('\n').slice(1).map((line) => {
    const cells = line.split(',')
    const row: Record<string, string> = {}
    columns.forEach((c, i) => { row[c] = cells[i] ?? '' })
    return row
  })
  const bulkResult = buildPointsFromCsvRows(bulkRows, mapping, columns)
  const streamedResult = await streamCsvFileToPoints(file, ',', columns, 1, mapping)

  return (
    streamedResult.points.length === bulkResult.points.length &&
    streamedResult.points.length === 500 &&
    JSON.stringify(streamedResult.points[10]) === JSON.stringify(bulkResult.points[10]) &&
    JSON.stringify(streamedResult.warnings) === JSON.stringify(bulkResult.warnings) &&
    JSON.stringify(streamedResult.channels.sort()) === JSON.stringify(bulkResult.channels.sort())
  )
})

// --- Mid-stream point budget ------------------------------------------------
await checkRejects(
  'Streaming CSV parse aborts once the point budget is exceeded, without finishing the file',
  async () => {
    const text = buildCsvText(50_000) // several MB — spans multiple 1MB Papa chunks
    const file = new File([text], 'huge.csv', { type: 'text/csv' })
    return streamCsvFileToPoints(file, ',', columns, 1, mapping, { maxPoints: 10 })
  },
  (err) => err instanceof FormatBudgetExceededError,
)

// --- Cancellation ------------------------------------------------------------
await checkRejects(
  'Streaming CSV parse can be cancelled mid-stream',
  async () => {
    const text = buildCsvText(50_000)
    const file = new File([text], 'huge.csv', { type: 'text/csv' })
    let seenFirstChunk = false
    return streamCsvFileToPoints(file, ',', columns, 1, mapping, {
      isCancelled: () => {
        const cancel = seenFirstChunk
        seenFirstChunk = true
        return cancel
      },
    })
  },
  (err) => err instanceof CsvImportCancelledError,
)

await checkAsync('A cancellation flag that never trips completes normally', async () => {
  const text = buildCsvText(50)
  const file = new File([text], 'small.csv', { type: 'text/csv' })
  const result = await streamCsvFileToPoints(file, ',', columns, 1, mapping, { isCancelled: () => false })
  return result.points.length === 50
})

// --- Task 2.3: mapping-panel header override reaches the real streaming
// import, not just the preview -----------------------------------------
//
// Builds a two-row-header CSV: real column labels, then a placeholder/units
// row whose cells ("0,0,0,...") happen to parse as *valid* coordinates. The
// bounded header-block heuristic (detectDataStartRow, what analysis.dataStartRow
// is seeded from) only ever inspects the first MAX_HEADER_ROWS rows and can
// legitimately settle on treating just row 0 as header here, since the
// placeholder row's numeric ratio reads as data-like. That's exactly the
// "ambiguous, don't auto-apply" situation the mapping panel exists to
// surface: the user reviews the preview, recognizes row 1 is also
// boilerplate, and overrides dataStartRow to skip both rows. This test
// proves that override reaches the *real* streamCsvFileToPoints path — the
// same call App.tsx's buildCsvDataset makes — and not just csvPreview's
// on-screen sampling.
await checkAsync('Mapping-panel header-row override changes the first point streamed by the real import path', async () => {
  const headerRows = [
    ['lat', 'lon', 'ele', 'time', 'note'],
    ['0', '0', '0', '2024-01-01T00:00:00Z', 'placeholder'],
  ]
  const dataRows = [
    ['40.000100', '-105.000100', '1600', '2024-01-01T00:00:00Z', 'row-0'],
    ['40.000200', '-105.000200', '1601', '2024-01-01T00:00:01Z', 'row-1'],
  ]
  const allRows = [...headerRows, ...dataRows]
  const text = allRows.map((r) => r.join(',')).join('\n')
  const file = new File([text], 'two-row-header.csv', { type: 'text/csv' })

  // What the worker's analysis step would seed dataStartRow with — only row 0
  // is confidently header-like from bounded inspection.
  const inference = inferHeaderRowFromRows(allRows)
  const naiveDataStartRow = inference.inferred ? 1 : 0
  const userOverrideDataStartRow = 2 // user reviews the preview and skips both header-like rows

  const naiveResult = await streamCsvFileToPoints(file, ',', columns, naiveDataStartRow, mapping)
  const overriddenResult = await streamCsvFileToPoints(file, ',', columns, userOverrideDataStartRow, mapping)

  // Naive default treats the placeholder row's "0,0" as a genuine coordinate
  // pair, so its first emitted point is corrupted (lat=0, lon=0) instead of
  // the real first data row.
  const naiveFirst = naiveResult.points[0]
  const naiveNote = naiveFirst?.ext?.note as string | undefined

  // With the user's override, the real streamed import starts exactly at
  // physical row 2, i.e. the first genuine data row — proving dataStartRow
  // genuinely reaches streaming import rather than being ignored in favor
  // of whatever the preview/analysis step guessed.
  const overriddenFirst = overriddenResult.points[0]
  const overriddenNote = overriddenFirst?.ext?.note as string | undefined

  return (
    naiveResult.points.length === 3 &&
    naiveFirst?.lat === 0 &&
    naiveFirst?.lon === 0 &&
    naiveNote === 'placeholder' &&
    overriddenResult.points.length === 2 &&
    overriddenFirst?.lat === 40.0001 &&
    overriddenFirst?.lon === -105.0001 &&
    overriddenNote === 'row-0'
  )
})

assert.equal(failures, 0)
console.log(`\n${failures === 0 ? 'ALL CSV IMPORT LIMIT CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
