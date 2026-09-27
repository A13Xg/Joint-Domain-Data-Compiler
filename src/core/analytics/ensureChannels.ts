// Playback/Graph consumers, unlike Workbench, never run the Transform tab
// before loading a dataset. Kinematics channels are a user-triggered
// Workbench transform (`standard-kinematics`), not computed at import (see
// docs/superpowers/specs/2026-09-27-jddc-suite-design.md §11 item 5) — so a
// dataset arriving here may or may not already have them.
import type { Dataset } from '../model'
import { withPoints } from '../transforms'
import { ensureBuiltinDerivationsRegistered } from './bootstrap'
import { runDerivation } from './registry'

export const STANDARD_KINEMATICS_CHANNELS = ['ground_speed_mps', 'heading_deg', 'vertical_speed_mps', 'turn_rate_dps'] as const

/**
 * Computes standard kinematics channels once, but only if the dataset has
 * NONE of them yet. `standard-kinematics` unconditionally recomputes every
 * one of its output channels when it runs — it has no partial mode — so
 * running it whenever even one channel is missing would silently overwrite
 * the others (e.g. NMEA's GPS-observed `heading_deg` replaced by a
 * haversine-bearing estimate just because `turn_rate_dps`, which NMEA never
 * carries, was absent). Checking `.some()` rather than `.every()` is what
 * actually keeps the invariant below true, not just the comment claiming it.
 *
 * Never overwrites channels a dataset already carries — those may be
 * hand-edited, notional, or otherwise not this derivation's own output, and
 * are not fabricated over just because a consumer wants a uniform channel
 * set. Returns the original dataset unchanged if derivation isn't possible
 * (e.g. no timestamps): absent channels are surfaced as absent, never
 * fabricated.
 */
export function ensureKinematicsChannels(dataset: Dataset): Dataset {
  const hasAny = STANDARD_KINEMATICS_CHANNELS.some((channel) => dataset.channels.includes(channel))
  if (hasAny || dataset.points.length === 0) return dataset
  ensureBuiltinDerivationsRegistered()
  try {
    const result = runDerivation('standard-kinematics', dataset)
    return withPoints(dataset, result.points)
  } catch {
    return dataset
  }
}
