import { DEFAULT_SETTINGS, SETTINGS_LIMITS, getSettings, normalizeSettings, resetSettings, updateDefaultMotionProfile, updateSetting, updateUnitSystem } from '../src/state/settings.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// --- normalizeSettings: defaults and malformed input ------------------------
check('undefined normalizes to all defaults', JSON.stringify(normalizeSettings(undefined)) === JSON.stringify(DEFAULT_SETTINGS))
check('null normalizes to all defaults', JSON.stringify(normalizeSettings(null)) === JSON.stringify(DEFAULT_SETTINGS))
check('a non-object (string) normalizes to all defaults', JSON.stringify(normalizeSettings('nope')) === JSON.stringify(DEFAULT_SETTINGS))
check('an array normalizes to all defaults', JSON.stringify(normalizeSettings([1, 2, 3])) === JSON.stringify(DEFAULT_SETTINGS))
check('an empty object normalizes to all defaults', JSON.stringify(normalizeSettings({})) === JSON.stringify(DEFAULT_SETTINGS))

check('a valid partial keeps its field and defaults the rest', normalizeSettings({ chartPointBudget: 2000 }).chartPointBudget === 2000
  && normalizeSettings({ chartPointBudget: 2000 }).mapPointBudget === DEFAULT_SETTINGS.mapPointBudget)

check('a string-typed field falls back to its default rather than coercing', normalizeSettings({ chartPointBudget: '2000' }).chartPointBudget === DEFAULT_SETTINGS.chartPointBudget)
check('NaN falls back to the default', normalizeSettings({ chartPointBudget: NaN }).chartPointBudget === DEFAULT_SETTINGS.chartPointBudget)
check('Infinity falls back to the default', normalizeSettings({ chartPointBudget: Infinity }).chartPointBudget === DEFAULT_SETTINGS.chartPointBudget)
check('an unrecognized extra key is ignored, not carried through', !('bogusField' in normalizeSettings({ bogusField: 1 })))

// --- clamping -----------------------------------------------------------------
check('a value below the minimum clamps up to it', normalizeSettings({ chartPointBudget: 1 }).chartPointBudget === SETTINGS_LIMITS.chartPointBudget.min)
check('a value above the maximum clamps down to it', normalizeSettings({ chartPointBudget: 999_999 }).chartPointBudget === SETTINGS_LIMITS.chartPointBudget.max)
check('a negative value clamps up to the minimum', normalizeSettings({ mapPointBudget: -500 }).mapPointBudget === SETTINGS_LIMITS.mapPointBudget.min)
check('a fractional value is rounded', normalizeSettings({ chartPointBudget: 1500.6 }).chartPointBudget === 1501)
check('each field has its own independent range', SETTINGS_LIMITS.chartPointBudget.max < SETTINGS_LIMITS.mapPointBudget.max
  && SETTINGS_LIMITS.mapPointBudget.max < SETTINGS_LIMITS.scenePointBudget.max)

// --- module-level store: updateSetting / getSettings / resetSettings ---------
// This test process has no `window`, so persistence itself no-ops (verified
// separately in the browser); this exercises the in-memory store logic only.
resetSettings()
check('getSettings starts at defaults', JSON.stringify(getSettings()) === JSON.stringify(DEFAULT_SETTINGS))

updateSetting('chartPointBudget', 3000)
check('updateSetting changes the targeted field', getSettings().chartPointBudget === 3000)
check('updateSetting leaves other fields untouched', getSettings().mapPointBudget === DEFAULT_SETTINGS.mapPointBudget)

updateSetting('chartPointBudget', 999_999)
check('updateSetting clamps out-of-range input', getSettings().chartPointBudget === SETTINGS_LIMITS.chartPointBudget.max)

resetSettings()
check('resetSettings restores every field to its default', JSON.stringify(getSettings()) === JSON.stringify(DEFAULT_SETTINGS))

// --- defaultMotionProfile: a closed string enum, not the numeric clamp path --
check('defaultMotionProfile defaults to aircraft', DEFAULT_SETTINGS.defaultMotionProfile === 'aircraft')
check('an unrecognized profile string falls back to the default', normalizeSettings({ defaultMotionProfile: 'blimp' }).defaultMotionProfile === DEFAULT_SETTINGS.defaultMotionProfile)
check('a non-string profile value falls back to the default', normalizeSettings({ defaultMotionProfile: 5 }).defaultMotionProfile === DEFAULT_SETTINGS.defaultMotionProfile)
check('a valid profile string is kept', normalizeSettings({ defaultMotionProfile: 'marine' }).defaultMotionProfile === 'marine')

updateDefaultMotionProfile('ground')
check('updateDefaultMotionProfile changes the field', getSettings().defaultMotionProfile === 'ground')
check('updateDefaultMotionProfile leaves numeric fields untouched', getSettings().chartPointBudget === DEFAULT_SETTINGS.chartPointBudget)
resetSettings()
check('resetSettings also restores defaultMotionProfile', getSettings().defaultMotionProfile === DEFAULT_SETTINGS.defaultMotionProfile)

// --- unitSystem: the second closed string enum, same path as the profile ----
check('unitSystem defaults to metric', DEFAULT_SETTINGS.unitSystem === 'metric')
check('an unrecognized unit system falls back to the default', normalizeSettings({ unitSystem: 'furlongs' }).unitSystem === DEFAULT_SETTINGS.unitSystem)
check('a non-string unit system falls back to the default', normalizeSettings({ unitSystem: 7 }).unitSystem === DEFAULT_SETTINGS.unitSystem)
check('a valid unit system is kept', normalizeSettings({ unitSystem: 'nautical' }).unitSystem === 'nautical')

updateUnitSystem('nautical')
check('updateUnitSystem changes the field', getSettings().unitSystem === 'nautical')
check('updateUnitSystem leaves the motion profile untouched', getSettings().defaultMotionProfile === DEFAULT_SETTINGS.defaultMotionProfile)
check('updateUnitSystem leaves numeric fields untouched', getSettings().chartPointBudget === DEFAULT_SETTINGS.chartPointBudget)
resetSettings()
check('resetSettings also restores unitSystem', getSettings().unitSystem === DEFAULT_SETTINGS.unitSystem)

console.log(`\n${failures === 0 ? 'ALL SETTINGS CHECKS PASSED' : `${failures} SETTINGS CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
