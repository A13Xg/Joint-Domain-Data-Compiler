// App-level settings: preferences that belong to *this installation*, not to
// any one project. Contrast with `state/workspace.ts`'s `WorkspaceState`,
// which is project-scoped and travels inside a saved `.jddc` file, validated
// through `persistence/project/manifest.ts`. Settings never round-trip
// through a project — a value here should mean the same thing whichever
// project happens to be open.
//
// Persisted to `localStorage` on both the web and Electron desktop builds.
// The original roadmap item called for "a local config file on desktop" to
// mirror the archived-copy pattern in `desktop/fileArchive.ts`, but Electron's
// renderer process already gets a working, disk-backed `localStorage`
// (persisted under the app's userData directory, surviving relaunches) —
// wiring a second, file-based store through a new IPC channel would
// duplicate that persistence for no behavioral gain, so this uses the one
// mechanism on both platforms. Revisit only if a settings value needs to be
// human-editable or shared outside the app, which none of these are.
import { useEffect, useSyncExternalStore } from 'react'
import { MOTION_PROFILE_IDS, type MotionProfileId } from '../core/operations/motionProfiles'

export interface AppSettings {
  /** Point budget for `TimeSeriesChart`'s line/point rendering. Below this
   *  many points in the visible window, every sample renders individually —
   *  which is also what arms the chart's ctrl/shift point-set gestures (see
   *  `TimeSeriesChart`'s `setGestureArmed`). Raising this budget makes the
   *  delete-set gesture reachable at lower zoom levels but also means more
   *  `<circle>` elements on screen; lowering it makes exact point-selection
   *  require zooming in further. One number governs both, deliberately —
   *  the gesture's "exact by construction" guarantee only holds because it
   *  reads the same budget the renderer used to decide what's exact. */
  chartPointBudget: number
  /** Point budget for `MapView`'s track/overlay rendering (display only;
   *  the full dataset is still used for stats, export, and everything else). */
  mapPointBudget: number
  /** Point budget for the 3D trajectory renderer (`Trajectory3dPanel`). */
  scenePointBudget: number
  /** Default `profile` TransformPanel's Drop outliers and Fill gaps cards
   *  open with each session, instead of always resetting to Aircraft. */
  defaultMotionProfile: MotionProfileId
}

export const DEFAULT_SETTINGS: AppSettings = {
  chartPointBudget: 1500,
  mapPointBudget: 4000,
  scenePointBudget: 20_000,
  defaultMotionProfile: 'aircraft',
}

/** The subset of `AppSettings` that are plain clamped numbers — everything
 *  except `defaultMotionProfile`, which is a closed string enum and is
 *  normalized/set through its own path below rather than forced through the
 *  numeric clamp machinery. */
type NumericSettingKey = 'chartPointBudget' | 'mapPointBudget' | 'scenePointBudget'
const NUMERIC_SETTING_KEYS: readonly NumericSettingKey[] = ['chartPointBudget', 'mapPointBudget', 'scenePointBudget']

/** Inclusive clamp ranges. Chosen so a budget can never disable the surface
 *  it governs (too low) or flood the DOM/canvas with more elements than any
 *  of these renderers were built to handle smoothly (too high). The chart's
 *  ceiling is far lower than the map's or scene's: every chart sample below
 *  budget becomes an individually hit-tested SVG `<circle>`, where the map
 *  and 3D renderers draw to a canvas regardless of point count. */
export const SETTINGS_LIMITS: Record<NumericSettingKey, { min: number; max: number }> = {
  chartPointBudget: { min: 100, max: 5_000 },
  mapPointBudget: { min: 500, max: 20_000 },
  scenePointBudget: { min: 1_000, max: 100_000 },
}

const STORAGE_KEY = 'jddc.settings.v1'

function clampSetting(key: NumericSettingKey, value: number): number {
  const { min, max } = SETTINGS_LIMITS[key]
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Rebuilds a valid `AppSettings` from whatever was persisted (or `undefined`
 *  if nothing was), defaulting and clamping field-by-field rather than
 *  rejecting the whole object — a stale key from an older release, a
 *  corrupted number, or a hand-edited localStorage value should degrade to
 *  a sane default for just that field, not lose every other preference. */
export function normalizeSettings(value: unknown): AppSettings {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const result = {} as AppSettings
  for (const key of NUMERIC_SETTING_KEYS) {
    const raw = record[key]
    result[key] = typeof raw === 'number' && Number.isFinite(raw) ? clampSetting(key, raw) : DEFAULT_SETTINGS[key]
  }
  const profile = record.defaultMotionProfile
  result.defaultMotionProfile = typeof profile === 'string' && (MOTION_PROFILE_IDS as readonly string[]).includes(profile)
    ? profile as MotionProfileId
    : DEFAULT_SETTINGS.defaultMotionProfile
  return result
}

function readPersisted(): AppSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return normalizeSettings(JSON.parse(raw))
  } catch {
    // Private browsing, disabled storage, or corrupted JSON: fall back to
    // defaults rather than throwing during module init.
    return DEFAULT_SETTINGS
  }
}

let settings: AppSettings = typeof window === 'undefined' ? DEFAULT_SETTINGS : readPersisted()
const listeners = new Set<() => void>()

function persist(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Best-effort: a value still applies for the rest of this session even
    // if it can't be saved (e.g. storage quota, private browsing).
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

export function getSettings(): AppSettings {
  return settings
}

export function updateSetting(key: NumericSettingKey, value: number): void {
  const clamped = clampSetting(key, value)
  if (settings[key] === clamped) return
  settings = { ...settings, [key]: clamped }
  persist()
  emit()
}

export function updateDefaultMotionProfile(value: MotionProfileId): void {
  if (settings.defaultMotionProfile === value) return
  settings = { ...settings, defaultMotionProfile: value }
  persist()
  emit()
}

export function resetSettings(): void {
  if (settings === DEFAULT_SETTINGS) return
  settings = DEFAULT_SETTINGS
  persist()
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Live view of app settings, re-rendering the caller on any change from
 *  any component (module-level singleton, same shape as `usePointSelection`). */
export function useAppSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSettings, getSettings)
}

/** Cross-tab sync: another tab/window changing settings (web only — Electron
 *  windows don't share a `storage` event) should update this one too. */
export function useSettingsStorageSync(): void {
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return
      settings = event.newValue ? normalizeSettings(JSON.parse(event.newValue)) : DEFAULT_SETTINGS
      emit()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
}
