import { useEffect, useSyncExternalStore } from 'react'
import type { TrackPoint } from '../core/model'
import { indexRangeToTimeRange, normalizeTimeRange, timeRangeToIndexRange, type TimeRange } from '../core/selection'

export interface SelectedIndexRange { start: number; end: number }
interface PointSelectionSnapshot {
  points: readonly TrackPoint[] | null
  pointIndex: number | null
  hoverIndex: number | null
  indexRange: SelectedIndexRange | null
  timeRange: TimeRange | null
  segmentIds: string[]
  /**
   * An arbitrary, possibly non-contiguous set of indices, built by ctrl/cmd
   * and shift click on the table grid and consumed only by the
   * selection-scoped delete operation. Deliberately orthogonal to
   * pointIndex/indexRange (which drive editing, jumping, and range-scoped
   * transforms elsewhere) rather than layered onto them, so this never
   * changes what those existing readers see.
   */
  indexSet: number[]
  /** The fixed shift-click reference point; not exposed outside this module. */
  setAnchor: number | null
}
const EMPTY_STATE = { pointIndex: null, hoverIndex: null, indexRange: null, timeRange: null, segmentIds: [] as string[], indexSet: [] as number[], setAnchor: null as number | null }
let snapshot: PointSelectionSnapshot = { points: null, ...EMPTY_STATE }
const listeners = new Set<() => void>()

export function usePointSelection(points: readonly TrackPoint[]) {
  useEffect(() => { if (snapshot.points !== points) setDataset(points) }, [points])
  useSelectionKeyboard(points)
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const active = current.points === points
  return {
    pointIndex: active ? current.pointIndex : null,
    hoverIndex: active ? current.hoverIndex : null,
    indexRange: active ? current.indexRange : null,
    timeRange: active ? current.timeRange : null,
    segmentIds: active ? current.segmentIds : [],
    indexSet: active ? current.indexSet : [],
    selectPoint: (pointIndex: number | null) => selectPoint(points, pointIndex),
    setHoverIndex: (pointIndex: number | null) => setHoveredPointIndex(points, pointIndex),
    selectRange: (range: SelectedIndexRange | null) => selectRange(points, range),
    selectTimeRange: (range: TimeRange | null) => selectTimeRange(points, range),
    selectSegment: (segmentId: string, range: SelectedIndexRange) => selectSegment(points, segmentId, range),
    toggleInSet: (pointIndex: number) => toggleInSet(points, pointIndex),
    extendSetRange: (pointIndex: number) => extendSetRange(points, pointIndex),
    unionSetRange: (start: number, end: number) => unionSetRange(points, start, end),
    clearPointSelection: () => clearPointSelection(points),
    clearRangeSelection: () => clearRangeSelection(points),
    clearSet: () => clearSet(points),
    clearAllSelection: () => clearAllSelection(points),
    clearHover: () => setHoveredPointIndex(points, null),
    clearRange: () => selectRange(points, null),
  }
}

export function useSelectionKeyboard(points: readonly TrackPoint[]): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (!isEditableTarget(event.target) && handleSelectionKeyboard(points, event.key, event.shiftKey)) event.preventDefault() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [points])
}

export function handleSelectionKeyboard(points: readonly TrackPoint[], key: string, extendRange = false): boolean {
  if (points.length === 0) return false
  ensureDataset(points)
  if (key === 'Escape') { clearAllSelection(points); return true }
  if (key === 'Enter' && snapshot.hoverIndex !== null) { selectPoint(points, snapshot.hoverIndex); return true }
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return false
  const direction = key === 'ArrowLeft' ? -1 : 1
  const base = snapshot.hoverIndex ?? snapshot.pointIndex ?? (direction > 0 ? -1 : points.length)
  const target = key === 'Home' ? 0 : key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, base + direction))
  const anchor = snapshot.indexRange?.start ?? snapshot.pointIndex ?? snapshot.hoverIndex ?? target
  snapshot = { ...snapshot, hoverIndex: target, ...(extendRange ? rangeFields(points, { start: anchor, end: target }) : {}) }
  emit()
  return true
}

