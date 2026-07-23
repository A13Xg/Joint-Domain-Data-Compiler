export interface GeodeticCoordinate {
  latDeg: number
  lonDeg: number
  heightM: number
}

export interface EcefCoordinate {
  xM: number
  yM: number
  zM: number
}

export interface EnuCoordinate {
  eastM: number
  northM: number
  upM: number
}

const WGS84_A_M = 6378137
const WGS84_F = 1 / 298.257223563
const WGS84_E2 = WGS84_F * (2 - WGS84_F)
const WGS84_B_M = WGS84_A_M * (1 - WGS84_F)
const WGS84_EP2 = (WGS84_A_M ** 2 - WGS84_B_M ** 2) / WGS84_B_M ** 2

export function geodeticToEcef(coordinate: GeodeticCoordinate): EcefCoordinate {
  validateGeodetic(coordinate)
  const lat = toRad(coordinate.latDeg)
  const lon = toRad(coordinate.lonDeg)
  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const radius = WGS84_A_M / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat)

  return {
    xM: (radius + coordinate.heightM) * cosLat * Math.cos(lon),
    yM: (radius + coordinate.heightM) * cosLat * Math.sin(lon),
    zM: (radius * (1 - WGS84_E2) + coordinate.heightM) * sinLat,
  }
}

export function ecefToGeodetic(coordinate: EcefCoordinate): GeodeticCoordinate {
  validateEcef(coordinate)
  const p = Math.hypot(coordinate.xM, coordinate.yM)
  if (p < 1e-9) {
    return {
      latDeg: coordinate.zM >= 0 ? 90 : -90,
      lonDeg: 0,
      heightM: Math.abs(coordinate.zM) - WGS84_B_M,
    }
  }

  const lon = Math.atan2(coordinate.yM, coordinate.xM)
  const theta = Math.atan2(coordinate.zM * WGS84_A_M, p * WGS84_B_M)
  const sinTheta = Math.sin(theta)
  const cosTheta = Math.cos(theta)
  const lat = Math.atan2(
    coordinate.zM + WGS84_EP2 * WGS84_B_M * sinTheta ** 3,
    p - WGS84_E2 * WGS84_A_M * cosTheta ** 3,
  )
  const sinLat = Math.sin(lat)
  const radius = WGS84_A_M / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat)
  const heightM = p / Math.cos(lat) - radius

  return { latDeg: toDeg(lat), lonDeg: normalizeLongitude(toDeg(lon)), heightM }
}

export function ecefToEnu(point: EcefCoordinate, origin: GeodeticCoordinate): EnuCoordinate {
  const originEcef = geodeticToEcef(origin)
  const dx = point.xM - originEcef.xM
  const dy = point.yM - originEcef.yM
  const dz = point.zM - originEcef.zM
  const lat = toRad(origin.latDeg)
  const lon = toRad(origin.lonDeg)
  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const sinLon = Math.sin(lon)
  const cosLon = Math.cos(lon)

  return {
    eastM: -sinLon * dx + cosLon * dy,
    northM: -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz,
    upM: cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz,
  }
}

export function enuToEcef(point: EnuCoordinate, origin: GeodeticCoordinate): EcefCoordinate {
  validateEnu(point)
  const originEcef = geodeticToEcef(origin)
  const lat = toRad(origin.latDeg)
  const lon = toRad(origin.lonDeg)
  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const sinLon = Math.sin(lon)
  const cosLon = Math.cos(lon)

  const dx = -sinLon * point.eastM - sinLat * cosLon * point.northM + cosLat * cosLon * point.upM
  const dy = cosLon * point.eastM - sinLat * sinLon * point.northM + cosLat * sinLon * point.upM
  const dz = cosLat * point.northM + sinLat * point.upM

  return { xM: originEcef.xM + dx, yM: originEcef.yM + dy, zM: originEcef.zM + dz }
}

export function geodeticToEnu(point: GeodeticCoordinate, origin: GeodeticCoordinate): EnuCoordinate {
  return ecefToEnu(geodeticToEcef(point), origin)
}

export function enuToGeodetic(point: EnuCoordinate, origin: GeodeticCoordinate): GeodeticCoordinate {
  return ecefToGeodetic(enuToEcef(point, origin))
}

function validateGeodetic(coordinate: GeodeticCoordinate): void {
  if (!Number.isFinite(coordinate.latDeg) || coordinate.latDeg < -90 || coordinate.latDeg > 90) {
    throw new Error(`Invalid latitude: ${coordinate.latDeg}`)
  }
  if (!Number.isFinite(coordinate.lonDeg) || coordinate.lonDeg < -180 || coordinate.lonDeg > 180) {
    throw new Error(`Invalid longitude: ${coordinate.lonDeg}`)
  }
  if (!Number.isFinite(coordinate.heightM)) throw new Error(`Invalid height: ${coordinate.heightM}`)
}

function validateEcef(coordinate: EcefCoordinate): void {
  if (![coordinate.xM, coordinate.yM, coordinate.zM].every(Number.isFinite)) {
    throw new Error('ECEF coordinates must be finite')
  }
}

function validateEnu(coordinate: EnuCoordinate): void {
  if (![coordinate.eastM, coordinate.northM, coordinate.upM].every(Number.isFinite)) {
    throw new Error('ENU coordinates must be finite')
  }
}

function normalizeLongitude(value: number): number {
  return ((value + 540) % 360) - 180
}

function toRad(value: number): number {
  return value * Math.PI / 180
}

function toDeg(value: number): number {
  return value * 180 / Math.PI
}
