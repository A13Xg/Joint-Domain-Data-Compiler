// Graph Analysis app: numerical/statistical deep-dive over a `.jddc-playback`
// (or `.jddc-project`) file, loaded and derived the same way as Playback
// (see src/playback/App.tsx and docs/superpowers/specs/2026-09-27-jddc-suite-design.md §2.3, §11).
// No animation — every chart shows the whole loaded time range at once.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import './graph.css'
import { decodePlaybackArchive } from '../persistence/playback'
import type { ProjectArchive } from '../persistence/project/archive'
import { ensureKinematicsChannels } from '../core/analytics/ensureChannels'
import { computePairwiseSeries } from '../core/analytics/pairwise'
import { distributionStats, type DistributionStats } from '../core/analytics/comparisonSummary'
import { extractChartSeries } from '../visualization/charts/series'
import { errorMessage } from '../core/errors'
import { DISPLAY_COLOR_PALETTE } from '../state/workspaceDisplay'
import type { Dataset } from '../core/model'
import { ChartGrid, type ChartSpec } from './ChartGrid'
import { GraphChart } from './GraphChart'

interface GraphTrack {
  id: string
  name: string
  callsign?: string
  color: string
  dataset: Dataset
}

const PER_ENTITY_CHANNELS: Array<{ id: string; label: string; unit: string }> = [
  { id: 'elevation', label: 'Altitude', unit: 'm' },
  { id: 'ground_speed_mps', label: 'Ground speed', unit: 'm/s' },
  { id: 'vertical_speed_mps', label: 'Vertical speed (climb rate)', unit: 'm/s' },
]

function tracksFromArchive(archive: ProjectArchive): GraphTrack[] {
  return archive.manifest.datasets.map((entry, index) => {
    // validateProjectArchive already rejects a manifest whose dataset entries
    // don't each have a matching embedded payload, so this lookup cannot
    // miss for an archive that reached this point.
    const dataset = archive.datasets.find((d) => d.id === entry.id)
    if (!dataset) throw new Error(`Playback archive is missing embedded data for dataset ${entry.id}`)
    return {
      id: entry.id,
      name: entry.name,
      callsign: entry.callsign,
      color: entry.color ?? DISPLAY_COLOR_PALETTE[index % DISPLAY_COLOR_PALETTE.length]!,
      dataset: ensureKinematicsChannels(dataset),
    }
  })
}

function formatTimeMs(x: number): string {
  const date = new Date(x)
  return date.toISOString().slice(11, 19)
}