export function restorePointSelection(points: readonly TrackPoint[], pointIndex: number | null, indexRange: SelectedIndexRange | null): void {
  const normalizedRange = normalizeRange(points, indexRange)
  // indexSet is a working set for the delete gesture, not durable view state
  // (it isn't part of WorkspaceSelection and no caller persists it), so every
  // restore — a transform, an undo, a project load — starts it fresh, same as
  // segmentIds already does here.
  snapshot = { points, pointIndex: normalizeIndex(points, pointIndex), hoverIndex: null, indexRange: normalizedRange, timeRange: normalizedRange ? indexRangeToTimeRange([...points], normalizedRange) : null, segmentIds: [], indexSet: [], setAnchor: null }
  emit()
}

export function getSelectedPointIndex(points: readonly TrackPoint[]): number | null { return snapshot.points === points ? snapshot.pointIndex : null }
export function getSelectedPoint(points: readonly TrackPoint[]): TrackPoint | null { return snapshot.points === points && snapshot.pointIndex !== null ? points[snapshot.pointIndex] ?? null : null }
export function getHoveredPointIndex(points: readonly TrackPoint[]): number | null { return snapshot.points === points ? snapshot.hoverIndex : null }
export function getSelectedRange(points: readonly TrackPoint[]): SelectedIndexRange | null { return snapshot.points === points ? snapshot.indexRange : null }
export function getSelectedTimeRange(points: readonly TrackPoint[]): TimeRange | null { return snapshot.points === points ? snapshot.timeRange : null }
export function getSelectedSegmentIds(points: readonly TrackPoint[]): string[] { return snapshot.points === points ? snapshot.segmentIds : [] }
export function getSelectedIndexSet(points: readonly TrackPoint[]): number[] { return snapshot.points === points ? snapshot.indexSet : [] }

