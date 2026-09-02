import { DEFAULT_SETTINGS, SETTINGS_LIMITS, getSettings, normalizeSettings, resetSettings, updateSetting } from '../src/state/settings.ts'

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

console.log(`\n${failures === 0 ? 'ALL SETTINGS CHECKS PASSED' : `${failures} SETTINGS CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
