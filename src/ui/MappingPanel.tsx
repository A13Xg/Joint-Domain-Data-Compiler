// CSV column → field mapping. Driven by the analyzer worker's column intelligence
// (type guesses + confidence). Lets engineers bind lat/lon/ele/time/name/desc,
// pick units & time format, preview valid-point counts on the sample, and detect
// a transposed lat/lon mapping — then build the unified Dataset.
import { useMemo } from 'react'
import type { CsvAnalysisResult, DetectedColumn } from '../types/converter'
import type { CsvMapping } from '../core/parsers/csv'
import { buildPointsFromCsvRows } from '../core/parsers/csv'
import type { ElevationUnit, TimeFormat } from '../core/format'

interface Props {
  analysis: CsvAnalysisResult
  mapping: CsvMapping
  onChange: (mapping: CsvMapping) => void
  onBuild: () => void
  building: boolean
}

const TIME_FORMATS: Array<{ id: TimeFormat; label: string }> = [
  { id: 'auto', label: 'Auto-detect' },
  { id: 'iso', label: 'ISO 8601' },
  { id: 'epoch_seconds', label: 'Epoch seconds' },
  { id: 'epoch_milliseconds', label: 'Epoch milliseconds' },
  { id: 'epoch_microseconds', label: 'Epoch microseconds' },
  { id: 'excel_serial', label: 'Excel serial date' },
]

export function MappingPanel({ analysis, mapping, onChange, onBuild, building }: Props) {
  const columns = analysis.columns
  const rows = analysis.sampleRows

  const validCount = useMemo(() => {
    if (!mapping.latitude || !mapping.longitude) return 0
    return buildPointsFromCsvRows(rows, mapping, columns.map((c) => c.name)).points.length
  }, [rows, mapping, columns])

  const swappedCount = useMemo(() => {
    if (!mapping.latitude || !mapping.longitude) return 0
    const swapped = { ...mapping, latitude: mapping.longitude, longitude: mapping.latitude }
    return buildPointsFromCsvRows(rows, swapped, columns.map((c) => c.name)).points.length
  }, [rows, mapping, columns])

  const suggestSwap = validCount > 0 && swappedCount >= Math.max(8, validCount * 1.5)

  const set = (patch: Partial<CsvMapping>) => onChange({ ...mapping, ...patch })

  return (
    <div className="mapping-panel">
      <div className="mapping-summary">
        <span>delimiter <code>{prettyDelimiter(analysis.delimiter)}</code></span>
        <span>{columns.length} columns</span>
        <span>{analysis.rowCountSampled.toLocaleString()} sampled rows</span>
        <span className={validCount > 0 ? 'ok' : 'warn'}>{validCount.toLocaleString()} valid in sample</span>
      </div>

      {suggestSwap && (
        <div className="swap-hint">
          ⚠ Reversing latitude/longitude yields more valid points ({swappedCount} vs {validCount}).
          <button type="button" onClick={() => set({ latitude: mapping.longitude, longitude: mapping.latitude })}>
            Swap
          </button>
        </div>
      )}

      <div className="mapping-fields">
        <FieldSelect label="Latitude *" columns={columns} value={mapping.latitude} field="latitude" onChange={(v) => set({ latitude: v })} />
        <FieldSelect label="Longitude *" columns={columns} value={mapping.longitude} field="longitude" onChange={(v) => set({ longitude: v })} />
        <FieldSelect label="Elevation" columns={columns} value={mapping.elevation} field="elevation" optional onChange={(v) => set({ elevation: v })} />
        <label className="map-field">
          <span>Elevation unit</span>
          <select value={mapping.elevationUnit} onChange={(e) => set({ elevationUnit: e.target.value as ElevationUnit })}>
            <option value="meters">Meters</option>
            <option value="feet">Feet</option>
          </select>
        </label>
        <FieldSelect label="Timestamp" columns={columns} value={mapping.timestamp} field="timestamp" optional onChange={(v) => set({ timestamp: v })} />
        <label className="map-field">
          <span>Timestamp format</span>
          <select value={mapping.timeFormat} onChange={(e) => set({ timeFormat: e.target.value as TimeFormat })}>
            {TIME_FORMATS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
        <FieldSelect label="Name" columns={columns} value={mapping.name} field="name" optional onChange={(v) => set({ name: v })} />
        <FieldSelect label="Description" columns={columns} value={mapping.description} field="description" optional onChange={(v) => set({ description: v })} />
      </div>

      <p className="muted small">
        Unmapped columns are preserved as extension channels. All values support DMS coordinates and
        comma decimals.
      </p>

      <button type="button" className="build-btn" disabled={!mapping.latitude || !mapping.longitude || building} onClick={onBuild}>
        {building ? 'Building dataset…' : 'Build dataset from full CSV'}
      </button>
    </div>
  )
}

function FieldSelect({
  label,
  columns,
  value,
  field,
  optional,
  onChange,
}: {
  label: string
  columns: DetectedColumn[]
  value: string
  field: string
  optional?: boolean
  onChange: (v: string) => void
}) {
  return (
    <label className="map-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{optional ? 'None' : 'Select column'}</option>
        {columns.map((c) => {
          const score = c.candidates.find((cand) => cand.field === field)?.score
          return (
            <option key={c.name} value={c.name}>
              {c.name}
              {score && score >= 0.45 ? ` (${Math.round(score * 100)}%)` : ''}
            </option>
          )
        })}
      </select>
    </label>
  )
}

function prettyDelimiter(d: string): string {
  if (d === ',') return ','
  if (d === ';') return ';'
  if (d === '\t') return '\\t'
  return d || 'auto'
}
