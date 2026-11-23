import { MAX_PLAYBACK_SPEED, MIN_PLAYBACK_SPEED } from './PlaybackState'

interface Props {
  startMs: number | null
  endMs: number | null
  nowMs: number
  playing: boolean
  speed: number
  onSeek: (nowMs: number) => void
  onPlayingChange: (playing: boolean) => void
  onSpeedChange: (speed: number) => void
}

export function PlaybackControl({ startMs, endMs, nowMs, playing, speed, onSeek, onPlayingChange, onSpeedChange }: Props) {
  const hasRange = startMs !== null && endMs !== null && endMs > startMs
  return (
    <div className="playback-control">
      <button type="button" onClick={() => onPlayingChange(!playing)} disabled={!hasRange}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <input
        type="range"
        aria-label="Playback position"
        min={startMs ?? 0}
        max={endMs ?? 0}
        value={nowMs}
        step="any"
        disabled={!hasRange}
        onChange={(event) => onSeek(Number(event.target.value))}
      />
      <span className="mono small">{formatClock(nowMs, startMs)}</span>
      <label className="num-field">
        <span>speed</span>
        <input
          type="number"
          min={MIN_PLAYBACK_SPEED}
          max={MAX_PLAYBACK_SPEED}
          step={0.1}
          value={speed}
          onChange={(event) => onSpeedChange(Number(event.target.value))}
        />
        <span>×</span>
      </label>
    </div>
  )
}

function formatClock(nowMs: number, startMs: number | null): string {
  if (startMs === null) return '—'
  const elapsedS = Math.max(0, (nowMs - startMs) / 1000)
  const h = Math.floor(elapsedS / 3600)
  const m = Math.floor((elapsedS % 3600) / 60)
  const s = Math.floor(elapsedS % 60)
  return `T+${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}
