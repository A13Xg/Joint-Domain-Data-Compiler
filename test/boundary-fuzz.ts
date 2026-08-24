// Boundary-validator fuzz harness.
//
// ARCHITECTURE.md §10 states the invariant: validators that take `unknown` —
// every operation's `validateParams`, every compute task's `validatePayload`,
// and the project manifest/archive restore path — must reject malformed input
// loudly. "Loudly" has a precise meaning here, and each of these is asserted
// against every hostile value in the corpus:
//
//   1. The validator either returns a value or throws. It never returns
//      `undefined`/`null` while typed as returning an object.
//   2. What it throws is a real `Error` with a non-empty message.
//   3. The message is a domain rejection, not the incidental shape of a crash.
//      "Cannot read properties of undefined" means an unguarded property read
//      reached hostile input; that is the failure mode this harness exists to
//      catch, and it is indistinguishable from a real rejection to any caller
//      that only prints `error.message`.
//   4. Nothing it returns carries NaN/Infinity, which would silently poison
//      arithmetic downstream instead of failing at the boundary.
//   5. The input is not mutated.
import { strict as assert } from 'node:assert'
import { ensureBuiltinOperationsRegistered } from '../src/core/operations/basic.ts'
import { fixedRateResampleOperation } from '../src/core/operations/resample.ts'
import { listOperations } from '../src/core/recipes/registry.ts'
import { PRODUCTION_COMPUTE_TASKS } from '../src/compute/tasks.ts'
import {
  buildProjectManifest,
  createProjectArchive,
  parseProjectArchive,
  serializeProjectArchive,
  validateProjectArchive,
} from '../src/persistence/project/archive.ts'
import { validateProjectManifest } from '../src/persistence/project/manifest.ts'
import { EMPTY_WORKSPACE_SELECTION } from '../src/core/selection.ts'
import type { Dataset } from '../src/core/model.ts'

