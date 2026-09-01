// Single-point value editing against the chart's existing point selection.
//
// Fields render read-only by default; a pencil unlocks them. The first unlock
// per dataset shows a warning box the user must acknowledge — later unlocks
// within the same dataset skip it, since the pencil-to-checkmark gesture
// carries the intent from there on. A checkmark commits through the same
// operation/undo pipeline as any Transform-tab card (via `onEditPoint`), so
// the edit shows up in history and can be undone like any other transform.

import { useRef, useState } from 'react'
import type { Dataset, TrackPoint } from '../core/model'
import { epochMsToIso, parseCoordinate, parseNumber, parseTimeToEpochMs } from '../core/format'
import { usePointSelection } from '../state/pointSelection'
import type { EditablePointExt, EditPointFields } from '../core/operations/edit-point'

interface Props {
  dataset: Dataset
  onEditPoint: (index: number, fields: EditPointFields) => void
}

type ScalarField = 'lat' | 'lon' | 'ele' | 'time' | 'name' | 'desc'
const SCALAR_FIELDS: { field: ScalarField; label: string }[] = [
  { field: 'lat', label: 'Latitude' },
  { field: 'lon', label: 'Longitude' },
  { field: 'ele', label: 'Elevation (m)' },
  { field: 'time', label: 'Time (UTC)' },
  { field: 'name', label: 'Name' },
  { field: 'desc', label: 'Description' },
]

export function PointInspectorPanel({ dataset, onEditPoint }: Props) {
  const { pointIndex } = usePointSelection(dataset.points)
  const [unlocked, setUnlocked] = useState(false)
  const [showWarning, setShowWarning] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const acknowledged = useRef<Set<string>>(new Set())

  const point = pointIndex === null ? null : dataset.points[pointIndex] ?? null

  // Drop any in-progress edit when the selection or dataset changes underneath the panel.
  // Adjusted during render (React's documented pattern for reacting to a changed prop, matching
  // TimeSeriesChart's jump/mismatch handling) rather than in an effect, so the reset lands in the
  // same commit instead of a visible extra render.
  const selectionKey = `${dataset.id}:${pointIndex ?? 'none'}`
  const [lastSelectionKey, setLastSelectionKey] = useState(selectionKey)
  if (selectionKey !== lastSelectionKey) {
    setLastSelectionKey(selectionKey)
    setUnlocked(false)
    setShowWarning(false)
    setDraft({})
    setError(null)
  }

  if (point === null || pointIndex === null) return null

  const beginEdit = () => {
    if (!acknowledged.current.has(dataset.id)) { setShowWarning(true); return }
    setDraft(draftFromPoint(point))
    setUnlocked(true)
  }

  const acknowledgeAndEdit = () => {
    acknowledged.current.add(dataset.id)
    setShowWarning(false)
    setDraft(draftFromPoint(point))
    setUnlocked(true)
  }

  const cancel = () => {
    setUnlocked(false)
    setShowWarning(false)
    setDraft({})
    setError(null)
  }

  const commit = () => {
    const { fields, errors } = fieldsFromDraft(point, draft)
    if (errors.length > 0) { setError(errors.join('; ')); return }
    if (Object.keys(fields).length === 0) { cancel(); return }
    onEditPoint(pointIndex, fields)
    setUnlocked(false)
    setDraft({})
    setError(null)
  }

  const extEntries = Object.entries(point.ext ?? {})
  const staleChannels = new Set(point.provenance?.staleChannels ?? [])

  return (
    <div className="point-inspector point-detail">
      <header className="point-inspector-head">
        <h4>Point #{pointIndex}</h4>
        {!unlocked && <button type="button" className="chip" onClick={beginEdit} title="Edit this point">✎ Edit</button>}
        {unlocked && <>
          <button type="button" className="chip" onClick={commit} title="Apply changes">✓ Apply</button>
          <button type="button" className="chip" onClick={cancel} title="Cancel edit">Cancel</button>
        </>}
      </header>

      {showWarning && (
        <div className="point-inspector-warning" role="alert">
          <p>
            Editing writes real values into this track. The change is recorded as an undoable
            operation, but a derived channel (like speed or heading) that depends on a field you
            change here is not automatically recomputed.
          </p>
          <div className="point-inspector-warning-actions">
            <button type="button" className="primary-action" onClick={acknowledgeAndEdit}>Understood, unlock fields</button>
            <button type="button" onClick={() => setShowWarning(false)}>Cancel</button>
          </div>
        </div>
      )}

      {error && <p className="warn small">{error}</p>}

      <dl className="point-fields">
        {SCALAR_FIELDS.map(({ field, label }) => (
          <ScalarRow
            key={field}
            label={label}
            field={field}
            point={point}
            unlocked={unlocked}
            value={draft[field] ?? ''}
            onChange={(value) => setDraft((current) => ({ ...current, [field]: value }))}
          />
        ))}
      </dl>

      {extEntries.length > 0 && (
        <details className="point-channels" open>
          <summary>Channels ({extEntries.length})</summary>
          <dl className="point-fields">
            {extEntries.map(([channel, original]) => (
              <ExtRow
                key={channel}
                channel={channel}
                original={original}
                unlocked={unlocked}
                stale={staleChannels.has(channel)}
                value={draft[extKey(channel)] ?? ''}
                onChange={(value) => setDraft((current) => ({ ...current, [extKey(channel)]: value }))}
              />
            ))}
          </dl>
        </details>
      )}
    </div>
  )
}

