import { haversineMeters, isValidLat, isValidLon, type TrackPoint } from '../model'
import type { TrackHealthCheckDefinition, TrackHealthCheckResult, TrackHealthFlag } from './trackHealthTypes'
import { detectOutliers } from './outliers'
import { derivePointSpeeds } from './movementWindow'

/** Cap on individually-listed drill-down chips, so one bad track can't render thousands of buttons. */
const MAX_LISTED_FLAGS = 20

interface IndexedPoint {
  point: TrackPoint
  /** Index into the source `Dataset.points`, preserved across filtering so drill-down targets stay correct. */
  index: number
}

function withIndex(points: readonly TrackPoint[]): IndexedPoint[] {
  return points.map((point, index) => ({ point, index }))
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  const mid = sorted.length / 2
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : sorted[Math.floor(mid)]
}

function notApplicable(id: TrackHealthCheckResult['id'], label: string, weight: number, summary: string, preferredTab: 'map' | 'charts'): TrackHealthCheckResult {
  return { id, label, status: 'na', weight, pointsAwarded: 0, summary, flags: [], preferredTab }
}

export const schemaParseCheck: TrackHealthCheckDefinition = {
  id: 'schema-parse',
  label: 'Schema / Parse',
  weight: 0,
  blocking: true,
  isApplicable: () => true,
  run: (points, dataset, config) => {
    if (points.length === 0) {
      return { id: 'schema-parse', label: 'Schema / Parse', status: 'fail', weight: 0, pointsAwarded: 0, summary: 'Dataset contains no points', flags: [], preferredTab: 'map', details: ['Empty dataset'] }
    }

    const invalid = withIndex(points).filter(({ point }) => !isValidLat(point.lat) || !isValidLon(point.lon))
    const validCount = points.length - invalid.length
    const validFraction = validCount / points.length
    const flags: TrackHealthFlag[] = invalid.slice(0, MAX_LISTED_FLAGS).map(({ index }) => ({ pointIndex: index, label: `Invalid coordinate at #${index}` }))

    if (validFraction < config.schemaParse.minValidCoordinateFraction) {
      return {
        id: 'schema-parse',
        label: 'Schema / Parse',
        status: 'fail',
        weight: 0,
        pointsAwarded: 0,
        summary: `Only ${(validFraction * 100).toFixed(1)}% of points have valid coordinates`,
        flags,
        preferredTab: 'map',
        details: dataset.warnings.length > 0 ? [...dataset.warnings] : undefined,
        measurements: { validCount, invalidCount: invalid.length, validFraction },
      }
    }

    const details = [`✓ ${validCount.toLocaleString()}/${points.length.toLocaleString()} points have valid coordinates`]
    if (dataset.warnings.length > 0) {
      details.push(`${dataset.warnings.length} parse warning(s):`, ...dataset.warnings.map((warning) => `  • ${warning}`))
    }

    return {
      id: 'schema-parse',
      label: 'Schema / Parse',
      status: 'pass',
      weight: 0,
      pointsAwarded: 0,
      summary: 'Dataset structure is sound',
      flags,
      preferredTab: 'map',
      details,
      measurements: { validCount, invalidCount: invalid.length, validFraction },
    }
  },
}

