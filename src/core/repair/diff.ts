// Before/after point alignment for the repair preview: what a proposed repair
// actually did to a track, derived from the two point arrays alone.
//
// Transforms clone their points, so object identity cannot distinguish a point
// the repair kept from one it rebuilt. Alignment is therefore read out of the
// data: an equal point count is index-for-index, an unequal one is matched on
// sample geometry, and a track the operation resynthesized (resample, gap fill)
// degrades to a count-only comparison rather than reporting every sample as an
// insertion. Callers must stay useful at every rung — the point counts, the two
// overlaid paths, and the operation's own summary are always true, while the
// per-point classification is an extra layer the weakest rung does not have.

import { haversineMeters, type TrackPoint } from '../model'

export type PointDiffKind = 'unchanged' | 'modified' | 'added' | 'removed'

/** How before/after were paired up, weakest evidence last. */
export type DiffAlignment = 'index' | 'subsequence' | 'rebuilt'

export interface PointDiffEntry {
  kind: PointDiffKind
  beforeIndex?: number
  afterIndex?: number
}

export interface TrackDiffCounts {
  unchanged: number
  modified: number
  added: number
  removed: number
}

/**
 * Which aspects of the track the repair touched. `channels` is deliberately
 * excluded from the point classification: a derivation that only writes `ext`
 * values has nothing to overlay, and calling those points 'modified' would put
 * a preview in front of the user with two identical paths drawn on it.
 */
export interface TrackDiffChanged {
  position: boolean
  elevation: boolean
  time: boolean
  channels: boolean
}

export interface TrackDiff {
  alignment: DiffAlignment
  /** Empty under 'rebuilt' alignment, where no honest pairing exists. */
  entries: PointDiffEntry[]
  counts: TrackDiffCounts
  changed: TrackDiffChanged
  beforeCount: number
  afterCount: number
  /** Largest shift across matched pairs. Zero unless the alignment is 'index', which is the only rung that pairs differing points. */
  maxPositionShiftMeters: number
  maxElevationShiftMeters: number
  maxTimeShiftMs: number
}

// How far ahead of the cursor a matching point may be before the walk gives up
// and calls the pair unrelated. Large enough to step over a burst of dropped
// outliers, small enough that a fully rebuilt track fails fast.
const MATCH_LOOKAHEAD = 64

// Below this share of the smaller track matched, the pairing is noise and the
// diff drops to 'rebuilt' rather than reporting thousands of spurious edits.
const MATCH_RATIO_FLOOR = 0.5

export function computeTrackDiff(before: readonly TrackPoint[], after: readonly TrackPoint[]): TrackDiff {
  if (before.length === after.length) return indexDiff(before, after)

  const paired = subsequenceDiff(before, after)
  const smaller = Math.min(before.length, after.length)
  const matched = paired.counts.unchanged + paired.counts.modified
  if (smaller > 0 && matched / smaller >= MATCH_RATIO_FLOOR) return paired

  return rebuiltDiff(before, after)
}

/**
 * True when the repair changed something a plot can show. A derivation that
 * only adds computed channels returns false, which is how the preview decides
 * where a graphical view makes sense — instead of carrying a list of operation
 * ids that would drift out of date the moment an operation is added.
 */
export function hasVisualizableChange(diff: TrackDiff): boolean {
  if (diff.alignment === 'rebuilt') return true
  if (diff.beforeCount !== diff.afterCount) return true
  return diff.counts.modified > 0 || diff.counts.added > 0 || diff.counts.removed > 0
}

/** Compact facts for the preview dialog. Claims only what the alignment supports. */
export function describeTrackDiff(diff: TrackDiff): string[] {
  const lines = [`${diff.beforeCount.toLocaleString()} → ${diff.afterCount.toLocaleString()} points`]
  if (diff.alignment === 'rebuilt') {
    lines.push('Track was resynthesized — compared as two paths, not sample by sample')
    return lines
  }
  if (diff.counts.removed > 0) lines.push(`${diff.counts.removed.toLocaleString()} removed`)
  if (diff.counts.added > 0) lines.push(`${diff.counts.added.toLocaleString()} added`)
  if (diff.counts.modified > 0) lines.push(`${diff.counts.modified.toLocaleString()} moved or retimed`)
  if (diff.maxPositionShiftMeters > 0) lines.push(`largest position shift ${formatMeters(diff.maxPositionShiftMeters)}`)
  if (diff.maxElevationShiftMeters > 0) lines.push(`largest elevation shift ${formatMeters(diff.maxElevationShiftMeters)}`)
  if (diff.maxTimeShiftMs > 0) lines.push(`largest time shift ${formatMillis(diff.maxTimeShiftMs)}`)
  return lines
}

