import {
  advancePlayback,
  clampNow,
  clampSpeed,
  computeTimeRange,
  createPlaybackState,
  seekTo,
  selectedPairOf,
  setPlaying,
  setTrackColor,
  setTrackVisible,
  toggleTrackForPair,
  type PlaybackTrack,
} from '../src/playback/PlaybackState'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const trackA: PlaybackTrack = { id: 'a', name: 'Alpha', color: '#ea4f2f', visible: true, points: [{ lat: 0, lon: 0, time: 0 }, { lat: 0, lon: 1, time: 10_000 }] }
const trackB: PlaybackTrack = { id: 'b', name: 'Bravo', color: '#3b82f6', visible: true, points: [{ lat: 0, lon: 0, time: 5_000 }, { lat: 0, lon: 1, time: 20_000 }] }
const trackNoTime: PlaybackTrack = { id: 'c', name: 'Charlie', color: '#eab308', visible: true, points: [{ lat: 0, lon: 0 }] }

// --- computeTimeRange / createPlaybackState ---
const range = computeTimeRange([trackA, trackB])
check('computeTimeRange finds the earliest start across tracks', range.startMs === 0)
check('computeTimeRange finds the latest end across tracks', range.endMs === 20_000)
check('computeTimeRange ignores points with no timestamp', computeTimeRange([trackNoTime]).startMs === null)

const initial = createPlaybackState([trackA, trackB])
check('createPlaybackState starts paused', initial.playing === false)
check('createPlaybackState starts the clock at the earliest timestamp', initial.nowMs === 0)
check('createPlaybackState starts with no pair selected', initial.selectedIds.length === 0)

// --- clampSpeed / clampNow ---
check('clampSpeed rejects non-finite input, falls back to default', clampSpeed(NaN) === 1)
check('clampSpeed clamps below the minimum', clampSpeed(0) > 0)
check('clampSpeed clamps above the maximum', clampSpeed(1_000) <= 60)
check('clampNow clamps below the start', clampNow({ startMs: 0, endMs: 100 }, -50) === 0)
check('clampNow clamps above the end', clampNow({ startMs: 0, endMs: 100 }, 150) === 100)
check('clampNow passes through unclamped when no range is known', clampNow({ startMs: null, endMs: null }, -50) === -50)

// --- advancePlayback ---
const playing = setPlaying(initial, true)
check('setPlaying(true) sets playing', playing.playing === true)
const advanced = advancePlayback(playing, 5_000)
check('advancePlayback moves the clock forward by deltaMs * speed', advanced.nowMs === 5_000)
const advancedPastEnd = advancePlayback(playing, 999_999)
check('advancePlayback clamps to the end rather than overshooting', advancedPastEnd.nowMs === 20_000)
check('advancePlayback stops playing once it reaches the end', advancedPastEnd.playing === false)
check('advancePlayback is a no-op while paused', advancePlayback(initial, 5_000).nowMs === initial.nowMs)

const atEnd = { ...initial, nowMs: 20_000 }
const restarted = setPlaying(atEnd, true)
check('setPlaying(true) at the end restarts from the beginning rather than doing nothing', restarted.nowMs === 0 && restarted.playing === true)

// --- seekTo ---
check('seekTo clamps into the known range', seekTo(initial, 999_999).nowMs === 20_000)

// --- setTrackVisible / setTrackColor ---
const hidden = setTrackVisible(initial, 'a', false)
check('setTrackVisible toggles only the targeted track', hidden.tracks.find((t) => t.id === 'a')?.visible === false && hidden.tracks.find((t) => t.id === 'b')?.visible === true)
const recolored = setTrackColor(initial, 'a', '#123456')
check('setTrackColor accepts a valid hex color', recolored.tracks.find((t) => t.id === 'a')?.color === '#123456')
const rejectedColor = setTrackColor(initial, 'a', 'not-a-color')
check('setTrackColor rejects a malformed color, leaving state unchanged', rejectedColor.tracks.find((t) => t.id === 'a')?.color === trackA.color)

// --- toggleTrackForPair / selectedPairOf ---
check('selectedPairOf is null with 0 selected', selectedPairOf(initial) === null)
const oneSelected = toggleTrackForPair(initial, 'a')
check('toggleTrackForPair adds the first selection', oneSelected.selectedIds.length === 1)
check('selectedPairOf is still null with 1 selected', selectedPairOf(oneSelected) === null)
const twoSelected = toggleTrackForPair(oneSelected, 'b')
check('toggleTrackForPair adds the second selection', twoSelected.selectedIds.length === 2)
const pair = selectedPairOf(twoSelected)
check('selectedPairOf returns both ids once two are selected', pair !== null && pair[0] === 'a' && pair[1] === 'b')
const deselected = toggleTrackForPair(twoSelected, 'a')
check('toggleTrackForPair removes an already-selected id', deselected.selectedIds.length === 1 && deselected.selectedIds[0] === 'b')
check('toggleTrackForPair ignores an id not in state.tracks', toggleTrackForPair(initial, 'nonexistent').selectedIds.length === 0)

console.log(`\n${failures === 0 ? 'ALL PLAYBACK STATE CHECKS PASSED' : `${failures} PLAYBACK STATE CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