export default function App() {
  const [tracks, setTracks] = useState<GraphTrack[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const loadArchive = (archive: ProjectArchive) => {
    setTracks(tracksFromArchive(archive))
    setSelectedIds([])
  }

  // Desktop only: receives a scenario the Workbench sent via "Launch Graph"
  // (electron/main.cjs's suite:load/suite:ready handshake) — same
  // decode-and-validate path as a file open. See src/playback/App.tsx's
  // identical wiring for the full rationale.
  useEffect(() => {
    const suite = window.jddcSuite
    if (!suite) return
    suite.onLoad((message) => {
      setLoading(true)
      setError(null)
      decodePlaybackArchive(new Blob([new Uint8Array(message.payload)]))
        .then(loadArchive)
        .catch((cause: unknown) => setError(errorMessage(cause)))
        .finally(() => setLoading(false))
    })
    suite.ready('graph')
  }, [])

  const openFile = async (file: File) => {
    setLoading(true)
    setError(null)
    try {
      loadArchive(await decodePlaybackArchive(file))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((existing) => existing !== id)
      const next = [...current, id]
      return next.length > 2 ? next.slice(next.length - 2) : next
    })
  }

  const perEntityCharts = useMemo<ChartSpec[]>(() => {
    if (!tracks) return []
    return PER_ENTITY_CHANNELS.map((channel) => ({
      title: `${channel.label} over time`,
      xLabel: 'time (UTC)',
      yLabel: channel.unit,
      series: tracks.map((track) => {
        const extracted = extractChartSeries(track.dataset.points, channel.id, 'time')
        return {
          label: track.callsign || track.name,
          color: track.color,
          kind: 'line' as const,
          points: extracted.samples.map((s) => ({ x: s.x, y: s.y })),
        }
      }),
    }))
  }, [tracks])

  const stats = useMemo(() => {
    if (!tracks) return []
    return tracks.map((track) => ({
      track,
      byChannel: PER_ENTITY_CHANNELS.map((channel) => ({
        channel,
        stats: distributionStats(
          track.dataset.points.flatMap((p) => {
            const value = channel.id === 'elevation' ? p.ele : p.ext?.[channel.id]
            return typeof value === 'number' && Number.isFinite(value) ? [value] : []
          }),
        ),
      })),
    }))
  }, [tracks])

  const pair = selectedIds.length === 2 ? tracks?.filter((t) => selectedIds.includes(t.id)) : undefined
  const pairwiseSeries = useMemo(() => {
    if (!pair || pair.length !== 2) return []
    return computePairwiseSeries(pair[0]!.dataset.points, pair[1]!.dataset.points)
  }, [pair])

  return (
    <div className="graph-app">
      <header className="graph-header">
        <h1>JDDC Graph Analysis</h1>
        <button type="button" disabled={loading} onClick={() => inputRef.current?.click()}>
          {loading ? 'Loading…' : 'Open scenario'}
        </button>
        <input
          ref={inputRef}
          className="hidden-input"
          type="file"
          aria-label="Choose a .jddc-playback or .jddc-project file to open"
          accept=".jddc-playback,.jddc-project,.json"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void openFile(file); event.target.value = '' }}
        />
      </header>
      {error && <div className="error-line">{error}</div>}
      {!tracks && !error && <p className="muted">Open a .jddc-playback or .jddc-project file to begin.</p>}

      {tracks && (
        <>
          <ChartGrid charts={perEntityCharts} />

          <h2>Statistical summary</h2>
          <table className="graph-stats-table">
            <thead>
              <tr>
                <th>Entity</th>
                {PER_ENTITY_CHANNELS.map((c) => <th key={c.id} colSpan={3}>{c.label} ({c.unit})</th>)}
              </tr>
              <tr>
                <th />
                {PER_ENTITY_CHANNELS.map((c) => (
                  <Fragment key={c.id}>
                    <th>mean</th>
                    <th>min</th>
                    <th>max</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.map(({ track, byChannel }) => (
                <tr key={track.id}>
                  <td>{track.callsign || track.name}</td>
                  {byChannel.map(({ channel, stats: s }) => <StatCells key={channel.id} stats={s} />)}
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Pairwise (select two entities)</h2>
          <ul className="graph-pair-picker">
            {tracks.map((track) => (
              <li key={track.id}>
                <label>
                  <input type="checkbox" checked={selectedIds.includes(track.id)} onChange={() => toggleSelected(track.id)} />
                  {track.callsign || track.name}
                </label>
              </li>
            ))}
          </ul>
          {pair && pair.length === 2 && (
            pairwiseSeries.length === 0 ? (
              <p className="muted small">Selected entities share no overlapping time range.</p>
            ) : (
              <div className="chart-grid">
                <GraphChart
                  title="Closure rate over time"
                  xLabel="time (UTC)"
                  yLabel="m/s"
                  formatX={formatTimeMs}
                  series={[{
                    label: 'closure rate',
                    color: '#ea4f2f',
                    kind: 'line',
                    points: pairwiseSeries.flatMap((s) => s.metrics.closureRateMps === undefined ? [] : [{ x: s.timeMs, y: s.metrics.closureRateMps }]),
                  }]}
                />
                <GraphChart
                  title="Slant range over time"
                  xLabel="time (UTC)"
                  yLabel="m"
                  formatX={formatTimeMs}
                  series={[{ label: 'slant range', color: '#3b82f6', kind: 'line', points: pairwiseSeries.map((s) => ({ x: s.timeMs, y: s.metrics.slantRangeM })) }]}
                />
                <GraphChart
                  title="Closure rate vs. slant range (correlation)"
                  xLabel="slant range (m)"
                  yLabel="closure rate (m/s)"
                  series={[{
                    label: 'sample',
                    color: '#a855f7',
                    kind: 'scatter',
                    points: pairwiseSeries.flatMap((s) => s.metrics.closureRateMps === undefined ? [] : [{ x: s.metrics.slantRangeM, y: s.metrics.closureRateMps }]),
                  }]}
                />
              </div>
            )
          )}
        </>
      )}
    </div>
  )
}

function StatCells({ stats }: { stats: DistributionStats | undefined }) {
  if (!stats) return <><td>—</td><td>—</td><td>—</td></>
  return <><td>{stats.mean.toFixed(1)}</td><td>{stats.min.toFixed(1)}</td><td>{stats.max.toFixed(1)}</td></>
}
