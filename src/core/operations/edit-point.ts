import { ensureBuiltinDerivationsRegistered } from '../analytics/bootstrap'
import { listDerivations } from '../analytics/registry'
import { clonePoint, type PointProvenance } from '../model'
import type { OperationDefinition } from '../recipes/model'
import { withPoints } from '../transforms'
import { requireFinite, requireInteger, requireRecord, rejectUnknownKeys } from './params'

// Maps an edited scalar field to the abstract derivation-input tokens
// `DerivedChannelDefinition.requiredInputs` is written in terms of. lat and
// lon both map to both tokens because every kinematics computation that uses
// either (distance, heading, speed) is a function of the pair.
const DERIVATION_INPUTS_BY_FIELD: Record<string, readonly string[]> = {
  lat: ['latitude', 'longitude'],
  lon: ['latitude', 'longitude'],
  ele: ['elevation'],
  time: ['time'],
}

export type EditablePointExt = Record<string, number | string | boolean>

export interface EditPointFields {
  lat?: number
  lon?: number
  ele?: number
  time?: number
  name?: string
  desc?: string
  ext?: EditablePointExt
}

export interface EditPointParams {
  index: number
  fields: EditPointFields
}

const SCALAR_FIELD_KEYS = ['lat', 'lon', 'ele', 'time', 'name', 'desc'] as const

export const editPointOperation: OperationDefinition<EditPointParams> = {
  id: 'edit-point',
  version: 1,
  label: 'Edit point',
  description: 'Overwrite one point’s fields with hand-entered values (the Point Inspector).',
  validateParams: validateEditPointParams,
  execute: ({ dataset, params }) => {
    const { index, fields } = params
    if (index >= dataset.points.length) throw new Error(`Edit point: index ${index} is out of range`)
    const { ext, ...scalars } = fields

    // A point-preserving field (lat/lon/ele/time) is exactly what pairwise
    // kinematics-style derivations read for both this point and the point
    // after it (which reads this one as "previous"). Renaming/description
    // edits and ext-channel edits touch neither.
    ensureBuiltinDerivationsRegistered()
    const touchedInputs = new Set<string>()
    for (const field of Object.keys(scalars)) {
      for (const input of DERIVATION_INPUTS_BY_FIELD[field] ?? []) touchedInputs.add(input)
    }
    const staleChannels = new Set<string>()
    if (touchedInputs.size > 0) {
      for (const derivation of listDerivations()) {
        if (!derivation.requiredInputs.some((input) => touchedInputs.has(input))) continue
        for (const channel of derivation.outputChannels) staleChannels.add(channel.id)
      }
    }

    const points = dataset.points.map((point, pointIndex) => {
      if (pointIndex === index) {
        const next = { ...clonePoint(point), ...scalars }
        // Patched, not replaced: an edit that only touches lat/lon must not
        // silently drop every other derived/passthrough channel on the point.
        if (ext) next.ext = { ...next.ext, ...ext }
        // A hand-edited value that leaves no trace is the wrong default for range
        // instrumentation, so every edit is flagged in provenance regardless of
        // which fields changed. Carried by project save, GPB, and the HTML report;
        // silently dropped by GPX/EAG TSPI exports, which have no field for it.
        const flags = new Set(next.provenance?.qualityFlags ?? [])
        flags.add('manual_edit')
        next.provenance = { ...next.provenance, qualityFlags: [...flags] }
        if (staleChannels.size > 0) next.provenance = withStaleChannels(next.provenance, staleChannels)
        return next
      }
      if (pointIndex === index + 1 && staleChannels.size > 0) {
        const next = clonePoint(point)
        next.provenance = withStaleChannels(next.provenance, staleChannels)
        return next
      }
      return point
    })
    return { dataset: withPoints(dataset, points), summary: `Edited point #${index}` }
  },
}

function withStaleChannels(provenance: PointProvenance | undefined, ids: ReadonlySet<string>): PointProvenance {
  const stale = new Set(provenance?.staleChannels ?? [])
  for (const id of ids) stale.add(id)
  return { ...provenance, staleChannels: [...stale] }
}

function validateEditPointParams(value: unknown): EditPointParams {
  const record = requireRecord(value, 'Edit point')
  rejectUnknownKeys(record, 'Edit point', ['index', 'fields'])
  return {
    index: requireInteger(record.index, 'index', 0),
    fields: validateFields(record.fields),
  }
}

function validateFields(value: unknown): EditPointFields {
  const record = requireRecord(value, 'Edit point fields')
  rejectUnknownKeys(record, 'Edit point fields', [...SCALAR_FIELD_KEYS, 'ext'])
  const fields: EditPointFields = {}
  if (record.lat !== undefined) fields.lat = requireFinite(record.lat, 'lat')
  if (record.lon !== undefined) fields.lon = requireFinite(record.lon, 'lon')
  if (record.ele !== undefined) fields.ele = requireFinite(record.ele, 'ele')
  if (record.time !== undefined) fields.time = requireFinite(record.time, 'time')
  if (record.name !== undefined) fields.name = requireString(record.name, 'name')
  if (record.desc !== undefined) fields.desc = requireString(record.desc, 'desc')
  if (record.ext !== undefined) fields.ext = validateExt(record.ext)
  if (Object.keys(fields).length === 0) throw new Error('Edit point: fields must include at least one change')
  return fields
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

function validateExt(value: unknown): EditablePointExt {
  const record = requireRecord(value, 'Edit point fields.ext')
  const ext: EditablePointExt = {}
  for (const [key, entry] of Object.entries(record)) {
    if (entry === undefined) continue
    if (typeof entry !== 'number' && typeof entry !== 'string' && typeof entry !== 'boolean') {
      throw new Error(`Edit point fields.ext.${key} must be a number, string, or boolean`)
    }
    if (typeof entry === 'number' && !Number.isFinite(entry)) throw new Error(`Edit point fields.ext.${key} must be finite`)
    ext[key] = entry
  }
  return ext
}
