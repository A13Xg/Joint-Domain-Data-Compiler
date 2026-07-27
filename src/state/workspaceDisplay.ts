// Per-dataset display settings (visibility, color, opacity, label) keyed by
// dataset ID. Pure and side-effect-free so it can be unit tested and later
// persisted/restored without depending on React or any rendering surface.
// Tranche 5 Task 5.1, steps 1-3: the data model and validation/sync rules.
// Wiring this into an actual Sources panel and multi-track map/3D rendering
// (Task 5.2) and persisting it in the project archive (Tranche 7) are
// separate, larger follow-ons — see the execution plan.
import type { Dataset } from '../core/model'

export interface DatasetDisplaySettings {
  id: string
  visible: boolean
  color: string
  opacity: number
  label: string
}

export type WorkspaceDisplay = Record<string, DatasetDisplaySettings>

/** Same visual language as the chart/comparison palettes, kept local since no shared palette module exists yet. */
export const DISPLAY_COLOR_PALETTE = ['#ea4f2f', '#0f8c6f', '#3b82f6', '#eab308', '#a855f7', '#ec4899', '#14b8a6']

function colorForIndex(index: number): string {
  return DISPLAY_COLOR_PALETTE[index % DISPLAY_COLOR_PALETTE.length]!
}

export function createDisplaySettings(dataset: Dataset, index: number): DatasetDisplaySettings {
  return {
    id: dataset.id,
    visible: true,
    color: colorForIndex(index),
    opacity: 1,
    label: dataset.name,
  }
}

/**
 * Reconcile display settings against the current dataset list: adds settings
 * (with a deterministic fallback color) for newly-loaded datasets, and drops
 * settings for datasets that are no longer loaded. Existing entries for
 * still-loaded datasets are returned unchanged (same object identity) so
 * callers can cheaply detect "nothing changed".
 */
export function syncWorkspaceDisplay(current: WorkspaceDisplay, datasets: readonly Dataset[]): WorkspaceDisplay {
  const next: WorkspaceDisplay = {}
  let changed = false

  datasets.forEach((dataset, index) => {
    const existing = current[dataset.id]
    next[dataset.id] = existing ?? createDisplaySettings(dataset, index)
    if (!existing) changed = true
  })

  if (!changed && Object.keys(current).length === Object.keys(next).length) return current
  return next
}

/** Validated restore from persisted (e.g. project archive) state: drops entries with an invalid shape or a stale dataset ID rather than trusting the input. */
export function restoreWorkspaceDisplay(raw: unknown, datasets: readonly Dataset[]): WorkspaceDisplay {
  const validIds = new Set(datasets.map((dataset) => dataset.id))
  const restored: WorkspaceDisplay = {}

  if (raw && typeof raw === 'object') {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!validIds.has(id)) continue
      const candidate = value as Partial<DatasetDisplaySettings> | null
      if (!candidate || typeof candidate !== 'object') continue
      if (typeof candidate.visible !== 'boolean') continue
      if (typeof candidate.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(candidate.color)) continue
      if (typeof candidate.opacity !== 'number' || !Number.isFinite(candidate.opacity) || candidate.opacity < 0 || candidate.opacity > 1) continue
      if (typeof candidate.label !== 'string') continue
      restored[id] = { id, visible: candidate.visible, color: candidate.color, opacity: candidate.opacity, label: candidate.label }
    }
  }

  return syncWorkspaceDisplay(restored, datasets)
}

export function setVisibility(display: WorkspaceDisplay, id: string, visible: boolean): WorkspaceDisplay {
  const existing = display[id]
  if (!existing || existing.visible === visible) return display
  return { ...display, [id]: { ...existing, visible } }
}

export function setLabel(display: WorkspaceDisplay, id: string, label: string): WorkspaceDisplay {
  const existing = display[id]
  if (!existing) return display
  return { ...display, [id]: { ...existing, label } }
}

export function setOpacity(display: WorkspaceDisplay, id: string, opacity: number): WorkspaceDisplay {
  const existing = display[id]
  const clamped = Math.max(0, Math.min(1, opacity))
  if (!existing || existing.opacity === clamped) return display
  return { ...display, [id]: { ...existing, opacity: clamped } }
}

export function visibleDatasetIds(display: WorkspaceDisplay): string[] {
  return Object.values(display).filter((entry) => entry.visible).map((entry) => entry.id)
}