export const altitudeProfileCheck: TrackHealthCheckDefinition = {
  id: 'altitude-profile',
  label: 'Altitude Profile',
  weight: 30,
  isApplicable: (points, _dataset, config) => {
    if (points.length === 0) return false
    const withElevation = points.filter((point) => point.ele !== undefined).length
    return withElevation / points.length >= config.altitudeProfile.minElevationCoverage
  },
  run: (points, _dataset, config) => {
    const settings = config.altitudeProfile
    const elevated = withIndex(points).filter(({ point }) => point.ele !== undefined)
    if (elevated.length === 0) {
      return notApplicable('altitude-profile', 'Altitude Profile', altitudeProfileCheck.weight, 'No altitude data available', 'charts')
    }

    const elevations = elevated.map(({ point }) => point.ele as number)
    const startEle = median(elevations.slice(0, settings.groundSampleCount)) ?? 0
    const endEle = median(elevations.slice(-settings.groundSampleCount)) ?? 0
    const maxEle = Math.max(...elevations)

    // Longest contiguous run at or above the floor, tracked in `elevated` positions.
    let bestStart = -1
    let bestEnd = -1
    let bestLength = 0
    let runStart = -1
    for (let position = 0; position <= elevated.length; position++) {
      const above = position < elevated.length && (elevations[position] ?? -Infinity) >= settings.floorMeters
      if (above) {
        if (runStart < 0) runStart = position
        continue
      }
      if (runStart >= 0) {
        const length = position - runStart
        if (length > bestLength) { bestLength = length; bestStart = runStart; bestEnd = position - 1 }
        runStart = -1
      }
    }

    const firstTime = elevated[0]?.point.time
    const lastTime = elevated[elevated.length - 1]?.point.time
    const timed = firstTime !== undefined && lastTime !== undefined
    const totalDuration = timed ? lastTime - firstTime : elevated.length
    let sustainedDuration = 0
    if (bestStart >= 0) {
      const runStartTime = elevated[bestStart]?.point.time
      const runEndTime = elevated[bestEnd]?.point.time
      sustainedDuration = timed && runStartTime !== undefined && runEndTime !== undefined ? runEndTime - runStartTime : bestLength
    }

    const flags: TrackHealthFlag[] = []
    const details: string[] = []

    const climbEstablished = bestStart > 0 && bestStart < elevated.length * settings.maxClimbStartFraction
    if (climbEstablished) {
      details.push('✓ Climb through the floor established')
    } else if (bestStart < 0) {
      details.push(`✗ Track never climbs above ${settings.floorMeters.toFixed(0)} m`)
    } else {
      details.push('✗ Climb not established early enough in the track')
      flags.push({ pointIndex: elevated[bestStart]?.index ?? 0, label: 'Climb established here' })
    }

    const descentComplete = bestEnd >= 0 && bestEnd < elevated.length - 1
    if (descentComplete) {
      details.push('✓ Descent back below the floor before the track ends')
    } else {
      details.push('✗ Track ends before descending back below the floor')
      if (bestEnd >= 0) flags.push({ pointIndex: elevated[bestEnd]?.index ?? 0, label: 'Last sample above floor' })
    }

    const tolerance = Math.max(settings.startEndToleranceMeters, settings.startEndToleranceFraction * Math.max(0, maxEle - settings.floorMeters))
    const startEndOk = Math.abs(endEle - startEle) <= tolerance
    details.push(startEndOk
      ? '✓ Start and end altitude within tolerance'
      : `✗ Start/end altitude differs by ${Math.abs(endEle - startEle).toFixed(0)} m (tolerance ${tolerance.toFixed(0)} m)`)

    const sustainedOk = bestStart >= 0 && sustainedDuration >= totalDuration * settings.minSustainedFraction
    details.push(sustainedOk
      ? '✓ Sustained above the floor for a meaningful portion of the track'
      : '✗ Time spent above the floor is too short to be a full flight')

    const pass = climbEstablished && descentComplete && startEndOk && sustainedOk
    return {
      id: 'altitude-profile',
      label: 'Altitude Profile',
      status: pass ? 'pass' : 'fail',
      weight: altitudeProfileCheck.weight,
      pointsAwarded: pass ? altitudeProfileCheck.weight : 0,
      summary: pass ? 'Track covers takeoff, flight, and landing' : 'Track does not match the expected flight profile',
      details,
      flags,
      preferredTab: 'charts',
      measurements: { startEle, endEle, maxEle, tolerance, sustainedDurationMs: sustainedDuration, totalDurationMs: totalDuration },
    }
  },
}

