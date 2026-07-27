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

assert.equal(failures, 0)
console.log(`\n${failures === 0 ? 'ALL CSV IMPORT LIMIT CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
