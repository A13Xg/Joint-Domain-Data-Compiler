import type { AltitudeReference, Dataset, TimeReference } from '../model'
import type { OperationDefinition } from '../recipes/model'

export const ALTITUDE_REFERENCES: readonly AltitudeReference[] = ['MSL', 'HAE', 'AGL', 'PRESSURE', 'UNKNOWN']
export const TIME_REFERENCES: readonly TimeReference[] = ['UTC', 'GPS', 'TAI', 'LOCAL', 'UNKNOWN']

export interface DeclareReferencesParams {
  altitudeReference?: AltitudeReference
  timeReference?: TimeReference
}

/**
 * Record what a track's altitudes and timestamps are measured against.
 *
 * Most sources never say — every CSV imports with an UNKNOWN altitude
 * reference — and the comparison, 3D and fusion views rightly refuse to treat
 * two unknowns as the same datum. The operator often knows. This lets them say
 * so, as a recorded, undoable operation that shows up in the history and the
 * report, rather than a silent edit.
 *
 * It RELABELS; it never converts a value. Changing an already-declared
 * reference is therefore warned about: relabelling MSL heights as HAE does not
 * make them HAE heights (that needs Offset elevation or a geoid model).
 */
export const declareReferencesOperation: OperationDefinition<DeclareReferencesParams> = {
  id: 'declare-references',
  version: 1,
  label: 'Declare references',
  description: 'Record the altitude and/or time reference of the track. Values are not changed.',
  validateParams: validateDeclareReferencesParams,
  execute: ({ dataset, params }) => {
    if (!dataset.metadata) throw new Error('This dataset has no metadata to declare references on.')
    const before = { altitude: dataset.metadata.altitudeReference, time: dataset.metadata.timeReference }
    const after = { altitude: params.altitudeReference ?? before.altitude, time: params.timeReference ?? before.time }
    const changes: string[] = []
    const warnings: string[] = []
    if (after.altitude !== before.altitude) {
      changes.push(`altitude reference ${before.altitude} → ${after.altitude}`)
      if (before.altitude !== 'UNKNOWN') warnings.push(`Altitude values were not converted: heights recorded as ${before.altitude} are now labelled ${after.altitude}. Use Offset elevation if they need shifting to the new datum.`)
    }
    if (after.time !== before.time) {
      changes.push(`time reference ${before.time} → ${after.time}`)
      if (before.time !== 'UNKNOWN') warnings.push(`Timestamps were not converted: times recorded as ${before.time} are now labelled ${after.time}. Use Shift time if they need an offset (e.g. the GPS–UTC leap-second difference).`)
    }
    const next: Dataset = { ...dataset, metadata: { ...dataset.metadata, altitudeReference: after.altitude, timeReference: after.time } }
    return {
      dataset: next,
      summary: changes.length > 0 ? `Declared ${changes.join(', ')}` : 'References unchanged',
      warnings,
    }
  },
}

export function validateDeclareReferencesParams(value: unknown): DeclareReferencesParams {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('declare-references params must be an object')
  const raw = value as Record<string, unknown>
  const unexpected = Object.keys(raw).filter((key) => key !== 'altitudeReference' && key !== 'timeReference')
  if (unexpected.length > 0) throw new Error(`declare-references does not accept ${unexpected.join(', ')}`)
  const out: DeclareReferencesParams = {}
  if (raw.altitudeReference !== undefined) {
    if (!ALTITUDE_REFERENCES.includes(raw.altitudeReference as AltitudeReference)) throw new Error(`altitudeReference must be one of ${ALTITUDE_REFERENCES.join(', ')}`)
    out.altitudeReference = raw.altitudeReference as AltitudeReference
  }
  if (raw.timeReference !== undefined) {
    if (!TIME_REFERENCES.includes(raw.timeReference as TimeReference)) throw new Error(`timeReference must be one of ${TIME_REFERENCES.join(', ')}`)
    out.timeReference = raw.timeReference as TimeReference
  }
  if (out.altitudeReference === undefined && out.timeReference === undefined) throw new Error('declare-references needs an altitude or a time reference')
  return out
}
