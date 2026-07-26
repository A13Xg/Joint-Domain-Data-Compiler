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
assert.throws(() => normalizeCsvAnalysisResult({ columns: null }), /columns array/)
assert.throws(() => normalizeCsvAnalysisResult({ columns: [] }), /no detectable columns/)
console.log('CSV analysis contract tests passed')