export const speedEnvelopeCheck: TrackHealthCheckDefinition = {
  id: 'speed-envelope',
  label: 'Speed Envelope',
  weight: 10,
  isApplicable: (_points, _dataset, _config, shared) => shared.movementWindow !== null,
  run: (points, _dataset, config, shared) => {
    const window = shared.movementWindow
    if (!window) return notApplicable('speed-envelope', 'Speed Envelope', speedEnvelopeCheck.weight, 'Track has no timestamps, so speed cannot be derived', 'charts')

    const { minSpeedMps, maxSpeedMps, maxViolationFraction, leadInIgnoreFraction } = config.speedEnvelope
    const speeds = derivePointSpeeds(points)
    const violations: TrackHealthFlag[] = []
    let sampled = 0

    // An aircraft is routinely parked for the head of a recording, sitting under the
    // 10 kt floor without anything being wrong. The movement window already trims most
    // of that, but a taxi that dips below the floor can leave the window open across it,
    // so this check skips the leading share of the file outright. It is a scoring window
    // only — no sample is dropped from the dataset, and every other check still sees them.
    const leadInEnd = Math.floor(points.length * leadInIgnoreFraction)
    const startIndex = Math.max(window.startIndex, leadInEnd)

    for (let index = startIndex; index <= window.endIndex && index < points.length; index++) {
      const speed = speeds[index]
      if (speed === undefined) continue
      sampled++
      if (speed < minSpeedMps || speed > maxSpeedMps) {
        violations.push({ pointIndex: index, label: `${speed.toFixed(1)} m/s at #${index}` })
      }
    }

    if (sampled === 0) {
      const reason = startIndex > window.startIndex
        ? `No speed samples after the first ${(leadInIgnoreFraction * 100).toFixed(0)}% of the file, which this check ignores`
        : 'No speed samples inside the movement window'
      return notApplicable('speed-envelope', 'Speed Envelope', speedEnvelopeCheck.weight, reason, 'charts')
    }

    const violationFraction = violations.length / sampled
    const pass = violationFraction <= maxViolationFraction
    const flags = violations.slice(0, MAX_LISTED_FLAGS)
    if (violations.length > MAX_LISTED_FLAGS) {
      flags.push({ range: { start: violations[0]?.pointIndex ?? 0, end: violations[violations.length - 1]?.pointIndex ?? 0 }, label: `All ${violations.length} violations` })
    }

    return {
      id: 'speed-envelope',
      label: 'Speed Envelope',
      status: pass ? 'pass' : 'fail',
      weight: speedEnvelopeCheck.weight,
      pointsAwarded: pass ? speedEnvelopeCheck.weight : 0,
      summary: pass
        ? 'Speed stays within 10 kt – Mach 2 while under way'
        : `${violations.length} of ${sampled} in-window samples (${(violationFraction * 100).toFixed(1)}%) fall outside 10 kt – Mach 2`,
      details: startIndex > window.startIndex
        ? [`Ignores the first ${(leadInIgnoreFraction * 100).toFixed(0)}% of the file (#0–#${leadInEnd - 1}), where an aircraft is commonly parked`]
        : undefined,
      flags,
      preferredTab: 'charts',
      measurements: { sampled, violations: violations.length, violationFraction, leadInEndIndex: leadInEnd, scoredFromIndex: startIndex },
    }
  },
}

export const timeOrderSpanCheck: TrackHealthCheckDefinition = {
  id: 'time-order-span',
  label: 'Time Order & Span',
  weight: 20,
  isApplicable: (points) => points.filter((point) => point.time !== undefined).length >= 2,
  run: (points, _dataset, config) => {
    const timed = withIndex(points).filter(({ point }) => point.time !== undefined)
    if (timed.length < 2) return notApplicable('time-order-span', 'Time Order & Span', timeOrderSpanCheck.weight, 'Fewer than two timestamped points', 'charts')

    const outOfOrder: TrackHealthFlag[] = []
    for (let position = 1; position < timed.length; position++) {
      const current = timed[position]
      const previous = timed[position - 1]
      if (!current || !previous) continue
      if ((current.point.time as number) < (previous.point.time as number)) {
        outOfOrder.push({ pointIndex: current.index, label: `Out-of-order timestamp at #${current.index}` })
      }
    }

    const details: string[] = []
    details.push(outOfOrder.length === 0 ? '✓ Timestamps are non-decreasing' : `✗ ${outOfOrder.length} out-of-order timestamp(s)`)

    const spanMs = (timed[timed.length - 1]?.point.time as number) - (timed[0]?.point.time as number)
    const { minSpanMs, maxSpanMs } = config.timeOrderSpan
    const spanOk = spanMs >= minSpanMs && spanMs <= maxSpanMs
    if (spanMs < minSpanMs) details.push(`✗ Track spans ${(spanMs / 60_000).toFixed(1)} min, under the 10 min minimum`)
    else if (spanMs > maxSpanMs) details.push(`✗ Track spans ${(spanMs / 3_600_000).toFixed(1)} h, over the 12 h maximum`)
    else details.push(`✓ Track spans ${(spanMs / 60_000).toFixed(1)} min, within 10 min – 12 h`)

    const pass = outOfOrder.length === 0 && spanOk
    return {
      id: 'time-order-span',
      label: 'Time Order & Span',
      status: pass ? 'pass' : 'fail',
      weight: timeOrderSpanCheck.weight,
      pointsAwarded: pass ? timeOrderSpanCheck.weight : 0,
      summary: pass ? 'Timestamps are ordered and the span is plausible' : 'Timestamp ordering or span is out of bounds',
      details,
      flags: outOfOrder.slice(0, MAX_LISTED_FLAGS),
      preferredTab: 'charts',
      measurements: { spanMs, outOfOrder: outOfOrder.length },
    }
  },
}