let checks = 0
let failures = 0
function check(label: string, condition: boolean, detail = ''): void {
  checks++
  if (condition) return
  failures++
  console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`)
}

// --- the hostile corpus ----------------------------------------------------
// Every validator sees all of these. Named so a failure report identifies the
// input without printing an unreadable object.
const HOSTILE: Array<[string, unknown]> = [
  ['undefined', undefined],
  ['null', null],
  ['true', true],
  ['false', false],
  ['zero', 0],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['-Infinity', -Infinity],
  ['empty string', ''],
  ['string', 'not-params'],
  ['numeric string', '42'],
  ['empty array', []],
  ['number array', [1, 2, 3]],
  ['empty object', {}],
  ['nested empty', { params: {} }],
  ['function', () => 'nope'],
  ['symbol', Symbol('nope')],
  ['bigint', 10n],
  ['Date', new Date(0)],
  ['Map', new Map([['meters', 1]])],
  ['Set', new Set([1, 2])],
  ['RegExp', /meters/],
  ['Error', new Error('hostile')],
  ['prototype-polluting key', JSON.parse('{"__proto__": {"polluted": true}, "meters": 1}') as unknown],
  ['NaN-valued fields', { meters: NaN, seconds: NaN, rateHz: NaN, intervalMeters: NaN, maxSamples: NaN }],
  ['Infinity-valued fields', { meters: Infinity, seconds: Infinity, rateHz: Infinity, intervalMeters: Infinity }],
  ['string-valued fields', { meters: '1', seconds: '1', rateHz: '1', intervalMeters: '1', channelId: 1 }],
  ['null-valued fields', { meters: null, seconds: null, rateHz: null, intervalMeters: null, points: null }],
  ['negative fields', { meters: -0, seconds: -0, rateHz: -5, intervalMeters: -5, maxSamples: -5 }],
  ['huge fields', { rateHz: 1e12, intervalMeters: 1e308, maxSamples: Number.MAX_SAFE_INTEGER + 2 }],
  ['array-valued fields', { meters: [1], seconds: [1], points: [[]], params: [] }],
  ['deeply nested', { params: { params: { params: { params: { meters: 1 } } } } }],
]

// A raw property/iteration crash reaching hostile input, rather than a
// deliberate rejection. Matched on the engine's own wording.
const CRASH_MESSAGE = /Cannot read propert|Cannot convert|is not a function|is not iterable|of undefined|of null/i

function describeThrown(thrown: unknown): string {
  if (thrown instanceof Error) return `${thrown.name}: ${thrown.message}`
  return `non-Error ${typeof thrown}: ${String(thrown)}`
}

/** Walks a returned value for non-finite numbers, which must never survive a
 *  boundary validator. Cycles are tolerated so a malformed graph can't hang. */
function hasNonFiniteNumber(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === 'number') return !Number.isFinite(value)
  if (typeof value !== 'object' || value === null) return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some((entry) => hasNonFiniteNumber(entry, seen))
  return Object.values(value).some((entry) => hasNonFiniteNumber(entry, seen))
}

function snapshot(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    // Cyclic or BigInt-bearing input: identity is enough for a mutation check.
    return String(value)
  }
}

interface Target {
  name: string
  validate: (value: unknown) => unknown
  /** Inputs this validator must accept. */
  accepts: unknown[]
  /** Labels from HOSTILE this validator is legitimately allowed to accept —
   *  `{ meters: -0 }` is a valid offset, `undefined` is valid "no parameters".
   *  Every other hostile value must be rejected, so a validator that silently
   *  starts waving junk through fails here rather than at replay time. */
  tolerates?: string[]
}

function fuzz(target: Target): void {
  for (const [label, hostile] of HOSTILE) {
    const before = snapshot(hostile)
    let returned: unknown
    let thrown: unknown
    let threw = false
    try {
      returned = target.validate(hostile)
    } catch (error) {
      threw = true
      thrown = error
    }

    const tolerated = target.tolerates?.includes(label) ?? false
    if (threw) {
      check(`${target.name} accepts tolerated input ${label}`, !tolerated, describeThrown(thrown))
      check(`${target.name} rejects ${label} with an Error`, thrown instanceof Error, describeThrown(thrown))
      const message = thrown instanceof Error ? thrown.message : ''
      check(`${target.name} rejects ${label} with a non-empty message`, message.trim().length > 0)
      check(
        `${target.name} rejects ${label} deliberately, not by crashing`,
        !CRASH_MESSAGE.test(message),
        message,
      )
    } else {
      check(`${target.name} must reject ${label}`, tolerated, `returned ${snapshot(returned)}`)
      check(`${target.name} never returns undefined for ${label}`, returned !== undefined && returned !== null)
      check(
        `${target.name} never returns a non-finite number for ${label}`,
        !hasNonFiniteNumber(returned),
        snapshot(returned),
      )
    }

    check(`${target.name} does not mutate ${label}`, snapshot(hostile) === before)
  }

  for (const accepted of target.accepts) {
    const before = snapshot(accepted)
    let returned: unknown
    try {
      returned = target.validate(accepted)
    } catch (error) {
      check(`${target.name} accepts its valid input ${before}`, false, describeThrown(error))
      continue
    }
    check(`${target.name} accepts its valid input ${before}`, returned !== undefined && returned !== null)
    check(`${target.name} returns finite numbers for ${before}`, !hasNonFiniteNumber(returned))
    check(`${target.name} does not mutate its valid input ${before}`, snapshot(accepted) === before)
  }
}

// --- operation validateParams ---------------------------------------------
ensureBuiltinOperationsRegistered()

const VALID_OPERATION_PARAMS: Record<string, unknown[]> = {
  'offset-elevation': [{ meters: 12.5 }, { meters: -3 }, { meters: 0 }],
  'shift-time': [{ seconds: 30 }, { seconds: -1.25 }],
  'standard-kinematics': [undefined, {}],
  'resample-fixed-rate': [
    { rateHz: 1, interpolation: 'linear' },
    { rateHz: 50, interpolation: 'step', maxGapMs: 2000 },
  ],
  'resample-distance-monotone-cubic': [{ intervalMeters: 5 }, { intervalMeters: 0.5 }],
}

// Hostile values that are, on inspection, legitimately valid for a given
// operation: `-0` is a finite offset, `1e308` is a finite interval, and the
// JSON `__proto__` key rides alongside a valid `meters`.
const TOLERATED_BY_OPERATION: Record<string, string[]> = {
  'offset-elevation': ['prototype-polluting key', 'negative fields'],
  'shift-time': ['negative fields'],
  'standard-kinematics': ['undefined', 'empty object'],
  'resample-fixed-rate': [],
  'resample-distance-monotone-cubic': ['huge fields'],
}

const operations = [...listOperations()]
if (!operations.some((operation) => operation.id === fixedRateResampleOperation.id)) {
  // Used directly by TransformPanel and the compute worker rather than through
  // the registry, so it would otherwise escape this sweep.
  operations.push(fixedRateResampleOperation)
}

for (const operation of operations) {
  const accepts = VALID_OPERATION_PARAMS[operation.id]
  // A new operation with no entry here is a coverage gap, not a pass.
  check(`operation ${operation.id} has fuzz coverage`, accepts !== undefined)
  fuzz({
    name: `${operation.id}.validateParams`,
    validate: (value) => operation.validateParams(value),
    accepts: accepts ?? [],
    tolerates: TOLERATED_BY_OPERATION[operation.id] ?? [],
  })
}

// --- compute task validatePayload -----------------------------------------
const VALID_TASK_PAYLOADS: Record<string, unknown[]> = {
  'chart-series': [{ points: [{ lat: 1, lon: 2 }], channelId: 'speed_mps', xAxis: 'index', maxSamples: 100 }],
  'fixed-rate-resample': [{
    points: [{ lat: 1, lon: 2, time: 0 }, { lat: 1.001, lon: 2, time: 1000 }],
    params: { rateHz: 1, interpolation: 'linear' },
  }],
  'gpx-export': [{ points: [{ lat: 1, lon: 2 }] }, { points: [{ lat: 1, lon: 2 }], datasetName: 'track' }],
  'track-health-scan': [
    { points: [{ lat: 1, lon: 2 }], sourceFormat: 'gpx', warnings: [], datasetId: 'ds-1' },
    { points: [{ lat: 1, lon: 2, ele: 10, time: 0 }], sourceFormat: 'csv', warnings: ['a warning'], datasetId: 'ds-2' },
  ],
}

for (const task of PRODUCTION_COMPUTE_TASKS) {
  const accepts = VALID_TASK_PAYLOADS[task.id]
  check(`compute task ${task.id} has fuzz coverage`, accepts !== undefined)
  fuzz({
    name: `${task.id}.validatePayload`,
    validate: (value) => task.validatePayload(value),
    accepts: accepts ?? [],
  })
}

// --- project manifest and archive restore ---------------------------------
const dataset: Dataset = {
  id: 'ds-1',
  name: 'Fuzz dataset',
  sourceFormat: 'gpx',
  points: [
    { lat: 45, lon: -122, ele: 100, time: 1_700_000_000_000 },
    { lat: 45.001, lon: -122.001, ele: 105, time: 1_700_000_001_000 },
  ],
  warnings: [],
  channels: [],
  createdAt: 0,
}

const manifest = buildProjectManifest({
  datasets: [dataset],
  activeDatasetId: dataset.id,
  activeTab: 'map',
  selection: EMPTY_WORKSPACE_SELECTION,
  applicationVersion: '0.1.0',
})
const archive = createProjectArchive({ datasets: [dataset], manifest, histories: {} })
const archiveJson = serializeProjectArchive(archive)

fuzz({
  name: 'validateProjectManifest',
  validate: (value) => validateProjectManifest(value),
  accepts: [structuredClone(manifest)],
})

fuzz({
  name: 'validateProjectArchive',
  validate: (value) => validateProjectArchive(value),
  accepts: [structuredClone(archive)],
})

fuzz({
  name: 'parseProjectArchive',
  // Everything reaches it as text, so non-strings are serialized the way a
  // file on disk would be.
  validate: (value) => parseProjectArchive(typeof value === 'string' ? value : snapshot(value)),
  accepts: [archiveJson],
})

// Field-level corruption: a valid archive with exactly one key damaged must
// still be rejected, which the whole-value corpus above cannot prove.
const persisted = JSON.parse(archiveJson) as Record<string, unknown>
const CORRUPTIONS: unknown[] = [undefined, null, 0, '', 'x', [], {}, true, NaN]
for (const key of Object.keys(persisted)) {
  for (const corruption of CORRUPTIONS) {
    const damaged: Record<string, unknown> = { ...persisted }
    if (corruption === undefined) delete damaged[key]
    else damaged[key] = corruption
    if (JSON.stringify(damaged) === JSON.stringify(persisted)) continue

    let rejected = false
    let message = ''
    try {
      parseProjectArchive(JSON.stringify(damaged))
    } catch (error) {
      rejected = true
      message = error instanceof Error ? error.message : describeThrown(error)
    }
    const what = `${key}=${corruption === undefined ? 'deleted' : snapshot(corruption)}`
    check(`parseProjectArchive rejects a damaged archive (${what})`, rejected)
    if (rejected) {
      check(`parseProjectArchive rejects ${what} deliberately`, !CRASH_MESSAGE.test(message), message)
      check(`parseProjectArchive explains ${what}`, message.trim().length > 0)
    }
  }
}

// Prototype pollution through the histories map, which is keyed by dataset id.
for (const key of ['__proto__', 'constructor', 'prototype']) {
  const polluted = JSON.parse(archiveJson) as Record<string, unknown>
  polluted.histories = JSON.parse(`{"${key}": {"checkpoint": null, "past": [], "future": []}}`) as unknown
  let rejected = false
  try {
    parseProjectArchive(JSON.stringify(polluted))
  } catch {
    rejected = true
  }
  check(`parseProjectArchive rejects a history keyed by ${key}`, rejected)
  check(`${key} pollution did not leak onto Object.prototype`, ({} as Record<string, unknown>).polluted === undefined)
}

// The whole-value corpus includes a `__proto__` payload; confirm none of it stuck.
check('Object.prototype is unpolluted after the sweep', ({} as Record<string, unknown>).polluted === undefined)

assert.equal(failures, 0, `${failures} boundary-validator assertion(s) failed`)
console.log(`boundary fuzz: ${checks} assertions passed across ${operations.length} operations, ${PRODUCTION_COMPUTE_TASKS.length} compute tasks, and the manifest/archive restore path`)
