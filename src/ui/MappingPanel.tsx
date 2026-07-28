// CSV column → field mapping. Driven by the analyzer worker's column intelligence
// (type guesses + confidence). Lets engineers bind lat/lon/ele/time/name/desc,
// pick units & time format, preview valid-point counts on the sample, and detect
// a transposed lat/lon mapping — then build the unified Dataset.
import { useMemo } from 'react'
import type { CsvAnalysisResult, DetectedColumn } from '../types/converter'
import type { CsvMapping } from '../core/parsers/csv'
import { buildPointsFromCsvRows } from '../core/parsers/csv'
import type { ElevationUnit, TimeFormat } from '../core/format'
import { InfoTooltip } from './InfoTooltip'

interface Props {
  analysis: CsvAnalysisResult
  mapping: CsvMapping
  onChange: (mapping: CsvMapping) => void
  additionalHeaders: boolean
  onToggleAdditionalHeaders: (v: boolean) => void
  dataStartRow: number
  onDataStartRowChange: (v: number) => void
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

export function MappingPanel({ analysis, mapping, onChange, additionalHeaders, onToggleAdditionalHeaders, dataStartRow, onDataStartRowChange, onBuild, building }: Props) {
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

      <details className="csv-preview">
        <summary>Preview first {analysis.rawPreviewRows.length} physical rows</summary>
        <p className="muted small">Values are shown exactly as sampled, including row one. Header interpretation only changes how columns are named and mapped; it never changes the source file.</p>
        <div className="compact-table"><table><thead><tr><th>row</th>{columns.map((column) => <th key={column.index}>Column {column.index + 1}</th>)}</tr></thead><tbody>
          {analysis.rawPreviewRows.map((row, index) => <tr key={index}><th>{index + 1}</th>{columns.map((column) => <td key={column.index}>{row[column.index] ?? ''}</td>)}</tr>)}
        </tbody></table></div>
      </details>

      <label className="header-compat-toggle">
        <input
          type="checkbox"
          checked={additionalHeaders}
          onChange={(e) => onToggleAdditionalHeaders(e.target.checked)}
        />
        <span>Header interpretation override</span>
        <span className="muted small">
          {' '}— automatic analysis selected {analysis.dataStartRow} leading header row{analysis.dataStartRow === 1 ? '' : 's'} with {analysis.headerInference.confidence} confidence: {analysis.headerInference.reason}
        </span>
      </label>
      <label className="header-compat-toggle">
        <span>Data begins after row</span>
        <input type="number" min={0} max={Math.max(0, analysis.rowCountSampled - 1)} value={dataStartRow} onChange={(event) => onDataStartRowChange(Math.max(0, Number(event.target.value) || 0))} />
        <span className="muted small">— this override is used for the full import.</span>
      </label>

      {suggestSwap && (
        <div className="swap-hint">
          ⚠ Reversing latitude/longitude yields more valid points ({swappedCount} vs {validCount}).
          <button type="button" onClick={() => set({ latitude: mapping.longitude, longitude: mapping.latitude })}>
            Swap
          </button>
        </div>
      )}

      <div className="mapping-fields">
        <FieldSelect label="Latitude *" columns={columns} value={mapping.latitude} field="latitude" additionalHeaders={additionalHeaders} onChange={(v) => set({ latitude: v })} />
        <FieldSelect label="Longitude *" columns={columns} value={mapping.longitude} field="longitude" additionalHeaders={additionalHeaders} onChange={(v) => set({ longitude: v })} />
        <FieldSelect label="Elevation" columns={columns} value={mapping.elevation} field="elevation" optional additionalHeaders={additionalHeaders} onChange={(v) => set({ elevation: v })} />
        <label className="map-field">
          <span>Elevation unit</span>
          <select value={mapping.elevationUnit} onChange={(e) => set({ elevationUnit: e.target.value as ElevationUnit })}>
            <option value="meters">Meters</option>
            <option value="feet">Feet</option>
          </select>
        </label>
        <FieldSelect label="Timestamp" columns={columns} value={mapping.timestamp} field="timestamp" optional additionalHeaders={additionalHeaders} onChange={(v) => set({ timestamp: v })} />
        <label className="map-field">
          <span>Timestamp format</span>
          <select value={mapping.timeFormat} onChange={(e) => set({ timeFormat: e.target.value as TimeFormat })}>
            {TIME_FORMATS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
        <FieldSelect label="Name" columns={columns} value={mapping.name} field="name" optional additionalHeaders={additionalHeaders} onChange={(v) => set({ name: v })} />
        <FieldSelect label="Description" columns={columns} value={mapping.description} field="description" optional additionalHeaders={additionalHeaders} onChange={(v) => set({ description: v })} />
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
  additionalHeaders,
  onChange,
}: {
  label: string
  columns: DetectedColumn[]
  value: string
  field: string
  optional?: boolean
  additionalHeaders: boolean
  onChange: (v: string) => void
}) {
  const selected = columns.find((c) => c.name === value)
  return (
    <label className="map-field">
      <span className="map-field-label">
        <span>{label}</span>
        <InfoTooltip column={selected} />
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{optional ? 'None' : 'Select column'}</option>
        {columns.map((c) => {
          const score = c.candidates.find((cand) => cand.field === field)?.score
          const optionLabel = additionalHeaders && c.headerCandidates.length > 1
            ? c.headerCandidates.join(' / ')
            : c.name
          return (
            <option key={c.name} value={c.name}>
              {optionLabel}
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
