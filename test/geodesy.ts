import {
  ecefToGeodetic,
  ecefToEnu,
  enuToEcef,
  enuToGeodetic,
  geodeticToEcef,
  geodeticToEnu,
  type GeodeticCoordinate,
} from '../src/core/geodesy.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const equator: GeodeticCoordinate = { latDeg: 0, lonDeg: 0, heightM: 0 }
const equatorEcef = geodeticToEcef(equator)
check('Equator origin maps to WGS84 semi-major axis', Math.abs(equatorEcef.xM - 6378137) < 1e-6)
check('Equator origin has zero Y/Z', Math.abs(equatorEcef.yM) < 1e-9 && Math.abs(equatorEcef.zM) < 1e-9)

const sample: GeodeticCoordinate = { latDeg: 34.75, lonDeg: -117.5, heightM: 1280 }
const sampleRoundTrip = ecefToGeodetic(geodeticToEcef(sample))
check('Geodetic/ECEF latitude round-trips', Math.abs(sampleRoundTrip.latDeg - sample.latDeg) < 1e-8)
check('Geodetic/ECEF longitude round-trips', Math.abs(sampleRoundTrip.lonDeg - sample.lonDeg) < 1e-8)
check('Geodetic/ECEF height round-trips', Math.abs(sampleRoundTrip.heightM - sample.heightM) < 1e-3)

const origin: GeodeticCoordinate = { latDeg: 34.7, lonDeg: -117.4, heightM: 1000 }
const enu = geodeticToEnu(sample, origin)
check('ENU displacement is finite', [enu.eastM, enu.northM, enu.upM].every(Number.isFinite))
const enuRoundTrip = enuToGeodetic(enu, origin)
check('ENU latitude round-trips', Math.abs(enuRoundTrip.latDeg - sample.latDeg) < 1e-8)
check('ENU longitude round-trips', Math.abs(enuRoundTrip.lonDeg - sample.lonDeg) < 1e-8)
check('ENU height round-trips', Math.abs(enuRoundTrip.heightM - sample.heightM) < 1e-3)

const explicitEnu = { eastM: 125, northM: -40, upM: 15 }
const explicitEcef = enuToEcef(explicitEnu, origin)
const explicitRoundTrip = ecefToEnu(explicitEcef, origin)
check('ECEF/ENU east round-trips', Math.abs(explicitRoundTrip.eastM - explicitEnu.eastM) < 1e-6)
check('ECEF/ENU north round-trips', Math.abs(explicitRoundTrip.northM - explicitEnu.northM) < 1e-6)
check('ECEF/ENU up round-trips', Math.abs(explicitRoundTrip.upM - explicitEnu.upM) < 1e-6)

const northPole = ecefToGeodetic({ xM: 0, yM: 0, zM: 6356752.314245 })
check('Polar ECEF conversion is stable', Math.abs(northPole.latDeg - 90) < 1e-9)

let invalidRejected = false
try {
  geodeticToEcef({ latDeg: 100, lonDeg: 0, heightM: 0 })
} catch {
  invalidRejected = true
}
check('Invalid latitude is rejected', invalidRejected)

console.log(`\n${failures === 0 ? 'ALL GEODESY CHECKS PASSED' : `${failures} GEODESY CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
