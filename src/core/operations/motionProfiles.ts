/**
 * Plausibility envelopes for gap filling, in canonical SI.
 *
 * This is a plain data module in the same spirit as `trackHealthConfig.ts`: a
 * future settings menu edits a copy of this shape and passes it through.
 *
 * Deliberately not aviation-hardcoded. The interpolation math is
 * domain-neutral and the derived kinematics channels are already neutral SI,
 * so the only aircraft-specific thing about gap filling would be the limits —
 * and this is a joint-domain tool. Track Health does bake in a 1000 ft floor
 * and a Mach 2 ceiling, but that is a scan grading flight data, not a
 * transform rewriting it.
 *
 * The numbers are intentionally generous. Their job is to catch a fill that is
 * physically absurd for the platform — a ship "turning" at 40°/s across a
 * ten-minute dropout — not to enforce a performance model. A limit tight
 * enough to be interesting would start refusing real manoeuvres, and refusing
 * to fill is the failure mode users cannot see.
 */

export type MotionProfileId = 'aircraft' | 'ground' | 'marine' | 'unconstrained'

export interface MotionProfile {
  id: MotionProfileId
  label: string
  description: string
  /** Ceiling on ground speed implied by the filled points. */
  maxGroundSpeedMps: number
  /** Ceiling on |vertical speed| implied by the filled points. */
  maxVerticalSpeedMps: number
  /** Ceiling on |turn rate| implied by the filled points. */
  maxTurnRateDps: number
  /** Ceiling on |along-track acceleration| implied by the filled points. */
  maxHorizontalAccelMps2: number
}

export const MOTION_PROFILES: Record<MotionProfileId, MotionProfile> = {
  aircraft: {
    id: 'aircraft',
    label: 'Aircraft',
    // Mach 2 at sea-level standard, 20,000 ft/min, and a 3 g turn — a fighter
    // envelope, so a transport-category fill is never refused for being slow.
    description: 'Fixed-wing envelope: up to Mach 2, 100 m/s vertical, 3 g.',
    maxGroundSpeedMps: 680,
    maxVerticalSpeedMps: 100,
    maxTurnRateDps: 30,
    maxHorizontalAccelMps2: 30,
  },
  ground: {
    id: 'ground',
    label: 'Ground vehicle',
    description: 'Surface vehicle envelope: up to 100 m/s, shallow gradients, tight turns.',
    maxGroundSpeedMps: 100,
    // Gradients, not flight: 20 m/s vertical is a very steep road at speed.
    maxVerticalSpeedMps: 20,
    // A vehicle can pivot far faster than an aircraft can turn.
    maxTurnRateDps: 90,
    maxHorizontalAccelMps2: 15,
  },
  marine: {
    id: 'marine',
    label: 'Marine',
    description: 'Surface vessel envelope: up to 40 m/s, near-zero vertical, slow turns.',
    maxGroundSpeedMps: 40,
    // Tide and swell only; a vessel does not climb.
    maxVerticalSpeedMps: 2,
    maxTurnRateDps: 20,
    maxHorizontalAccelMps2: 5,
  },
  unconstrained: {
    id: 'unconstrained',
    label: 'Unconstrained',
    description: 'No plausibility limits. Every gap within the threshold is filled.',
    maxGroundSpeedMps: Number.POSITIVE_INFINITY,
    maxVerticalSpeedMps: Number.POSITIVE_INFINITY,
    maxTurnRateDps: Number.POSITIVE_INFINITY,
    maxHorizontalAccelMps2: Number.POSITIVE_INFINITY,
  },
}

export const MOTION_PROFILE_IDS: readonly MotionProfileId[] = ['aircraft', 'ground', 'marine', 'unconstrained']
