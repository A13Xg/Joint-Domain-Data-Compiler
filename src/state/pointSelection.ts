import { useEffect, useSyncExternalStore } from 'react'
import type { TrackPoint } from '../core/model'
import { indexRangeToTimeRange, normalizeTimeRange, timeRangeToIndexRange, type TimeRange } from '../core/selection'

export interface SelectedIndexRange { start: number; end: number }
interface PointSelectionSnapshot { points: readonly TrackPoint[] | null; pointIndex: number | null; hoverIndex: number | null; indexRange: SelectedIndexRange | null; timeRange: TimeRange | null; segmentIds: string[] }
const EMPTY_STATE = { pointIndex: null, hoverIndex: null, indexRange: null, timeRange: null, segmentIds: [] as string[] }
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
    selectPoint: (pointIndex: number | null) => selectPoint(points, pointIndex),
    setHoverIndex: (pointIndex: number | null) => setHoveredPointIndex(points, pointIndex),
    selectRange: (range: SelectedIndexRange | null) => selectRange(points, range),
    selectTimeRange: (range: TimeRange | null) => selectTimeRange(points, range),
    selectSegment: (segmentId: string, range: SelectedIndexRange) => selectSegment(points, segmentId, range),
    clearPointSelection: () => clearPointSelection(points),
    clearRangeSelection: () => clearRangeSelection(points),
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
  snapshot = { points, pointIndex: normalizeIndex(points, pointIndex), hoverIndex: null, indexRange: normalizedRange, timeRange: normalizedRange ? indexRangeToTimeRange([...points], normalizedRange) : null, segmentIds: [] }
  emit()
}

export function getSelectedPointIndex(points: readonly TrackPoint[]): number | null { return snapshot.points === points ? snapshot.pointIndex : null }
export function getSelectedPoint(points: readonly TrackPoint[]): TrackPoint | null { return snapshot.points === points && snapshot.pointIndex !== null ? points[snapshot.pointIndex] ?? null : null }
export function getHoveredPointIndex(points: readonly TrackPoint[]): number | null { return snapshot.points === points ? snapshot.hoverIndex : null }
export function getSelectedRange(points: readonly TrackPoint[]): SelectedIndexRange | null { return snapshot.points === points ? snapshot.indexRange : null }
export function getSelectedTimeRange(points: readonly TrackPoint[]): TimeRange | null { return snapshot.points === points ? snapshot.timeRange : null }
export function getSelectedSegmentIds(points: readonly TrackPoint[]): string[] { return snapshot.points === points ? snapshot.segmentIds : [] }

function setDataset(points: readonly TrackPoint[]): void { snapshot = { points, ...EMPTY_STATE }; emit() }
function selectPoint(points: readonly TrackPoint[], pointIndex: number | null): void { ensureDataset(points); const normalized = normalizeIndex(points, pointIndex); if (snapshot.pointIndex === normalized) return; snapshot = { ...snapshot, pointIndex: normalized }; emit() }
export function setHoveredPointIndex(points: readonly TrackPoint[], pointIndex: number | null): void { ensureDataset(points); const normalized = normalizeIndex(points, pointIndex); if (snapshot.hoverIndex === normalized) return; snapshot = { ...snapshot, hoverIndex: normalized }; emit() }
function selectRange(points: readonly TrackPoint[], range: SelectedIndexRange | null): void { ensureDataset(points); const normalized = normalizeRange(points, range); if (sameRange(snapshot.indexRange, normalized) && snapshot.segmentIds.length === 0) return; snapshot = { ...snapshot, ...rangeFields(points, normalized), segmentIds: [] }; emit() }
function selectTimeRange(points: readonly TrackPoint[], range: TimeRange | null): void { ensureDataset(points); if (!range) { snapshot = { ...snapshot, indexRange: null, timeRange: null, segmentIds: [] }; emit(); return } const normalizedTime = normalizeTimeRange(range); snapshot = { ...snapshot, indexRange: timeRangeToIndexRange([...points], normalizedTime), timeRange: normalizedTime, segmentIds: [] }; emit() }
function selectSegment(points: readonly TrackPoint[], segmentId: string, range: SelectedIndexRange): void { ensureDataset(points); const normalized = normalizeRange(points, range); snapshot = { ...snapshot, ...rangeFields(points, normalized), segmentIds: normalized ? [segmentId] : [] }; emit() }
export function clearPointSelection(points: readonly TrackPoint[]): void { ensureDataset(points); snapshot = { ...snapshot, pointIndex: null }; emit() }
export function clearRangeSelection(points: readonly TrackPoint[]): void { ensureDataset(points); snapshot = { ...snapshot, indexRange: null, timeRange: null, segmentIds: [] }; emit() }
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
