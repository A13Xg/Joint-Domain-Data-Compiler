import type { Dataset } from './model'

export type CompatibilityLevel = 'compatible' | 'warning' | 'blocked'

export interface MetadataCompatibility {
  level: CompatibilityLevel
  reasons: string[]
}

export function assessDatasetCompatibility(left: Dataset, right: Dataset): MetadataCompatibility {
  const leftAltitude = left.metadata?.altitudeReference ?? 'UNKNOWN'
  const rightAltitude = right.metadata?.altitudeReference ?? 'UNKNOWN'
  const leftTime = left.metadata?.timeReference ?? 'UNKNOWN'
  const rightTime = right.metadata?.timeReference ?? 'UNKNOWN'
  const reasons: string[] = []
  let level: CompatibilityLevel = 'compatible'

  if (leftAltitude === 'UNKNOWN' || rightAltitude === 'UNKNOWN') {
    level = 'warning'
    reasons.push('One or both datasets have an unknown altitude reference.')
  } else if (leftAltitude !== rightAltitude) {
    level = 'blocked'
    reasons.push(`Altitude references differ (${leftAltitude} vs ${rightAltitude}).`)
  }
  if (leftTime === 'UNKNOWN' || rightTime === 'UNKNOWN') {
    if (level === 'compatible') level = 'warning'
    reasons.push('One or both datasets have an unknown time reference.')
  } else if (leftTime !== rightTime) {
    level = 'blocked'
    reasons.push(`Time references differ (${leftTime} vs ${rightTime}).`)
  }
  return { level, reasons }
}