function ScalarRow({ label, field, point, unlocked, value, onChange }: {
  label: string
  field: ScalarField
  point: TrackPoint
  unlocked: boolean
  value: string
  onChange: (value: string) => void
}) {
  if (!unlocked) return <><dt>{label}</dt><dd className="mono">{displayScalar(point, field)}</dd></>
  return <><dt>{label}</dt><dd><input className="mono" type="text" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} /></dd></>
}

function ExtRow({ channel, original, unlocked, stale, value, onChange }: {
  channel: string
  original: number | string | boolean
  unlocked: boolean
  stale: boolean
  value: string
  onChange: (value: string) => void
}) {
  const label = <>{channel}{stale && <StaleBadge />}</>
  if (!unlocked) return <><dt>{label}</dt><dd className="mono">{String(original)}</dd></>
  if (typeof original === 'boolean') {
    return <><dt>{label}</dt><dd><input type="checkbox" checked={value === 'true'} onChange={(event) => onChange(String(event.target.checked))} aria-label={channel} /></dd></>
  }
  return <><dt>{label}</dt><dd><input className="mono" type="text" value={value} onChange={(event) => onChange(event.target.value)} aria-label={channel} /></dd></>
}

function StaleBadge() {
  return (
    <span
      className="badge stale-badge"
      title="Computed before a manual edit changed one of its inputs. Re-run Derive kinematics to refresh it."
    >
      stale
    </span>
  )
}

function displayScalar(point: TrackPoint, field: ScalarField): string {
  switch (field) {
    case 'lat': return String(point.lat)
    case 'lon': return String(point.lon)
    case 'ele': return point.ele === undefined ? '—' : String(point.ele)
    case 'time': return point.time === undefined ? '—' : epochMsToIso(point.time)
    case 'name': return point.name ?? '—'
    case 'desc': return point.desc ?? '—'
  }
}

function draftFromPoint(point: TrackPoint): Record<string, string> {
  const draft: Record<string, string> = {
    lat: String(point.lat),
    lon: String(point.lon),
    ele: point.ele === undefined ? '' : String(point.ele),
    time: point.time === undefined ? '' : epochMsToIso(point.time),
    name: point.name ?? '',
    desc: point.desc ?? '',
  }
  for (const [channel, value] of Object.entries(point.ext ?? {})) draft[extKey(channel)] = String(value)
  return draft
}

function extKey(channel: string): string { return `ext:${channel}` }

function fieldsFromDraft(point: TrackPoint, draft: Record<string, string>): { fields: EditPointFields; errors: string[] } {
  const fields: EditPointFields = {}
  const errors: string[] = []

  const latText = (draft.lat ?? '').trim()
  if (latText) {
    const lat = parseCoordinate(latText)
    if (lat === null) errors.push('Latitude could not be parsed')
    else if (lat !== point.lat) fields.lat = lat
  }

  const lonText = (draft.lon ?? '').trim()
  if (lonText) {
    const lon = parseCoordinate(lonText)
    if (lon === null) errors.push('Longitude could not be parsed')
    else if (lon !== point.lon) fields.lon = lon
  }

  const eleText = (draft.ele ?? '').trim()
  if (eleText) {
    const ele = parseNumber(eleText)
    if (ele === null) errors.push('Elevation could not be parsed')
    else if (ele !== point.ele) fields.ele = ele
  }

  const timeText = (draft.time ?? '').trim()
  if (timeText) {
    const time = parseTimeToEpochMs(timeText, 'iso')
    if (time === null) errors.push('Time could not be parsed')
    else if (time !== point.time) fields.time = time
  }

  if ((draft.name ?? '') !== (point.name ?? '')) fields.name = draft.name ?? ''
  if ((draft.desc ?? '') !== (point.desc ?? '')) fields.desc = draft.desc ?? ''

  const ext: EditablePointExt = {}
  let extChanged = false
  for (const [channel, original] of Object.entries(point.ext ?? {})) {
    const raw = draft[extKey(channel)]
    if (raw === undefined) continue
    const next = coerceExtValue(raw, original)
    if (next !== original) { ext[channel] = next; extChanged = true }
  }
  if (extChanged) fields.ext = ext

  return { fields, errors }
}

function coerceExtValue(raw: string, original: number | string | boolean): number | string | boolean {
  if (typeof original === 'boolean') return raw === 'true'
  if (typeof original === 'number') { const parsed = parseNumber(raw); return parsed ?? original }
  return raw
}
