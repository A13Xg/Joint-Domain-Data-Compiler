import type { TrackPoint } from '../src/core/model.ts'
import { detectOutliers, medianAbsoluteDeviation } from '../src/core/quality/outliers.ts'
import { DEFAULT_TRACK_HEALTH_CONFIG } from '../src/core/quality/trackHealthConfig.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const settings = DEFAULT_TRACK_HEALTH_CONFIG.outlier
const config = {
  windowSize: settings.windowSize,
  scoreThreshold: settings.scoreThreshold,
  minPositionScaleMeters: settings.minPositionScaleMeters,
  minElevationScaleMeters: settings.minElevationScaleMeters,
  minSpeedScaleMps: settings.minSpeedScaleMps,
}
const START = 1_700_000_000_000
const COUNT = 120

// The deviations of a sorted series are V-shaped, so a MAD that forgets to re-sort them
// returns the series minimum (usually zero) instead of the median. A zero scale makes every
// later normalisation divide by the noise floor, which flags ordinary data as anomalous.
check('MAD re-sorts deviations before taking their median', medianAbsoluteDeviation([1, 2, 3, 4, 100]) === 1)
check('MAD of a constant series is zero', medianAbsoluteDeviation([7, 7, 7, 7, 7]) === 0)
check('MAD of an evenly-spaced ramp is its half-spread', medianAbsoluteDeviation([25, 50, 75, 100, 125]) === 25)
check('MAD of an empty series is zero', medianAbsoluteDeviation([]) === 0)

function straightLevel(): TrackPoint[] {
  const points: TrackPoint[] = []
  for (let index = 0; index < COUNT; index++) {
    points.push({ lat: 40 + index * 0.002, lon: -100, ele: 3000, time: START + index * 10_000, ext: { ground_speed_mps: 150 } })
  }
  return points
}

function steadyClimb(): TrackPoint[] {
  return straightLevel().map((point, index) => ({ ...point, ele: 50 + index * 25 }))
}

function smoothTurn(): TrackPoint[] {
  const points: TrackPoint[] = []
  for (let index = 0; index < COUNT; index++) {
    const angle = (index / (COUNT - 1)) * Math.PI
    points.push({
      lat: 40 + 0.2 * Math.sin(angle),
      lon: -100 + 0.2 * (1 - Math.cos(angle)),
      ele: 3000,
      time: START + index * 10_000,
      ext: { ground_speed_mps: 150 },
    })
  }
  return points
}

function accelerating(): TrackPoint[] {
  return straightLevel().map((point, index) => ({ ...point, ext: { ground_speed_mps: 100 + index * 0.5 } }))
}

const clean = detectOutliers(straightLevel(), config)
check('A clean straight-and-level track flags nothing', clean.flaggedIndices.length === 0)

// Regression guards: each of these is a perfectly ordinary flight shape whose local trend
// predicts its own midpoint, so none of them is an outlier.
check('A steady climb flags nothing', detectOutliers(steadyClimb(), config).flaggedIndices.length === 0)
check('A smooth turn flags nothing', detectOutliers(smoothTurn(), config).flaggedIndices.length === 0)
check('A constant acceleration flags nothing', detectOutliers(accelerating(), config).flaggedIndices.length === 0)

const positionSpike = straightLevel()
positionSpike[60] = { ...positionSpike[60]!, lat: positionSpike[60]!.lat + 0.5 }
const positionResult = detectOutliers(positionSpike, config)
check('Flags a displaced point', positionResult.flaggedIndices.includes(60))
check('Attributes a displaced point to the position channel', positionResult.channelByIndex.get(60) === 'position')

const elevationSpike = steadyClimb()
elevationSpike[60] = { ...elevationSpike[60]!, ele: (elevationSpike[60]!.ele ?? 0) + 900 }
const elevationResult = detectOutliers(elevationSpike, config)
check('Flags an elevation spike riding on a climb', elevationResult.flaggedIndices.includes(60))
check('Attributes an elevation spike to the elevation channel', elevationResult.channelByIndex.get(60) === 'elevation')

const speedSpike = straightLevel()
speedSpike[60] = { ...speedSpike[60]!, ext: { ground_speed_mps: 600 } }
const speedResult = detectOutliers(speedSpike, config)
check('Flags a speed spike', speedResult.flaggedIndices.includes(60))
check('Attributes a speed spike to the speed channel', speedResult.channelByIndex.get(60) === 'speed')

// Any single channel breaking its trend is enough, so one spike is one flagged point.
check('A single spike flags only that point', positionResult.flaggedIndices.length === 1)

const tooShort = detectOutliers(straightLevel().slice(0, 8), config)
check('Returns nothing when the track is shorter than a full window', tooShort.flaggedIndices.length === 0 && tooShort.scoreByIndex.size === 0)

check('Scores every point that has a full window on both sides', clean.scoreByIndex.size === COUNT - config.windowSize * 2)

console.log(`\n${failures === 0 ? 'ALL OUTLIER CHECKS PASSED' : `${failures} OUTLIER CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
