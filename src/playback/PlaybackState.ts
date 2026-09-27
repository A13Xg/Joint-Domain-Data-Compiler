// Pure state machine for the Playback app: which tracks are loaded, the
// current playback clock, and per-track visibility/selection. No React,
// same separation `workspaceDisplay.ts` and `state/workspace.ts` follow —
// testable without rendering anything.
import type { Dataset } from '../core/model'

export interface PlaybackTrack {
  id: string
  name: string
  callsign?: string
  aircraftType?: string
  color: string
  visible: boolean
  points: Dataset['points']
}

export interface PlaybackState {
  tracks: PlaybackTrack[]
  /** Earliest/latest observed timestamp across all loaded tracks; null when no track has any timed point. */
  startMs: number | null
  endMs: number | null
  nowMs: number
  playing: boolean
  /** Playback speed multiplier; always > 0. */
  speed: number
  /** 0-2 track ids selected for the range/bearing/closure-rate metrics panel, in selection order. */
  selectedIds: string[]
}

/** The metrics panel only has something to show once exactly two tracks are selected. */
export function selectedPairOf(state: Pick<PlaybackState, 'selectedIds'>): [string, string] | null {
  return state.selectedIds.length === 2 ? [state.selectedIds[0]!, state.selectedIds[1]!] : null
}

export const DEFAULT_PLAYBACK_SPEED = 1
export const MIN_PLAYBACK_SPEED = 0.1
export const MAX_PLAYBACK_SPEED = 60

export function computeTimeRange(tracks: readonly PlaybackTrack[]): { startMs: number | null; endMs: number | null } {
  let startMs: number | null = null
  let endMs: number | null = null
  for (const track of tracks) {
    for (const point of track.points) {
      if (point.time === undefined) continue
      if (startMs === null || point.time < startMs) startMs = point.time
      if (endMs === null || point.time > endMs) endMs = point.time
    }
  }
  return { startMs, endMs }
}

export function createPlaybackState(tracks: PlaybackTrack[]): PlaybackState {
  const { startMs, endMs } = computeTimeRange(tracks)
  return {
    tracks,
    startMs,
    endMs,
    nowMs: startMs ?? 0,
    playing: false,
    speed: DEFAULT_PLAYBACK_SPEED,
    selectedIds: [],
  }
}

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return DEFAULT_PLAYBACK_SPEED
  return Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, speed))
}

export function clampNow(state: Pick<PlaybackState, 'startMs' | 'endMs'>, nowMs: number): number {
  if (state.startMs === null || state.endMs === null) return nowMs
  return Math.min(state.endMs, Math.max(state.startMs, nowMs))
}

/** Advances the clock by `deltaMs` of wall time at the current speed; stops at the end rather than looping. */
export function advancePlayback(state: PlaybackState, deltaMs: number): PlaybackState {
  if (!state.playing || state.startMs === null || state.endMs === null) return state
  const nextNow = state.nowMs + deltaMs * state.speed
  if (nextNow >= state.endMs) return { ...state, nowMs: state.endMs, playing: false }
  return { ...state, nowMs: nextNow }
}

export function seekTo(state: PlaybackState, nowMs: number): PlaybackState {
  return { ...state, nowMs: clampNow(state, nowMs) }
}

export function setPlaying(state: PlaybackState, playing: boolean): PlaybackState {
  if (playing && state.startMs !== null && state.nowMs >= state.endMs!) {
    // Restarting from the end plays from the beginning rather than doing nothing.
    return { ...state, playing: true, nowMs: state.startMs }
  }
  return { ...state, playing }
}

export function setTrackVisible(state: PlaybackState, trackId: string, visible: boolean): PlaybackState {
  return { ...state, tracks: state.tracks.map((track) => (track.id === trackId ? { ...track, visible } : track)) }
}

export function setTrackColor(state: PlaybackState, trackId: string, color: string): PlaybackState {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return state
  return { ...state, tracks: state.tracks.map((track) => (track.id === trackId ? { ...track, color } : track)) }
}

/**
 * Click-to-select for the metrics panel: clicking a track already selected
 * removes it; clicking a new one fills an empty slot, or bumps the
 * oldest-selected id out once two are already selected (so the selection is
 * always the two most recently clicked, never grows past two).
 */
export function toggleTrackForPair(state: PlaybackState, trackId: string): PlaybackState {
  if (!state.tracks.some((track) => track.id === trackId)) return state
  if (state.selectedIds.includes(trackId)) {
    return { ...state, selectedIds: state.selectedIds.filter((id) => id !== trackId) }
  }
  const next = [...state.selectedIds, trackId]
  return { ...state, selectedIds: next.length > 2 ? next.slice(next.length - 2) : next }
}
