/**
 * Global default tuning for the track health scan.
 *
 * This is a plain data module on purpose: a future settings menu edits a copy of
 * this shape and passes it through as the scan's `config` payload, and per-source-format
 * overrides slot in the same way. Nothing here is persisted today.
 */
export interface TrackHealthConfig {
  altitudeProfile: {
    /** 1000 ft ASL in meters — TrackPoint.ele is meters. */
    floorMeters: number
    /** Fraction of points that must carry `ele` before this check runs at all. */
    minElevationCoverage: number
    /** Median of the first/last N elevation samples, so one bad ground sample can't skew start/end. */
    groundSampleCount: number
    startEndToleranceMeters: number
    startEndToleranceFraction: number
    /** The above-floor span must cover at least this fraction of the track. */
    minSustainedFraction: number
    /** The climb must be established before this fraction of the track has elapsed. */
    maxClimbStartFraction: number
  }
  speedEnvelope: {
    /** 10 kt. */
    minSpeedMps: number
    /** Mach 2, using Mach 1 ~ 661.5 kt at sea-level standard. */
    maxSpeedMps: number
    /**
     * Share of in-window samples allowed outside the envelope before the check fails.
     * Takeoff roll and landing rollout cross the floor within the movement window, and
     * a single GPS-noise sample should not fail an otherwise clean flight.
     */
    maxViolationFraction: number
  }
  timeOrderSpan: {
    minSpanMs: number
    maxSpanMs: number
  }
  schemaParse: {
    minValidCoordinateFraction: number
  }
  outlier: {
    /** Samples on each side of the point under test. */
    windowSize: number
    /** Robust z-score (residual / scaled MAD) above which a channel flags a point. */
    scoreThreshold: number
    maxFlaggedFraction: number
    /**
     * Per-channel noise floors. A residual smaller than the sensor's own noise is not
     * evidence of anything, and without these a perfectly smooth track divides a tiny
     * residual by a near-zero scale and flags everything.
     */
    minPositionScaleMeters: number
    minElevationScaleMeters: number
    minSpeedScaleMps: number
  }
  stagnant: {
    /** 0.25 mi. */
    radiusMeters: number
    /** 3 min. */
    maxDurationMs: number
  }
  movementWindow: {
    /**
     * Deliberately equal to speedEnvelope.minSpeedMps: the window marks where the vehicle
     * is genuinely under way, so the speed check's own floor defines the same boundary.
     * A lower threshold here would place the taxi/rollout band inside the window and fail
     * every real flight.
     */
    speedThresholdMps: number
    displacementFallbackMeters: number
    minSustainedSamples: number
  }
}

const MIN_SPEED_MPS = 5.144 // 10 kt

export const DEFAULT_TRACK_HEALTH_CONFIG: TrackHealthConfig = {
  altitudeProfile: {
    floorMeters: 304.8,
    minElevationCoverage: 0.8,
    groundSampleCount: 5,
    startEndToleranceMeters: 100,
    startEndToleranceFraction: 0.15,
    minSustainedFraction: 0.1,
    maxClimbStartFraction: 0.9,
  },
  speedEnvelope: {
    minSpeedMps: MIN_SPEED_MPS,
    maxSpeedMps: 680.7,
    maxViolationFraction: 0.02,
  },
  timeOrderSpan: {
    minSpanMs: 600_000,
    maxSpanMs: 43_200_000,
  },
  schemaParse: {
    minValidCoordinateFraction: 0.5,
  },
  outlier: {
    windowSize: 5,
    scoreThreshold: 3.0,
    maxFlaggedFraction: 0.05,
    minPositionScaleMeters: 1,
    minElevationScaleMeters: 1,
    minSpeedScaleMps: 0.5,
  },
  stagnant: {
    radiusMeters: 402.34,
    maxDurationMs: 180_000,
  },
  movementWindow: {
    speedThresholdMps: MIN_SPEED_MPS,
    displacementFallbackMeters: 50,
    minSustainedSamples: 3,
  },
}

/** The schema gate contributes no points; it blocks scoring instead. */
export const SCHEMA_PARSE_WEIGHT = 0
