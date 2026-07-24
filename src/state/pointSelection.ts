import { useEffect, useSyncExternalStore } from 'react'
import type { TrackPoint } from '../core/model'

export interface SelectedIndexRange {
  start: number
  end: number
}

interface PointSelectionSnapshot {
  points: readonly TrackPoint[] | null
  pointIndex: number | null
  indexRange: SelectedIndexRange | null
}

let snapshot: PointSelectionSnapshot = { points: null, pointIndex: null, indexRange: null }
const listeners = new Set<() => void>()

export function usePointSelection(points: readonly TrackPoint[]) {
  useEffect(() => {
    if (snapshot.points !== points) setDataset(points)
  }, [points])

  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const active = current.points === points
  return {
    pointIndex: active ? current.pointIndex : null,
    indexRange: active ? current.indexRange : null,
    selectPoint: (pointIndex: number | null) => selectPoint(points, pointIndex),
    selectRange: (range: SelectedIndexRange | null) => selectRange(points, range),
    clearSelection: () => clearSelection(points),
    clearRange: () => selectRange(points, null),
  }
}

export function getSelectedPoint(points: readonly TrackPoint[]): TrackPoint | null {
  if (snapshot.points !== points || snapshot.pointIndex === null) return null
  return points[snapshot.pointIndex] ?? null
}

export function getSelectedRange(points: readonly TrackPoint[]): SelectedIndexRange | null {
  return snapshot.points === points ? snapshot.indexRange : null
}

function setDataset(points: readonly TrackPoint[]): void {
  snapshot = { points, pointIndex: null, indexRange: null }
  emit()
}

function selectPoint(points: readonly TrackPoint[], pointIndex: number | null): void {
  ensureDataset(points)
  const normalized = normalizeIndex(points, pointIndex)
  if (snapshot.pointIndex === normalized) return
  snapshot = { ...snapshot, pointIndex: normalized }
  emit()
}

function selectRange(points: readonly TrackPoint[], range: SelectedIndexRange | null): void {
  ensureDataset(points)
  const normalized = normalizeRange(points, range)
  if (sameRange(snapshot.indexRange, normalized)) return
  snapshot = { ...snapshot, indexRange: normalized }
  emit()
}

function clearSelection(points: readonly TrackPoint[]): void {
  ensureDataset(points)
  if (snapshot.pointIndex === null && snapshot.indexRange === null) return
  snapshot = { ...snapshot, pointIndex: null, indexRange: null }
  emit()
}

function ensureDataset(points: readonly TrackPoint[]): void {
  if (snapshot.points !== points) snapshot = { points, pointIndex: null, indexRange: null }
}

function normalizeIndex(points: readonly TrackPoint[], pointIndex: number | null): number | null {
  return pointIndex !== null && Number.isInteger(pointIndex) && pointIndex >= 0 && pointIndex < points.length
    ? pointIndex
    : null
}

function normalizeRange(points: readonly TrackPoint[], range: SelectedIndexRange | null): SelectedIndexRange | null {
  if (!range || points.length === 0 || !Number.isInteger(range.start) || !Number.isInteger(range.end)) return null
  const start = Math.max(0, Math.min(points.length - 1, Math.min(range.start, range.end)))
  const end = Math.max(0, Math.min(points.length - 1, Math.max(range.start, range.end)))
  return { start, end }
}

function sameRange(left: SelectedIndexRange | null, right: SelectedIndexRange | null): boolean {
  return left === right || (left !== null && right !== null && left.start === right.start && left.end === right.end)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): PointSelectionSnapshot {
  return snapshot
}

function emit(): void {
  for (const listener of listeners) listener()
}