function indexDiff(before: readonly TrackPoint[], after: readonly TrackPoint[]): TrackDiff {
  const entries: PointDiffEntry[] = []
  const counts: TrackDiffCounts = { unchanged: 0, modified: 0, added: 0, removed: 0 }
  const changed: TrackDiffChanged = { position: false, elevation: false, time: false, channels: false }
  let maxPositionShiftMeters = 0
  let maxElevationShiftMeters = 0
  let maxTimeShiftMs = 0

  for (let index = 0; index < before.length; index++) {
    const a = before[index]!
    const b = after[index]!
    const positionChanged = !samePosition(a, b)
    const elevationChanged = !sameNumber(a.ele, b.ele)
    const timeChanged = !sameNumber(a.time, b.time)

    if (positionChanged) changed.position = true
    if (elevationChanged) changed.elevation = true
    if (timeChanged) changed.time = true
    if (!sameChannels(a, b)) changed.channels = true

    maxPositionShiftMeters = Math.max(maxPositionShiftMeters, positionShiftMeters(a, b))
    maxElevationShiftMeters = Math.max(maxElevationShiftMeters, numericDelta(a.ele, b.ele))
    maxTimeShiftMs = Math.max(maxTimeShiftMs, numericDelta(a.time, b.time))

    const modified = positionChanged || elevationChanged || timeChanged
    entries.push({ kind: modified ? 'modified' : 'unchanged', beforeIndex: index, afterIndex: index })
    if (modified) counts.modified++
    else counts.unchanged++
  }

  return {
    alignment: 'index',
    entries,
    counts,
    changed,
    beforeCount: before.length,
    afterCount: after.length,
    maxPositionShiftMeters,
    maxElevationShiftMeters,
    maxTimeShiftMs,
  }
}

function subsequenceDiff(before: readonly TrackPoint[], after: readonly TrackPoint[]): TrackDiff {
  const entries: PointDiffEntry[] = []
  const counts: TrackDiffCounts = { unchanged: 0, modified: 0, added: 0, removed: 0 }
  let channelsChanged = false
  let cursorBefore = 0
  let cursorAfter = 0

  while (cursorBefore < before.length && cursorAfter < after.length) {
    if (sameGeometry(before[cursorBefore]!, after[cursorAfter]!)) {
      entries.push({ kind: 'unchanged', beforeIndex: cursorBefore, afterIndex: cursorAfter })
      counts.unchanged++
      if (!sameChannels(before[cursorBefore]!, after[cursorAfter]!)) channelsChanged = true
      cursorBefore++
      cursorAfter++
      continue
    }

    // The current before-point may reappear further along `after` (samples were
    // inserted ahead of it), or the current after-point further along `before`
    // (samples were dropped). Take whichever explanation spans fewer unmatched
    // points; a greedy one-sided walk would mis-read every insertion as a
    // wholesale rewrite from that offset onwards.
    const insertedUntil = findWithin(after, before[cursorBefore]!, cursorAfter + 1, MATCH_LOOKAHEAD)
    const droppedUntil = findWithin(before, after[cursorAfter]!, cursorBefore + 1, MATCH_LOOKAHEAD)
    const insertionSpan = insertedUntil === -1 ? Infinity : insertedUntil - cursorAfter
    const deletionSpan = droppedUntil === -1 ? Infinity : droppedUntil - cursorBefore

    if (insertedUntil !== -1 && insertionSpan <= deletionSpan) {
      for (; cursorAfter < insertedUntil; cursorAfter++) {
        entries.push({ kind: 'added', afterIndex: cursorAfter })
        counts.added++
      }
      continue
    }
    if (droppedUntil !== -1) {
      for (; cursorBefore < droppedUntil; cursorBefore++) {
        entries.push({ kind: 'removed', beforeIndex: cursorBefore })
        counts.removed++
      }
      continue
    }

    entries.push({ kind: 'removed', beforeIndex: cursorBefore })
    counts.removed++
    cursorBefore++
    entries.push({ kind: 'added', afterIndex: cursorAfter })
    counts.added++
    cursorAfter++
  }

  for (; cursorBefore < before.length; cursorBefore++) {
    entries.push({ kind: 'removed', beforeIndex: cursorBefore })
    counts.removed++
  }
  for (; cursorAfter < after.length; cursorAfter++) {
    entries.push({ kind: 'added', afterIndex: cursorAfter })
    counts.added++
  }

  // Matched pairs are key-identical by construction, so the only thing an
  // insertion or deletion can change is which samples exist at all.
  const membershipChanged = counts.added > 0 || counts.removed > 0
  return {
    alignment: 'subsequence',
    entries,
    counts,
    changed: {
      position: membershipChanged,
      elevation: membershipChanged && (hasElevation(before) || hasElevation(after)),
      time: membershipChanged && (hasTime(before) || hasTime(after)),
      channels: channelsChanged,
    },
    beforeCount: before.length,
    afterCount: after.length,
    maxPositionShiftMeters: 0,
    maxElevationShiftMeters: 0,
    maxTimeShiftMs: 0,
  }
}

