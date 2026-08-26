// Dataset overview: headline metrics, quality review, channel statistics, and
// Phase 1 time/segment selection controls.
import { useMemo, useState } from 'react'
import type { Dataset } from '../core/model'
import { computeStats, formatDistance, formatDuration } from '../core/stats'
import { epochMsToIso } from '../core/format'
import { segmentTrack } from '../core/analytics/segments'
import { detectQualityEvents, type QualityEventKind } from '../core/quality/events'
import { usePointSelection } from '../state/pointSelection'
import { SelectionChip } from './SelectionChip'
import type { ProjectBookmark } from '../persistence/project/manifest'

interface Props {
  dataset: Dataset
  bookmarks: ProjectBookmark[]
  onBookmarksChange: (next: ProjectBookmark[]) => void
}

export function StatsPanel({ dataset, bookmarks, onBookmarksChange }: Props) {
  const stats = useMemo(() => computeStats(dataset), [dataset])
  const segments = useMemo(() => segmentTrack(dataset.points), [dataset.points])
  const qualityEvents = useMemo(() => detectQualityEvents(dataset.points), [dataset.points])
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const { pointIndex, timeRange, segmentIds, selectPoint, selectTimeRange, selectSegment, clearRange } = usePointSelection(dataset.points)
  const quality = useMemo(() => [
    { label: 'Coordinate validity', ok: stats.invalidCoordCount === 0, detail: `${stats.validCoordCount.toLocaleString()} valid / ${stats.invalidCoordCount.toLocaleString()} invalid` },
    { label: 'Timestamps present', ok: stats.withTime > 0, detail: `${stats.withTime.toLocaleString()} of ${stats.pointCount.toLocaleString()} points timed` },
    { label: 'Time monotonic', ok: stats.timeMonotonic, detail: stats.timeMonotonic ? 'ascending' : 'out-of-order timestamps detected (sort recommended)' },
    { label: 'Elevation present', ok: stats.withElevation > 0, detail: `${stats.withElevation.toLocaleString()} points with elevation` },
    { label: 'Duplicate coordinates', ok: stats.duplicateCoords === 0, detail: `${stats.duplicateCoords.toLocaleString()} consecutive duplicates` },
  ], [stats])
  const startMs = Date.parse(startTime)
  const endMs = Date.parse(endTime)

  return <div className="stats-panel">
    <div className="metric-grid"><Metric label="Points" value={stats.pointCount.toLocaleString()} /><Metric label="Valid coords" value={stats.validCoordCount.toLocaleString()} /><Metric label="Distance" value={formatDistance(stats.distanceMeters)} /><Metric label="Duration" value={formatDuration(stats.durationMs)} /><Metric label="Avg rate" value={stats.sampleRateHz ? `${stats.sampleRateHz.toFixed(2)} Hz` : '—'} /><Metric label="Max speed" value={stats.speed ? `${stats.speed.maxMps.toFixed(1)} m/s` : '—'} /><Metric label="Elev gain" value={stats.elevation ? `${stats.elevation.gain.toFixed(0)} m` : '—'} /><Metric label="Elev range" value={stats.elevation ? `${stats.elevation.min.toFixed(0)}–${stats.elevation.max.toFixed(0)} m` : '—'} /></div>
    <ImportSummary dataset={dataset} />
    <BookmarksSection dataset={dataset} bookmarks={bookmarks} onBookmarksChange={onBookmarksChange} pointIndex={pointIndex} onJump={selectPoint} />
    <section className="stats-block selection-controls"><h3>Selection controls</h3><div className="selection-time-controls"><label>Start time<input type="datetime-local" step="0.001" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label><label>End time<input type="datetime-local" step="0.001" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label><button type="button" disabled={!Number.isFinite(startMs) || !Number.isFinite(endMs)} onClick={() => selectTimeRange({ startMs, endMs })}>Select time range</button>{timeRange && <SelectionChip label={`${epochMsToIso(timeRange.startMs)} → ${epochMsToIso(timeRange.endMs)}`} tone="range" onClear={clearRange} clearLabel="Clear time range selection" />}</div><div className="segment-list">{segments.map((segment) => <button key={segment.id} type="button" className={`segment-chip${segmentIds.includes(segment.id) ? ' active' : ''}`} onClick={() => selectSegment(segment.id, { start: segment.startIndex, end: segment.endIndex })}><strong>{segment.kind}</strong><span>#{segment.startIndex}–{segment.endIndex}</span><span>{segment.pointCount} pts</span></button>)}{segments.length === 0 && <span className="muted small">No segments available.</span>}</div><p className="muted small">Keyboard: ←/→ moves the synchronized cursor, Shift+←/→ extends a range, Enter selects the cursor point, Home/End jumps, Escape clears.</p></section>
    <div className="stats-columns">
      <section className="stats-block"><h3>Data quality</h3><ul className="quality-list">{quality.map((item) => <li key={item.label} className={item.ok ? 'q-ok' : 'q-warn'}><span className="q-icon">{item.ok ? '✓' : '!'}</span><span className="q-label">{item.label}</span><span className="q-detail">{item.detail}</span></li>)}</ul><QualityEventSummary events={qualityEvents} />{stats.startTime !== null && <p className="muted mono small">{epochMsToIso(stats.startTime)} → {epochMsToIso(stats.endTime ?? undefined)}</p>}{stats.bounds && <p className="muted mono small">bbox [{stats.bounds.minLat.toFixed(5)}, {stats.bounds.minLon.toFixed(5)}] → [{stats.bounds.maxLat.toFixed(5)}, {stats.bounds.maxLon.toFixed(5)}]</p>}{dataset.warnings.length > 0 && <div className="stats-warnings">{dataset.warnings.map((warning, index) => <p key={index} className="warn-line small">⚠ {warning}</p>)}</div>}</section>
      <section className="stats-block"><h3>Channels ({stats.channels.length})</h3>{stats.channels.length === 0 && <p className="muted small">No extension channels.</p>}{stats.channels.length > 0 && <table className="channel-table mono"><thead><tr><th>channel</th><th>n</th><th>min</th><th>max</th><th>mean</th><th>σ</th></tr></thead><tbody>{stats.channels.map((channel) => <tr key={channel.key}><td>{channel.key}{channel.unit ? <span className="unit"> {channel.unit}</span> : null}</td><td>{channel.numericCount}</td><td>{fmt(channel.min)}</td><td>{fmt(channel.max)}</td><td>{fmt(channel.mean)}</td><td>{fmt(channel.stddev)}</td></tr>)}</tbody></table>}</section>
    </div>
  </div>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric-card"><span className="metric-value">{value}</span><span className="metric-label">{label}</span></div> }
function ImportSummary({ dataset }: { dataset: Dataset }) {
  const source = dataset.metadata?.source
  if (!source) return null
  const checksumShort = source.checksum ? `${source.checksum.slice(0, 12)}…` : 'not computed'
  return <section className="stats-block source-summary">
    <h3>Import summary</h3>
    <ul className="source-fields mono small">
      <li><span className="q-label">file</span> {source.filename}{source.byteLength !== undefined ? ` (${(source.byteLength / 1024).toFixed(1)} KB)` : ''}</li>
      <li><span className="q-label">accepted / warnings</span> {dataset.points.length.toLocaleString()} points / {dataset.warnings.length} warning(s)</li>
      <li><span className="q-label">checksum</span> <span title={source.checksum ?? ''}>sha256:{checksumShort}</span></li>
      <li><span className="q-label">parser</span> {source.parserId} v{source.parserVersion}</li>
      <li><span className="q-label">references</span> coord {dataset.metadata?.coordinateSystem}, alt {dataset.metadata?.altitudeReference}, time {dataset.metadata?.timeReference}</li>
    </ul>
  </section>
}
function BookmarksSection({ dataset, bookmarks, onBookmarksChange, pointIndex, onJump }: {
  dataset: Dataset
  bookmarks: ProjectBookmark[]
  onBookmarksChange: (next: ProjectBookmark[]) => void
  pointIndex: number | null
  onJump: (pointIndex: number | null) => void
}) {
  const [label, setLabel] = useState('')
  const datasetBookmarks = bookmarks.filter((bookmark) => bookmark.datasetId === dataset.id)

  const addBookmark = () => {
    if (pointIndex === null) return
    const point = dataset.points[pointIndex]
    const bookmark: ProjectBookmark = {
      id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: label.trim() || `Point #${pointIndex}`,
      datasetId: dataset.id,
      pointIndex,
      timeMs: point?.time,
    }
    onBookmarksChange([...bookmarks, bookmark])
    setLabel('')
  }

  const removeBookmark = (id: string) => onBookmarksChange(bookmarks.filter((bookmark) => bookmark.id !== id))

  return (
    <section className="stats-block bookmarks-section">
      <h3>Bookmarks ({datasetBookmarks.length})</h3>
      <div className="bookmark-add">
        <input placeholder={pointIndex === null ? 'Select a point to bookmark it' : `Label (default: Point #${pointIndex})`} value={label} onChange={(event) => setLabel(event.target.value)} disabled={pointIndex === null} />
        <button type="button" disabled={pointIndex === null} onClick={addBookmark}>Bookmark current point</button>
      </div>
      {datasetBookmarks.length === 0
        ? <p className="muted small">No bookmarks yet for this dataset.</p>
        : <ul className="bookmark-list">
          {datasetBookmarks.map((bookmark) => (
            <li key={bookmark.id}>
              <button type="button" className="bookmark-jump" onClick={() => bookmark.pointIndex !== undefined && onJump(bookmark.pointIndex)}>{bookmark.label}</button>
              <span className="muted small mono">{bookmark.pointIndex !== undefined ? `#${bookmark.pointIndex}` : ''} {bookmark.timeMs !== undefined ? epochMsToIso(bookmark.timeMs) : ''}</span>
              <button type="button" className="bookmark-remove" onClick={() => removeBookmark(bookmark.id)} aria-label={`Remove bookmark ${bookmark.label}`}>×</button>
            </li>
          ))}
        </ul>}
    </section>
  )
}

function fmt(value: number | null): string { if (value === null || !Number.isFinite(value)) return '—'; if (Number.isInteger(value)) return String(value); if (Math.abs(value) >= 1000) return value.toFixed(0); if (Math.abs(value) >= 1) return value.toFixed(2); return value.toFixed(4) }
function QualityEventSummary({ events }: { events: ReturnType<typeof detectQualityEvents> }) { const labels: Record<QualityEventKind, string> = { gap: 'gaps', 'duplicate-timestamp': 'duplicate timestamps', 'coordinate-jump': 'coordinate jumps', 'invalid-coordinate': 'invalid coordinates', 'elevation-spike': 'elevation spikes', 'elevation-flatline': 'elevation flatlines' }; const counts = events.reduce<Partial<Record<QualityEventKind, number>>>((result, event) => ({ ...result, [event.kind]: (result[event.kind] ?? 0) + 1 }), {}); return <div className="quality-events"><strong>Detected events: {events.length}</strong>{events.length === 0 ? <span className="muted small"> No additional timing or coordinate events detected.</span> : <ul>{(Object.entries(counts) as Array<[QualityEventKind, number]>).map(([kind, count]) => <li key={kind}>{count} {labels[kind]}</li>)}</ul>}</div> }
