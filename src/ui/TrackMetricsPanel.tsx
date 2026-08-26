// Track metrics: the extremes, the span, the point accounting, and the
// metadata parsers already capture.
//
// Everything here is read from `computeStats` and `dataset.metadata` rather
// than recomputed. `metadata.meta` in particular is populated by four parsers
// (GPX creator, EAG platform/exercise/mission, GPB track name) and until now
// had no consumer at all — it was parsed, stored, and never shown.

import { useMemo } from 'react'
import type { Dataset } from '../core/model'
import { computeStats, formatDistance, formatDuration } from '../core/stats'
import { epochMsToIso, formatBytes } from '../core/format'

interface Props {
  dataset: Dataset
}

/**
 * Provenance flags worth surfacing, in the order they read as a story: what
 * was interpolated, what was corrected, what the source itself questioned.
 * Any flag not listed here still appears, just after these.
 */
const KNOWN_FLAG_LABELS: Record<string, string> = {
  interpolated: 'Interpolated',
  hampel_corrected: 'Hampel-corrected elevation',
  ema_smoothed: 'EMA-smoothed elevation',
  time_dejittered: 'De-jittered timestamp',
}

export function TrackMetricsPanel({ dataset }: Props) {
  const stats = useMemo(() => computeStats(dataset), [dataset])

  const flagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const point of dataset.points) {
      for (const flag of point.provenance?.qualityFlags ?? []) counts.set(flag, (counts.get(flag) ?? 0) + 1)
    }
    const known = Object.keys(KNOWN_FLAG_LABELS).filter((flag) => counts.has(flag))
    const rest = [...counts.keys()].filter((flag) => !(flag in KNOWN_FLAG_LABELS)).sort()
    return [...known, ...rest].map((flag) => ({ flag, label: KNOWN_FLAG_LABELS[flag] ?? flag, count: counts.get(flag)! }))
  }, [dataset.points])

  const metadataRows = useMemo(() => buildMetadataRows(dataset), [dataset])

  // Records the parser refused before the dataset existed. These cannot be
  // recovered from the points themselves, which is why parsers report them
  // as structured counts rather than only as prose in `warnings`.
  const droppedRows = useMemo(() => Object.entries(dataset.droppedCounts ?? {})
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => ({ label: humanizeReason(reason), value: count.toLocaleString() })), [dataset.droppedCounts])
  const droppedTotal = useMemo(() => Object.values(dataset.droppedCounts ?? {}).reduce((total, count) => total + count, 0), [dataset.droppedCounts])
  const sourceOffered = dataset.points.length + droppedTotal

  const speed = stats.speed
  const elevation = stats.elevation

  return <section className="stats-block track-metrics">
    <h3>Track metrics</h3>

    <div className="metric-grid">
      <Metric label="Elapsed" value={formatDuration(stats.durationMs)} />
      <Metric label="Distance" value={formatDistance(stats.distanceMeters)} />
      <Metric label="Max speed" value={speed ? `${speed.maxMps.toFixed(1)} m/s` : '—'} />
      <Metric label="Min speed" value={speed ? `${speed.minMps.toFixed(1)} m/s` : '—'} />
      <Metric label="Max altitude" value={elevation ? `${elevation.max.toFixed(0)} m` : '—'} />
      <Metric label="Min altitude" value={elevation ? `${elevation.min.toFixed(0)} m` : '—'} />
    </div>

    <div className="metrics-columns">
      <div>
        <h4>Time span</h4>
        <table className="compact-table mono small"><tbody>
          <Row label="start" value={stats.startTime !== null ? epochMsToIso(stats.startTime) : '—'} />
          <Row label="stop" value={stats.endTime !== null ? epochMsToIso(stats.endTime) : '—'} />
          <Row label="elapsed" value={formatDuration(stats.durationMs)} />
          <Row label="avg rate" value={stats.sampleRateHz ? `${stats.sampleRateHz.toFixed(3)} Hz` : '—'} />
          <Row label="ordering" value={stats.timeMonotonic ? 'ascending' : 'out of order'} />
        </tbody></table>
      </div>

      <div>
        <h4>Point accounting</h4>
        <table className="compact-table mono small"><tbody>
          <Row label="total" value={stats.pointCount.toLocaleString()} />
          <Row label="valid coordinates" value={stats.validCoordCount.toLocaleString()} />
          <Row label="invalid coordinates" value={stats.invalidCoordCount.toLocaleString()} />
          <Row label="with timestamp" value={`${stats.withTime.toLocaleString()} of ${stats.pointCount.toLocaleString()}`} />
          <Row label="with elevation" value={`${stats.withElevation.toLocaleString()} of ${stats.pointCount.toLocaleString()}`} />
          <Row label="duplicate coordinates" value={stats.duplicateCoords.toLocaleString()} />
          {flagCounts.map((entry) => <Row key={entry.flag} label={entry.label.toLowerCase()} value={entry.count.toLocaleString()} />)}
        </tbody></table>
        {droppedRows.length > 0 && <>
          <h4>Dropped at import</h4>
          <table className="compact-table mono small"><tbody>
            {droppedRows.map((row) => <Row key={row.label} label={row.label} value={row.value} />)}
            <Row label="total offered by source" value={sourceOffered.toLocaleString()} />
          </tbody></table>
        </>}
        <p className="muted small">
          Counts above the import section describe the track as it stands now, after any applied
          operations.
        </p>
      </div>
    </div>

    <h4>Metadata detected</h4>
    {metadataRows.length === 0
      ? <p className="muted small">No metadata was detected in this source.</p>
      : <table className="compact-table mono small"><tbody>{metadataRows.map((row) => <Row key={row.label} label={row.label} value={row.value} />)}</tbody></table>}

    {speed && <p className="muted small">
      Speed is derived from great-circle distance over sample time. A recorded speed channel, if
      the source carries one, is listed separately in the channel table and can legitimately
      differ.
    </p>}
  </section>
}

interface MetadataRow { label: string; value: string }

function buildMetadataRows(dataset: Dataset): MetadataRow[] {
  const rows: MetadataRow[] = []
  const metadata = dataset.metadata
  const source = metadata?.source

  if (source) {
    rows.push({ label: 'file', value: source.filename })
    if (source.byteLength !== undefined) rows.push({ label: 'size', value: formatBytes(source.byteLength) })
    rows.push({ label: 'parser', value: `${source.parserId} v${source.parserVersion}` })
    rows.push({ label: 'imported', value: epochMsToIso(source.importedAt) })
  } else {
    rows.push({ label: 'format', value: dataset.sourceFormat })
  }

  if (metadata) {
    rows.push({ label: 'coordinate system', value: metadata.coordinateSystem })
    rows.push({ label: 'altitude reference', value: metadata.altitudeReference })
    rows.push({ label: 'time reference', value: metadata.timeReference })
  }

  // Format-specific header fields: GPX creator, EAG platform/exercise/mission,
  // GPB track name. Sorted so the order does not depend on parser internals.
  for (const key of Object.keys(metadata?.meta ?? {}).sort()) {
    const value = metadata!.meta![key]
    if (value !== undefined && value !== '') rows.push({ label: key, value })
  }

  return rows
}

/** `invalidCoordinate` reads better as "invalid coordinate" in a table cell. */
function humanizeReason(reason: string): string {
  return reason.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase()
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><span className="metric-value">{value}</span><span className="metric-label">{label}</span></div>
}

function Row({ label, value }: { label: string; value: string }) {
  return <tr><td className="q-label">{label}</td><td>{value}</td></tr>
}
