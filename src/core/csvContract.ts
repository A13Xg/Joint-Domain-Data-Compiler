import type { CsvAnalysisResult, CsvSampleRow, DetectedColumn } from '../types/converter'

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CSV analyzer returned an invalid payload')
  return value as Record<string, unknown>
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeColumn(value: unknown, index: number): DetectedColumn {
  const raw = asRecord(value)
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : `Column ${index + 1}`
  const candidates = Array.isArray(raw.candidates) ? raw.candidates.filter((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false
    const item = candidate as Record<string, unknown>
    return typeof item.field === 'string' && typeof item.score === 'number' && Number.isFinite(item.score)
  }) as DetectedColumn['candidates'] : []
  const statsRaw = raw.stats && typeof raw.stats === 'object' ? raw.stats as Record<string, unknown> : {}
  const ratio = (key: string) => typeof statsRaw[key] === 'number' && Number.isFinite(statsRaw[key]) ? statsRaw[key] as number : 0
  const headers = stringArray(raw.headerCandidates)
  return {
    name,
    index: typeof raw.index === 'number' && Number.isInteger(raw.index) ? raw.index : index,
    headerCandidates: headers.length ? headers : [name],
    sampleValues: stringArray(raw.sampleValues),
    estimatedType: typeof raw.estimatedType === 'string' ? raw.estimatedType as DetectedColumn['estimatedType'] : 'text',
    estimatedConfidence: typeof raw.estimatedConfidence === 'number' && Number.isFinite(raw.estimatedConfidence) ? raw.estimatedConfidence : 0,
    patterns: stringArray(raw.patterns),
    stats: { nonEmptyRatio: ratio('nonEmptyRatio'), uniqueRatio: ratio('uniqueRatio'), numericRatio: ratio('numericRatio'), datetimeRatio: ratio('datetimeRatio'), booleanRatio: ratio('booleanRatio') },
    candidates,
  }
}

export function normalizeCsvAnalysisResult(value: unknown): CsvAnalysisResult {
  const raw = asRecord(value)
  if (!Array.isArray(raw.columns)) throw new Error('CSV analyzer did not return a columns array')
  const columns = raw.columns.map(normalizeColumn)
  if (columns.length === 0) throw new Error('CSV file contains no detectable columns')
  const sampleRows = Array.isArray(raw.sampleRows)
    ? raw.sampleRows.filter((row): row is CsvSampleRow => !!row && typeof row === 'object' && !Array.isArray(row))
    : []
  const rawPreviewRows = Array.isArray(raw.rawPreviewRows)
    ? raw.rawPreviewRows.filter(Array.isArray).map((row) => row.map((cell) => typeof cell === 'string' ? cell : String(cell ?? ''))).slice(0, 20)
    : []
  const inferenceRaw = raw.headerInference && typeof raw.headerInference === 'object' ? raw.headerInference as Record<string, unknown> : {}
  const confidence = inferenceRaw.confidence === 'high' || inferenceRaw.confidence === 'medium' || inferenceRaw.confidence === 'low' ? inferenceRaw.confidence : 'low'
  const rowOneRaw = raw.rowOneInference && typeof raw.rowOneInference === 'object' ? raw.rowOneInference as Record<string, unknown> : {}
  const rowOneConfidence = ['high', 'medium', 'low', 'ambiguous'].includes(rowOneRaw.confidence as string)
    ? rowOneRaw.confidence as 'high' | 'medium' | 'low' | 'ambiguous'
    : 'ambiguous'
  return {
    delimiter: typeof raw.delimiter === 'string' ? raw.delimiter : ',',
    rowCountSampled: typeof raw.rowCountSampled === 'number' && Number.isFinite(raw.rowCountSampled) ? raw.rowCountSampled : sampleRows.length,
    dataStartRow: typeof raw.dataStartRow === 'number' && Number.isInteger(raw.dataStartRow) ? Math.max(0, raw.dataStartRow) : 1,
    sampleRows,
    rawPreviewRows,
    headerInference: { confidence, reason: typeof inferenceRaw.reason === 'string' ? inferenceRaw.reason : 'Header inference details unavailable.' },
    rowOneInference: {
      inferred: rowOneRaw.inferred === true,
      confidence: rowOneConfidence,
      reasons: stringArray(rowOneRaw.reasons),
    },
    columns,
  }
}
