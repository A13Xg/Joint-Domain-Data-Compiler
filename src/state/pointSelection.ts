import { useEffect, useSyncExternalStore } from 'react'
import type { TrackPoint } from '../core/model'

interface PointSelectionSnapshot {
  points: readonly TrackPoint[] | null
  pointIndex: number | null
}

let snapshot: PointSelectionSnapshot = { points: null, pointIndex: null }
const listeners = new Set<() => void>()

export function usePointSelection(points: readonly TrackPoint[]) {
  useEffect(() => {
    if (snapshot.points !== points) setDataset(points)
  }, [points])

  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    pointIndex: current.points === points ? current.pointIndex : null,
    selectPoint: (pointIndex: number | null) => selectPoint(points, pointIndex),
    clearSelection: () => selectPoint(points, null),
  }
}

export function getSelectedPoint(points: readonly TrackPoint[]): TrackPoint | null {
  if (snapshot.points !== points || snapshot.pointIndex === null) return null
  return points[snapshot.pointIndex] ?? null
}

function setDataset(points: readonly TrackPoint[]): void {
  snapshot = { points, pointIndex: null }
  emit()
}

function selectPoint(points: readonly TrackPoint[], pointIndex: number | null): void {
  if (snapshot.points !== points) snapshot = { points, pointIndex: null }
  const normalized = pointIndex === null
    ? null
    : Number.isInteger(pointIndex) && pointIndex >= 0 && pointIndex < points.length
      ? pointIndex
      : null
  if (snapshot.pointIndex === normalized) return
  snapshot = { points, pointIndex: normalized }
  emit()
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
