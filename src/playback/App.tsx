// Playback app: loads a `.jddc-playback` (or `.jddc-project`, ignoring
// history/recipes) file independently of Workbench and animates it. See
// docs/superpowers/specs/2026-09-27-jddc-suite-design.md §2.2, §11.
import { useEffect, useMemo, useRef, useState } from 'react'
import './playback.css'
import { decodePlaybackArchive } from '../persistence/playback'
import type { ProjectArchive } from '../persistence/project/archive'
import { ensureKinematicsChannels } from '../core/analytics/ensureChannels'
import { pairwiseMetricsAtTime } from '../core/analytics/pairwise'
import { errorMessage } from '../core/errors'
import { DISPLAY_COLOR_PALETTE } from '../state/workspaceDisplay'
import {
  advancePlayback,
  createPlaybackState,
  clampSpeed,
  seekTo,
  selectedPairOf,
  setPlaying,
  setTrackColor,
  setTrackVisible,
  toggleTrackForPair,
  type PlaybackState,
  type PlaybackTrack,
} from './PlaybackState'
import { PlaybackControl } from './PlaybackControl'
import { PlaybackRenderer } from './PlaybackRenderer'
import { EntityList } from './EntityList'

function tracksFromArchive(archive: ProjectArchive): PlaybackTrack[] {
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
      aircraftType: entry.aircraftType,
      color: entry.color ?? DISPLAY_COLOR_PALETTE[index % DISPLAY_COLOR_PALETTE.length]!,
      visible: entry.visible,
      points: ensureKinematicsChannels(dataset).points,
    }
  })
}

export default function App() {
  const [state, setState] = useState<PlaybackState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (!state?.playing) {
      lastFrameRef.current = null
      return
    }
    let frame: number
    const tick = (timestamp: number) => {
      const last = lastFrameRef.current
      lastFrameRef.current = timestamp
      if (last !== null) {
        setState((current) => (current ? advancePlayback(current, timestamp - last) : current))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [state?.playing])

  const loadArchive = (archive: ProjectArchive) => {
    setState(createPlaybackState(tracksFromArchive(archive)))
  }

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

  // Desktop only: receives a scenario the Workbench sent via "Launch
  // Playback" (electron/main.cjs's suite:load/suite:ready handshake), using
  // the same decode-and-validate path as a file open — one validation
  // boundary for both entry points, per the design doc's IPC decision.
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
    suite.ready('playback')
  }, [])

  const metrics = useMemo(() => {
    if (!state) return null
    const pair = selectedPairOf(state)
    if (!pair) return null
    const [aId, bId] = pair
    const a = state.tracks.find((t) => t.id === aId)
    const b = state.tracks.find((t) => t.id === bId)
    if (!a || !b) return null
    return { a, b, result: pairwiseMetricsAtTime(a.points, b.points, state.nowMs) }
  }, [state])

  return (
    <div className="playback-app">
      <header className="playback-header">
        <h1>JDDC Playback</h1>
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
      {!state && !error && <p className="muted">Open a .jddc-playback scenario to begin.</p>}
      {state && (
        <>
          <PlaybackRenderer tracks={state.tracks} nowMs={state.nowMs} />
          <PlaybackControl
            startMs={state.startMs}
            endMs={state.endMs}
            nowMs={state.nowMs}
            playing={state.playing}
            speed={state.speed}
            onSeek={(nowMs) => setState((current) => (current ? seekTo(current, nowMs) : current))}
            onPlayingChange={(playing) => setState((current) => (current ? setPlaying(current, playing) : current))}
            onSpeedChange={(speed) => setState((current) => (current ? { ...current, speed: clampSpeed(speed) } : current))}
          />
          <EntityList
            tracks={state.tracks}
            selectedIds={state.selectedIds}
            onVisibleChange={(id, visible) => setState((current) => (current ? setTrackVisible(current, id, visible) : current))}
            onColorChange={(id, color) => setState((current) => (current ? setTrackColor(current, id, color) : current))}
            onSelectForPair={(id) => setState((current) => (current ? toggleTrackForPair(current, id) : current))}
          />
          {metrics && (
            <div className="playback-metrics metric-grid">
              <Metric label="pair" value={`${metrics.a.callsign || metrics.a.name} ↔ ${metrics.b.callsign || metrics.b.name}`} />
              <Metric label="slant range" value={metrics.result ? `${metrics.result.slantRangeM.toFixed(0)} m` : 'unavailable'} />
              <Metric label="bearing" value={metrics.result ? `${metrics.result.bearingDeg.toFixed(1)}°` : 'unavailable'} />
              <Metric
                label="closure rate"
                value={metrics.result?.closureRateMps !== undefined ? `${metrics.result.closureRateMps.toFixed(1)} m/s` : 'unavailable'}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><span className="metric-label">{label}</span><strong className="mono">{value}</strong></div>
}
