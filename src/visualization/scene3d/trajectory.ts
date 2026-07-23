import { geodeticToEnu, type GeodeticCoordinate } from '../../core/geodesy'
import { isValidLat, isValidLon, type TrackPoint } from '../../core/model'

export interface Trajectory3dOptions {
  origin?: GeodeticCoordinate
  altitudeExaggeration?: number
  maxPoints?: number
  colorChannelId?: string
}

export interface Trajectory3dVertex {
  sourceIndex: number
  eastM: number
  northM: number
  upM: number
  colorValue?: number
}

export interface Trajectory3dBounds {
  minEastM: number
  maxEastM: number
  minNorthM: number
  maxNorthM: number
  minUpM: number
  maxUpM: number
}

export interface Trajectory3dGeometry {
  origin: GeodeticCoordinate
  vertices: Trajectory3dVertex[]
  bounds: Trajectory3dBounds
  sourcePointCount: number
  validPointCount: number
  renderedPointCount: number
  colorRange?: { min: number; max: number }
}

export function buildTrajectory3dGeometry(
  points: readonly TrackPoint[],
  options: Trajectory3dOptions = {},
): Trajectory3dGeometry {
  const altitudeExaggeration = options.altitudeExaggeration ?? 1
  const maxPoints = options.maxPoints ?? 20_000
  if (!Number.isFinite(altitudeExaggeration) || altitudeExaggeration <= 0) {
    throw new Error('altitudeExaggeration must be a positive finite number')
  }
  if (!Number.isInteger(maxPoints) || maxPoints < 2) {
    throw new Error('maxPoints must be an integer of at least 2')
  }

  const valid = points
    .map((point, sourceIndex) => ({ point, sourceIndex }))
    .filter(({ point }) => isValidLat(point.lat) && isValidLon(point.lon))
  if (valid.length === 0) throw new Error('3D trajectory requires at least one valid coordinate')

  const first = valid[0]!.point
  const origin = options.origin ?? { latDeg: first.lat, lonDeg: first.lon, heightM: first.ele ?? 0 }
  const sampled = uniformSamplePreservingEndpoints(valid, maxPoints)
  const vertices: Trajectory3dVertex[] = sampled.map(({ point, sourceIndex }) => {
    const enu = geodeticToEnu(
      { latDeg: point.lat, lonDeg: point.lon, heightM: point.ele ?? origin.heightM },
      origin,
    )
    const colorValue = numericChannel(point, options.colorChannelId)
    return {
      sourceIndex,
      eastM: enu.eastM,
      northM: enu.northM,
      upM: enu.upM * altitudeExaggeration,
      colorValue: colorValue ?? undefined,
    }
  })

  return {
    origin,
    vertices,
    bounds: computeBounds(vertices),
    sourcePointCount: points.length,
    validPointCount: valid.length,
    renderedPointCount: vertices.length,
    colorRange: computeColorRange(vertices),
  }
}

function uniformSamplePreservingEndpoints<T>(values: readonly T[], maxPoints: number): T[] {
  if (values.length <= maxPoints) return [...values]
  const sampled: T[] = [values[0]!]
  const interiorCount = maxPoints - 2
  const span = values.length - 1
  for (let index = 1; index <= interiorCount; index++) {
    const sourceIndex = Math.round((index * span) / (interiorCount + 1))
    sampled.push(values[sourceIndex]!)
  }
  sampled.push(values[values.length - 1]!)
  return sampled
}

function computeBounds(vertices: readonly Trajectory3dVertex[]): Trajectory3dBounds {
  let minEastM = Infinity
  let maxEastM = -Infinity
  let minNorthM = Infinity
  let maxNorthM = -Infinity
  let minUpM = Infinity
  let maxUpM = -Infinity
  for (const vertex of vertices) {
    minEastM = Math.min(minEastM, vertex.eastM)
    maxEastM = Math.max(maxEastM, vertex.eastM)
    minNorthM = Math.min(minNorthM, vertex.northM)
    maxNorthM = Math.max(maxNorthM, vertex.northM)
    minUpM = Math.min(minUpM, vertex.upM)
    maxUpM = Math.max(maxUpM, vertex.upM)
  }
  return { minEastM, maxEastM, minNorthM, maxNorthM, minUpM, maxUpM }
}

function computeColorRange(vertices: readonly Trajectory3dVertex[]): { min: number; max: number } | undefined {
  const values = vertices.map((vertex) => vertex.colorValue).filter((value): value is number => value !== undefined)
  if (values.length === 0) return undefined
  return { min: Math.min(...values), max: Math.max(...values) }
}

function numericChannel(point: TrackPoint, channelId: string | undefined): number | null {
  if (!channelId) return null
  const value = channelId === 'elevation' ? point.ele : point.ext?.[channelId]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
