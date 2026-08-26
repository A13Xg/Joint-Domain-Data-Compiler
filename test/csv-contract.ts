import assert from 'node:assert/strict'
import { normalizeCsvAnalysisResult } from '../src/core/csvContract'
import { analyzeRawRows } from '../src/core/csvAnalysis'

const normalized = normalizeCsvAnalysisResult({
  delimiter: ',',
  dataStartRow: 1,
  columns: [{ name: 'latitude', index: 0 }],
  sampleRows: [{ latitude: '34.5' }],
})

assert.equal(normalized.columns.length, 1)
assert.deepEqual(normalized.columns[0]?.sampleValues, [])
assert.deepEqual(normalized.columns[0]?.candidates, [])
assert.deepEqual(normalized.columns[0]?.headerCandidates, ['latitude'])
assert.deepEqual(normalized.rawPreviewRows, [])
assert.equal(normalized.headerInference.confidence, 'low')
assert.match(normalized.headerInference.reason, /unavailable/)
assert.equal(normalized.rowOneInference.inferred, false)
assert.equal(normalized.rowOneInference.confidence, 'ambiguous')
assert.deepEqual(normalized.rowOneInference.reasons, [])
const previewed = normalizeCsvAnalysisResult({
  columns: [{ name: 'latitude', index: 0 }],
  rawPreviewRows: [['Latitude'], ['34.5']],
  headerInference: { confidence: 'high', reason: 'Leading row is descriptive.' },
})
assert.deepEqual(previewed.rawPreviewRows, [['Latitude'], ['34.5']])
assert.equal(previewed.headerInference.confidence, 'high')
const analyzed = analyzeRawRows([
  ['Latitude', 'Longitude'],
  ['degrees_north', 'degrees_east'],
  ['34.5', '-117.2'],
  ['34.6', '-117.3'],
], ',', 'auto')
assert.equal(analyzed.dataStartRow, 2)
assert.equal(analyzed.headerInference.confidence, 'high')
assert.equal(analyzed.rowOneInference.inferred, true, 'row-1-only check should agree row 1 is a header')
assert.ok(analyzed.rowOneInference.reasons.length > 0)
assert.deepEqual(analyzed.rawPreviewRows, [
  ['Latitude', 'Longitude'],
  ['degrees_north', 'degrees_east'],
  ['34.5', '-117.2'],
  ['34.6', '-117.3'],
])
const overridden = analyzeRawRows(analyzed.rawPreviewRows, ',', 1)
assert.equal(overridden.dataStartRow, 1)
assert.equal(overridden.sampleRows[0]?.Latitude, 'degrees_north')
assert.throws(() => normalizeCsvAnalysisResult({ columns: null }), /columns array/)
assert.throws(() => normalizeCsvAnalysisResult({ columns: [] }), /no detectable columns/)
console.log('CSV analysis contract tests passed')