export const outlierCheck: TrackHealthCheckDefinition = {
  id: 'outlier',
  label: 'Outliers',
  weight: 20,
  isApplicable: (points, _dataset, config) => points.length >= config.outlier.windowSize * 2 + 1,
  run: (points, _dataset, config) => {
    const settings = config.outlier
    const result = detectOutliers(points, {
      windowSize: settings.windowSize,
      scoreThreshold: settings.scoreThreshold,
      minPositionScaleMeters: settings.minPositionScaleMeters,
      minElevationScaleMeters: settings.minElevationScaleMeters,
      minSpeedScaleMps: settings.minSpeedScaleMps,
    })

    const evaluated = result.scoreByIndex.size
    if (evaluated === 0) return notApplicable('outlier', 'Outliers', outlierCheck.weight, 'Track is too short to establish a local trend', 'map')

    const flaggedFraction = result.flaggedIndices.length / evaluated
    const pass = flaggedFraction <= settings.maxFlaggedFraction

    const flags: TrackHealthFlag[] = result.flaggedIndices.slice(0, MAX_LISTED_FLAGS).map((index) => ({
      pointIndex: index,
      label: `${result.channelByIndex.get(index) ?? 'position'} outlier at #${index} (${(result.scoreByIndex.get(index) ?? 0).toFixed(1)}σ)`,
    }))
    if (result.flaggedIndices.length > MAX_LISTED_FLAGS) {
      flags.push({
        range: { start: result.flaggedIndices[0] ?? 0, end: result.flaggedIndices[result.flaggedIndices.length - 1] ?? 0 },
        label: `All ${result.flaggedIndices.length} outliers`,
      })
    }

    return {
      id: 'outlier',
      label: 'Outliers',
      status: pass ? 'pass' : 'fail',
      weight: outlierCheck.weight,
      pointsAwarded: pass ? outlierCheck.weight : 0,
      summary: pass
        ? `No significant outliers (${result.flaggedIndices.length} of ${evaluated} points, ${(flaggedFraction * 100).toFixed(1)}%)`
        : `${result.flaggedIndices.length} of ${evaluated} points (${(flaggedFraction * 100).toFixed(1)}%) break the local trend`,
      flags,
      preferredTab: 'map',
      measurements: { evaluated, flagged: result.flaggedIndices.length, flaggedFraction },
    }
  },
}

export const stagnantCheck: TrackHealthCheckDefinition = {
  id: 'stagnant',
  label: 'Stagnant',
  weight: 20,
  isApplicable: (_points, _dataset, _config, shared) => shared.movementWindow !== null,
  run: (points, _dataset, config, shared) => {
    const window = shared.movementWindow
    if (!window) return notApplicable('stagnant', 'Stagnant', stagnantCheck.weight, 'Track has no timestamps, so dwell time cannot be measured', 'map')

    const { radiusMeters, maxDurationMs } = config.stagnant
    const flags: TrackHealthFlag[] = []
    const limit = Math.min(window.endIndex, points.length - 1)

    let anchorIndex = window.startIndex
    while (anchorIndex <= limit) {
      const anchor = points[anchorIndex]
      if (!anchor || anchor.time === undefined) { anchorIndex++; continue }

      // Extend while the track stays inside the radius of this anchor.
      let cursor = anchorIndex + 1
      while (cursor <= limit) {
        const point = points[cursor]
        if (!point || haversineMeters(anchor.lat, anchor.lon, point.lat, point.lon) > radiusMeters) break
        cursor++
      }

      const lastIndex = cursor - 1
      const last = points[lastIndex]
      if (lastIndex > anchorIndex && last && last.time !== undefined) {
        const duration = last.time - anchor.time
        if (duration > maxDurationMs) {
          flags.push({ range: { start: anchorIndex, end: lastIndex }, label: `Stationary ${(duration / 60_000).toFixed(1)} min from #${anchorIndex}` })
        }
      }

      anchorIndex = Math.max(anchorIndex + 1, lastIndex + 1)
    }

    const pass = flags.length === 0
    return {
      id: 'stagnant',
      label: 'Stagnant',
      status: pass ? 'pass' : 'fail',
      weight: stagnantCheck.weight,
      pointsAwarded: pass ? stagnantCheck.weight : 0,
      summary: pass
        ? 'No prolonged stationary segments while under way'
        : `${flags.length} segment(s) stayed within ${(radiusMeters / 1609.34).toFixed(2)} mi for over ${(maxDurationMs / 60_000).toFixed(0)} min`,
      flags: flags.slice(0, MAX_LISTED_FLAGS),
      preferredTab: 'map',
      measurements: { segments: flags.length },
    }
  },
}

/** The schema gate runs first; computeTrackHealth relies on it being the blocking entry. */
export const TRACK_HEALTH_CHECKS: TrackHealthCheckDefinition[] = [
  schemaParseCheck,
  altitudeProfileCheck,
  speedEnvelopeCheck,
  timeOrderSpanCheck,
  outlierCheck,
  stagnantCheck,
]
