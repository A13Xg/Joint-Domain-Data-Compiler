import { initialBearingDegrees, shortestAngleDelta } from '../operations/angular'
import { clonePoint, haversineMeters, type ChannelDefinition, type TrackPoint } from '../model'
import type { DerivedChannelDefinition, DerivationResult } from './registry'

const OUTPUT_CHANNELS: ChannelDefinition[] = [
  { id: 'distance_m', displayName: 'Cumulative distance', unit: 'm', dataType: 'number', semanticType: 'distance' },
  { id: 'ground_speed_mps', displayName: 'Ground speed', unit: 'm/s', dataType: 'number', semanticType: 'speed' },
  { id: 'vertical_speed_mps', displayName: 'Vertical speed', unit: 'm/s', dataType: 'number', semanticType: 'vertical-speed' },
  { id: 'heading_deg', displayName: 'Heading', unit: 'deg', dataType: 'number', semanticType: 'heading' },
  { id: 'turn_rate_dps', displayName: 'Turn rate', unit: 'deg/s', dataType: 'number', semanticType: 'turn-rate' },
  { id: 'horizontal_accel_mps2', displayName: 'Horizontal acceleration', unit: 'm/s²', dataType: 'number', semanticType: 'acceleration' },
  { id: 'sample_interval_s', displayName: 'Sample interval', unit: 's', dataType: 'number', semanticType: 'sample-interval' },
  { id: 'sample_frequency_hz', displayName: 'Sample frequency', unit: 'Hz', dataType: 'number', semanticType: 'sample-frequency' },
]

export const standardKinematicsDerivation: DerivedChannelDefinition = {
  id: 'standard-kinematics',
  version: 1,
  label: 'Standard kinematics',
  description: 'Derive distance, speed, vertical speed, heading, turn rate, acceleration, and sampling metrics.',
  requiredInputs: ['latitude', 'longitude', 'time'],
  outputChannels: OUTPUT_CHANNELS,
  derive({ points }): DerivationResult {
    const out = points.map(clonePoint)
    const warnings: string[] = []
    let cumulativeDistance = 0
    let previousSpeed: number | undefined
    let previousHeading: number | undefined

    for (let index = 0; index < out.length; index++) {
      const current = out[index]
      if (!current) continue
      current.ext = { ...current.ext }
      current.ext.distance_m = round(cumulativeDistance, 3)

      if (index === 0) continue
      const previous = out[index - 1]
      if (!previous) continue

      const distance = haversineMeters(previous.lat, previous.lon, current.lat, current.lon)
      cumulativeDistance += distance
      current.ext.distance_m = round(cumulativeDistance, 3)
      current.ext.heading_deg = round(initialBearingDegrees(previous.lat, previous.lon, current.lat, current.lon), 3)

      if (current.time === undefined || previous.time === undefined) {
        addFlag(current, 'missing_timestamp')
        continue
      }

      const dt = (current.time - previous.time) / 1000
      if (dt <= 0) {
        addFlag(current, dt === 0 ? 'duplicate_timestamp' : 'non_monotonic_timestamp')
        warnings.push(`Point ${index + 1} has ${dt === 0 ? 'a duplicate' : 'a non-monotonic'} timestamp.`)
        continue
      }

      const speed = distance / dt
      current.ext.sample_interval_s = round(dt, 6)
      current.ext.sample_frequency_hz = round(1 / dt, 6)
      current.ext.ground_speed_mps = round(speed, 6)

      if (current.ele !== undefined && previous.ele !== undefined) {
        current.ext.vertical_speed_mps = round((current.ele - previous.ele) / dt, 6)
      }
      if (previousSpeed !== undefined) {
        current.ext.horizontal_accel_mps2 = round((speed - previousSpeed) / dt, 6)
      }
      const heading = Number(current.ext.heading_deg)
      if (previousHeading !== undefined && Number.isFinite(heading)) {
        current.ext.turn_rate_dps = round(shortestAngleDelta(previousHeading, heading) / dt, 6)
      }

      previousSpeed = speed
      if (Number.isFinite(heading)) previousHeading = heading
    }

    return {
      points: out,
      outputChannels: OUTPUT_CHANNELS,
      warnings,
      summary: `Derived standard kinematics for ${out.length.toLocaleString()} points`,
    }
  },
}

function addFlag(point: TrackPoint, flag: string): void {
  const flags = new Set(point.provenance?.qualityFlags ?? [])
  flags.add(flag)
  point.provenance = { ...point.provenance, qualityFlags: [...flags] }
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}
