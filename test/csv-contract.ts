import assert from 'node:assert/strict'
import { normalizeCsvAnalysisResult } from '../src/core/csvContract'

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
const previewed = normalizeCsvAnalysisResult({
  columns: [{ name: 'latitude', index: 0 }],
  rawPreviewRows: [['Latitude'], ['34.5']],
  headerInference: { confidence: 'high', reason: 'Leading row is descriptive.' },
})
assert.deepEqual(previewed.rawPreviewRows, [['Latitude'], ['34.5']])
assert.equal(previewed.headerInference.confidence, 'high')
assert.throws(() => normalizeCsvAnalysisResult({ columns: null }), /columns array/)
assert.throws(() => normalizeCsvAnalysisResult({ columns: [] }), /no detectable columns/)
console.log('CSV analysis contract tests passed')
