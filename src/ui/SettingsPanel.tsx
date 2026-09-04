// App-level preferences — see `state/settings.ts` for why these live outside
// any project. Deliberately small: three point budgets and a default motion
// profile today, but the store takes new settings without restructuring
// (each field is read/normalized independently), matching the roadmap's
// "Settings page" requirement.
import { MOTION_PROFILES, MOTION_PROFILE_IDS, type MotionProfileId } from '../core/operations/motionProfiles'
import { DEFAULT_SETTINGS, SETTINGS_LIMITS, resetSettings, updateDefaultMotionProfile, updateSetting, updateUnitSystem, useAppSettings, useSettingsStorageSync } from '../state/settings'
import { UNIT_SYSTEM_IDS, UNIT_SYSTEM_LABELS, type UnitSystem } from '../core/units'
import { openUserGuide } from './userGuide'

interface BudgetField {
  key: 'chartPointBudget' | 'mapPointBudget' | 'scenePointBudget'
  label: string
  description: string
}

const BUDGET_FIELDS: BudgetField[] = [
  {
    key: 'chartPointBudget',
    label: 'Chart point budget',
    description: 'Below this many points in the visible window, the Charts tab draws every sample individually — which is also what makes a sample selectable for the ctrl/⌘+click and shift+click delete-set gestures there. Raising it reaches individual points at a wider zoom; lowering it needs a closer zoom before points (and the delete-set gesture) become available.',
  },
  {
    key: 'mapPointBudget',
    label: 'Map point budget',
    description: 'Caps how many points the Map tab draws for the active track and for each other visible/overlay track. Display only — export, stats, and every other computation still use the full dataset.',
  },
  {
    key: 'scenePointBudget',
    label: '3D scene point budget',
    description: 'Caps how many points the 3D tab draws per track, including companion tracks sharing the same scene.',
  },
]

export function SettingsPanel() {
  useSettingsStorageSync()
  const settings = useAppSettings()
  const isDefault = BUDGET_FIELDS.every((field) => settings[field.key] === DEFAULT_SETTINGS[field.key])
    && settings.defaultMotionProfile === DEFAULT_SETTINGS.defaultMotionProfile
    && settings.unitSystem === DEFAULT_SETTINGS.unitSystem

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h3>Settings <button type="button" className="header-help" onClick={openUserGuide} title="Open the user guide" aria-label="Open the user guide">?</button></h3>
        <p className="muted small">Stored on this device, not inside any project — opening a different project keeps these values.</p>
      </div>
      <div className="settings-group">
        <h4>Visualization point budgets</h4>
        {BUDGET_FIELDS.map((field) => {
          const limits = SETTINGS_LIMITS[field.key]
          return (
            <div key={field.key} className="settings-field">
              <label className="num-field">
                <span>{field.label}</span>
                <input
                  type="number"
                  value={settings[field.key]}
                  min={limits.min}
                  max={limits.max}
                  step={100}
                  onChange={(event) => {
                    const parsed = Number(event.target.value)
                    if (Number.isFinite(parsed)) updateSetting(field.key, parsed)
                  }}
                />
              </label>
              <p className="muted small settings-field-desc">{field.description} Range {limits.min.toLocaleString()}–{limits.max.toLocaleString()}.</p>
            </div>
          )
        })}
      </div>
      <div className="settings-group">
        <h4>Display units</h4>
        <div className="settings-field">
          <label className="num-field">
            <span>Unit system</span>
            <select
              value={settings.unitSystem}
              onChange={(event) => updateUnitSystem(event.target.value as UnitSystem)}
            >
              {UNIT_SYSTEM_IDS.map((id) => <option key={id} value={id}>{UNIT_SYSTEM_LABELS[id]}</option>)}
            </select>
          </label>
          <p className="muted small settings-field-desc">
            Changes distance, altitude, and speed readouts only. Stored data, every export, and the
            HTML analysis report stay in canonical metres and m/s regardless of this setting.
          </p>
        </div>
      </div>
      <div className="settings-group">
        <h4>Transform defaults</h4>
        <div className="settings-field">
          <label className="num-field">
            <span>Default motion profile</span>
            <select
              value={settings.defaultMotionProfile}
              onChange={(event) => updateDefaultMotionProfile(event.target.value as MotionProfileId)}
            >
              {MOTION_PROFILE_IDS.map((id) => <option key={id} value={id}>{MOTION_PROFILES[id].label}</option>)}
            </select>
          </label>
          <p className="muted small settings-field-desc">
            Opens Drop outliers and Fill gaps on this profile each session, instead of always resetting to Aircraft.
          </p>
        </div>
      </div>
      <button type="button" disabled={isDefault} onClick={resetSettings}>Reset to defaults</button>
    </div>
  )
}