function setDataset(points: readonly TrackPoint[]): void { snapshot = { points, ...EMPTY_STATE }; emit() }
// A plain (unmodified) click always lands here, from every panel that
// supports point selection, not just the table — so this is also where an
// in-progress multi-select set gets superseded: making any new definite
// single/range/segment selection abandons the set being built, same as
// clicking away from a marquee would.
function selectPoint(points: readonly TrackPoint[], pointIndex: number | null): void { ensureDataset(points); const normalized = normalizeIndex(points, pointIndex); if (snapshot.pointIndex === normalized && snapshot.indexSet.length === 0) return; snapshot = { ...snapshot, pointIndex: normalized, indexSet: [], setAnchor: null }; emit() }
export function setHoveredPointIndex(points: readonly TrackPoint[], pointIndex: number | null): void { ensureDataset(points); const normalized = normalizeIndex(points, pointIndex); if (snapshot.hoverIndex === normalized) return; snapshot = { ...snapshot, hoverIndex: normalized }; emit() }
function selectRange(points: readonly TrackPoint[], range: SelectedIndexRange | null): void { ensureDataset(points); const normalized = normalizeRange(points, range); if (sameRange(snapshot.indexRange, normalized) && snapshot.segmentIds.length === 0 && snapshot.indexSet.length === 0) return; snapshot = { ...snapshot, ...rangeFields(points, normalized), segmentIds: [], indexSet: [], setAnchor: null }; emit() }
function selectTimeRange(points: readonly TrackPoint[], range: TimeRange | null): void { ensureDataset(points); if (!range) { snapshot = { ...snapshot, indexRange: null, timeRange: null, segmentIds: [], indexSet: [], setAnchor: null }; emit(); return } const normalizedTime = normalizeTimeRange(range); snapshot = { ...snapshot, indexRange: timeRangeToIndexRange([...points], normalizedTime), timeRange: normalizedTime, segmentIds: [], indexSet: [], setAnchor: null }; emit() }
function selectSegment(points: readonly TrackPoint[], segmentId: string, range: SelectedIndexRange): void { ensureDataset(points); const normalized = normalizeRange(points, range); snapshot = { ...snapshot, ...rangeFields(points, normalized), segmentIds: normalized ? [segmentId] : [], indexSet: [], setAnchor: null }; emit() }
// Ctrl/Cmd+click: adds or removes exactly the clicked index, independent of
// pointIndex/indexRange. Moves the shift-click anchor to the toggled index,
// matching common file-manager behavior (the next Shift+click extends from
// here, not from wherever it last extended to).
export function toggleInSet(points: readonly TrackPoint[], pointIndex: number): void {
  ensureDataset(points)
  const normalized = normalizeIndex(points, pointIndex)
  if (normalized === null) return
  const next = new Set(snapshot.indexSet)
  if (next.has(normalized)) next.delete(normalized); else next.add(normalized)
  snapshot = { ...snapshot, indexSet: [...next].sort((a, b) => a - b), setAnchor: normalized }
  emit()
}
// Shift+click: unions the contiguous run between the fixed anchor and the
// clicked index into the set, so several shift-clicks build up disjoint runs
// instead of each one replacing the last. The anchor itself does not move.
export function extendSetRange(points: readonly TrackPoint[], pointIndex: number): void {
  ensureDataset(points)
  const normalized = normalizeIndex(points, pointIndex)
  if (normalized === null) return
  const anchor = snapshot.setAnchor ?? snapshot.pointIndex ?? normalized
  const lower = Math.min(anchor, normalized)
  const upper = Math.max(anchor, normalized)
  const next = new Set(snapshot.indexSet)
  for (let index = lower; index <= upper; index++) next.add(index)
  snapshot = { ...snapshot, indexSet: [...next].sort((a, b) => a - b), setAnchor: anchor }
  emit()
}
export function clearPointSelection(points: readonly TrackPoint[]): void { ensureDataset(points); snapshot = { ...snapshot, pointIndex: null }; emit() }
export function clearRangeSelection(points: readonly TrackPoint[]): void { ensureDataset(points); snapshot = { ...snapshot, indexRange: null, timeRange: null, segmentIds: [] }; emit() }
// Ctrl/Cmd+drag marquee (chart): unions the contiguous run between two
// explicit endpoints, e.g. a drag's start and release index. Deliberately
// does not read or move `setAnchor` — a marquee names its own span outright,
// it does not extend from wherever a prior click or shift+click left off.
export function unionSetRange(points: readonly TrackPoint[], start: number, end: number): void {
  ensureDataset(points)
  const startIndex = normalizeIndex(points, start)
  const endIndex = normalizeIndex(points, end)
  if (startIndex === null || endIndex === null) return
  const lower = Math.min(startIndex, endIndex)
  const upper = Math.max(startIndex, endIndex)
  const next = new Set(snapshot.indexSet)
  for (let index = lower; index <= upper; index++) next.add(index)
  snapshot = { ...snapshot, indexSet: [...next].sort((a, b) => a - b) }
  emit()
}
export function clearSet(points: readonly TrackPoint[]): void { ensureDataset(points); if (snapshot.indexSet.length === 0 && snapshot.setAnchor === null) return; snapshot = { ...snapshot, indexSet: [], setAnchor: null }; emit() }
export function clearAllSelection(points: readonly TrackPoint[]): void { ensureDataset(points); snapshot = { ...snapshot, ...EMPTY_STATE }; emit() }
function ensureDataset(points: readonly TrackPoint[]): void { if (snapshot.points !== points) snapshot = { points, ...EMPTY_STATE } }
function rangeFields(points: readonly TrackPoint[], range: SelectedIndexRange | null) { return { indexRange: range, timeRange: range ? indexRangeToTimeRange([...points], range) : null } }
function normalizeIndex(points: readonly TrackPoint[], pointIndex: number | null): number | null { return pointIndex !== null && Number.isInteger(pointIndex) && pointIndex >= 0 && pointIndex < points.length ? pointIndex : null }
function normalizeRange(points: readonly TrackPoint[], range: SelectedIndexRange | null): SelectedIndexRange | null { if (!range || points.length === 0 || !Number.isInteger(range.start) || !Number.isInteger(range.end)) return null; return { start: Math.max(0, Math.min(points.length - 1, Math.min(range.start, range.end))), end: Math.max(0, Math.min(points.length - 1, Math.max(range.start, range.end))) } }
function sameRange(left: SelectedIndexRange | null, right: SelectedIndexRange | null): boolean { return left === right || (left !== null && right !== null && left.start === right.start && left.end === right.end) }
function isEditableTarget(target: EventTarget | null): boolean { return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) }
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener) }
function getSnapshot(): PointSelectionSnapshot { return snapshot }
function emit(): void { for (const listener of listeners) listener() }
