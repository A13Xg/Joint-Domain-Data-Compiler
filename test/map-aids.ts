import { graticuleLines, graticuleStep, measureLegs, niceScale, wrapLongitude } from '../src/visualization/map/mapAids.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// Scale bar
const metric = niceScale(10, 120, 'metric')! // 1,200 m available
check('metric scale rounds down to 1/2/5 × 10ⁿ', metric.label === '1 km' && Math.abs(metric.widthPx - 100) < 1e-9, JSON.stringify(metric))
const shortMetric = niceScale(0.5, 120, 'metric')! // 60 m available
check('short metric scale stays in metres', shortMetric.label === '50 m' && Math.abs(shortMetric.widthPx - 100) < 1e-9)
const nm = niceScale(50, 120, 'nautical')! // 6,000 m ≈ 3.24 NM
check('nautical scale uses NM once one fits', nm.label === '2 NM' && Math.abs(nm.widthPx - 2 * 1852 / 50) < 1e-9, JSON.stringify(nm))
const ft = niceScale(1, 120, 'nautical')! // 120 m ≈ 393.7 ft
check('short nautical scale uses feet', ft.label === '200 ft' && Math.abs(ft.widthPx - 200 * 0.3048) < 1e-9, JSON.stringify(ft))
check('the bar never exceeds the space it was given', [0.01, 0.3, 7, 123, 5000].every((mpp) => (niceScale(mpp, 150, 'metric')?.widthPx ?? 0) <= 150 && (niceScale(mpp, 150, 'nautical')?.widthPx ?? 0) <= 150))
check('degenerate resolution gives no bar', niceScale(0, 100, 'metric') === null && niceScale(Number.NaN, 100, 'metric') === null)

// Grid
check('a 10° view gets whole-degree lines', graticuleStep(10) === 1)
check('a 0.2° view gets fine lines', graticuleStep(0.2) === 0.025)
check('a world view is capped at 30°', graticuleStep(360) === 30)
check('wrapLongitude folds world copies back into ±180', wrapLongitude(190) === -170 && wrapLongitude(-190) === 170 && wrapLongitude(540) === -180 && wrapLongitude(12.5) === 12.5)
const across = graticuleLines({ south: -1, north: 1, west: 175, east: 185 }, 5)
check('meridians across the antimeridian keep map positions', across.meridians.map((m) => m.value).join() === '175,180,185')
check('…and label them in ±180', across.meridians.map((m) => m.label).join() === '175°E,180°,175°W', across.meridians.map((m) => m.label).join())
const fine = graticuleLines({ south: 38.81, north: 38.93, west: -77.2, east: -76.87 }, 0.05)
check('fine parallels carry enough decimals', fine.parallels[0]!.label === '38.85°N' && fine.meridians[0]!.label === '77.20°W', `${fine.parallels[0]!.label} ${fine.meridians[0]!.label}`)
check('lines are clamped to the poles', graticuleLines({ south: -120, north: 120, west: 0, east: 1 }, 30).parallels.every((p) => Math.abs(p.value) <= 90))
check('line count is capped', graticuleLines({ south: -90, north: 90, west: -1e6, east: 1e6 }, 0.0001).meridians.length <= 200)

// Measure
const legs = measureLegs([{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }])
check('one degree of longitude at the equator is ~111.2 km', Math.abs(legs[0]!.distanceM - 111195) < 5, `${legs[0]!.distanceM.toFixed(0)} m`)
check('due east is 90°, due north is 0°', Math.abs(legs[0]!.bearingDeg - 90) < 1e-9 && Math.abs(legs[1]!.bearingDeg) < 1e-9)
check('cumulative distance adds the legs', Math.abs(legs[1]!.cumulativeM - (legs[0]!.distanceM + legs[1]!.distanceM)) < 1e-6)
const dateline = measureLegs([{ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 }])
check('a leg across the antimeridian is the short way round', Math.abs(dateline[0]!.distanceM - 111195) < 5 && Math.abs(dateline[0]!.bearingDeg - 90) < 1e-6)
check('fewer than two vertices measure nothing', measureLegs([{ lat: 1, lon: 1 }]).length === 0)

console.log(`\n${failures === 0 ? 'ALL MAP AID CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
