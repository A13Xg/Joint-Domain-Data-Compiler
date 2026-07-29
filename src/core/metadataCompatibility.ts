import { computeBounds, type BoundingBox, type Dataset } from './model'

export type CompatibilityLevel = 'compatible' | 'warning' | 'blocked'

export interface MetadataCompatibility {
  level: CompatibilityLevel
  reasons: string[]
}

export interface FusionSourceCompatibility {
  datasetId: string
  datasetName: string
  coordinateSystem: string | null
  altitudeReference: string
  timeReference: string
  pointCount: number
  bounds: BoundingBox | null
}

/** Durable, input-derived evidence for the pre-fusion compatibility gate. */
export interface FusionCompatibility {
  level: CompatibilityLevel
  reasons: string[]
  sources: FusionSourceCompatibility[]
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

/**
 * Screen datasets before time grouping or auto-combine. This gate only
 * accepts an explicitly shared coordinate label and valid normalized spatial
 * coverage; it never guesses or constructs a common reference frame.
 */
export function assessFusionCompatibility(datasets: readonly Dataset[]): FusionCompatibility {
  const sources = datasets.map((dataset): FusionSourceCompatibility => ({
    datasetId: dataset.id,
    datasetName: dataset.name,
    coordinateSystem: dataset.metadata?.coordinateSystem?.trim() || null,
    altitudeReference: dataset.metadata?.altitudeReference ?? 'UNKNOWN',
    timeReference: dataset.metadata?.timeReference ?? 'UNKNOWN',
    pointCount: dataset.points.length,
    bounds: computeBounds(dataset.points),
  }))
  const reasons: string[] = []
  let level: CompatibilityLevel = 'compatible'
  const block = (reason: string) => { level = 'blocked'; reasons.push(reason) }
  const warn = (reason: string) => { if (level === 'compatible') level = 'warning'; reasons.push(reason) }

  if (datasets.length < 2) block('Select at least two datasets with explicitly comparable spatial metadata.')
  const coordinateSystems = new Set(sources.map((source) => source.coordinateSystem))
  if (sources.some((source) => source.coordinateSystem === null)) {
    block('Every selected dataset must declare a coordinate system; fusion will not invent a common frame.')
  } else if (coordinateSystems.size > 1) {
    block(`Coordinate systems differ (${sources.map((source) => `${source.datasetName}: ${source.coordinateSystem}`).join(', ')}). Reproject the sources explicitly before fusion.`)
  }
  for (const source of sources) {
    if (!source.bounds) block(`${source.datasetName} has no valid latitude/longitude coverage to compare spatially.`)
  }
  for (let i = 1; i < datasets.length; i++) {
    const compatibility = assessDatasetCompatibility(datasets[0]!, datasets[i]!)
    if (compatibility.level === 'blocked') compatibility.reasons.forEach((reason) => block(`${datasets[0]!.name} and ${datasets[i]!.name}: ${reason}`))
    else if (compatibility.level === 'warning') compatibility.reasons.forEach(warn)
  }
  return { level, reasons, sources }
}