function rebuiltDiff(before: readonly TrackPoint[], after: readonly TrackPoint[]): TrackDiff {
  return {
    alignment: 'rebuilt',
    entries: [],
    counts: { unchanged: 0, modified: 0, added: 0, removed: 0 },
    changed: {
      position: true,
      elevation: hasElevation(before) || hasElevation(after),
      time: hasTime(before) || hasTime(after),
      channels: channelKeys(before) !== channelKeys(after),
    },
    beforeCount: before.length,
    afterCount: after.length,
    maxPositionShiftMeters: 0,
    maxElevationShiftMeters: 0,
    maxTimeShiftMs: 0,
  }
}

/**
 * Identity for matching: the fields a removal-style repair copies through
 * verbatim. Compared field by field rather than through a composed key string —
 * a half-million-point track made the key form allocate a million strings and
 * put a visible stall between the Apply click and the preview.
 */
function sameGeometry(a: TrackPoint, b: TrackPoint): boolean {
  return Object.is(a.lat, b.lat) && Object.is(a.lon, b.lon) && Object.is(a.ele, b.ele) && Object.is(a.time, b.time)
}

function findWithin(points: readonly TrackPoint[], target: TrackPoint, from: number, span: number): number {
  const limit = Math.min(points.length, from + span)
  for (let index = from; index < limit; index++) if (sameGeometry(points[index]!, target)) return index
  return -1
}

function samePosition(a: TrackPoint, b: TrackPoint): boolean {
  return Object.is(a.lat, b.lat) && Object.is(a.lon, b.lon)
}

function sameNumber(a: number | undefined, b: number | undefined): boolean {
  return Object.is(a, b)
}

function numericDelta(a: number | undefined, b: number | undefined): number {
  if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.abs(b - a)
}

function positionShiftMeters(a: TrackPoint, b: TrackPoint): number {
  if (![a.lat, a.lon, b.lat, b.lon].every((value) => Number.isFinite(value))) return 0
  return haversineMeters(a.lat, a.lon, b.lat, b.lon)
}

function sameChannels(a: TrackPoint, b: TrackPoint): boolean {
  if (a.name !== b.name || a.desc !== b.desc) return false
  const left = a.ext ?? {}
  const right = b.ext ?? {}
  const names = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const name of names) if (!Object.is(left[name], right[name])) return false
  return true
}

function hasElevation(points: readonly TrackPoint[]): boolean {
  return points.some((point) => point.ele !== undefined)
}

function hasTime(points: readonly TrackPoint[]): boolean {
  return points.some((point) => point.time !== undefined)
}

function channelKeys(points: readonly TrackPoint[]): string {
  const names = new Set<string>()
  for (const point of points) for (const name of Object.keys(point.ext ?? {})) names.add(name)
  return [...names].sort().join(',')
}

function formatMeters(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`
  if (value >= 1) return `${value.toFixed(1)} m`
  return `${(value * 100).toFixed(1)} cm`
}

function formatMillis(value: number): string {
  if (value >= 60_000) return `${(value / 60_000).toFixed(1)} min`
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`
  return `${Math.round(value)} ms`
}
