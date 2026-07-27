// Tranche 6 Task 6.1: fusion domain contracts (entity/source/candidate/
// decision), validation, serialization, and raw-source immutability.
import type { TrackPoint } from '../src/core/model.ts'
import {
  FusionValidationError,
  candidateFromSourcePoint,
  validateCandidateGroup,
  validateEntity,
  validateFusedPointDecision,
  validateSourceRegistration,
} from '../src/core/fusion/model.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}
function checkThrows(name: string, fn: () => void): void {
  try {
    fn()
    check(name, false, 'did not throw')
  } catch (err) {
    check(name, err instanceof FusionValidationError, err instanceof FusionValidationError ? '' : `wrong error type: ${err}`)
  }
}

// --- Entity ------------------------------------------------------------------
{
  const entity = validateEntity({ id: 'e1', displayName: 'Track 1', callsign: 'RAVEN01' })
  check('Valid entity is accepted with optional fields', entity.callsign === 'RAVEN01' && entity.platformType === undefined)
}
checkThrows('Entity without a displayName is rejected', () => validateEntity({ id: 'e1', displayName: '' }))
checkThrows('Entity with a non-string callsign is rejected', () => validateEntity({ id: 'e1', displayName: 'Track 1', callsign: 42 }))

// --- Source registration -------------------------------------------------
{
  const source = validateSourceRegistration({ id: 's1', entityId: 'e1', datasetId: 'd1', label: 'GPS', priority: 5 })
  check('Valid source registration is accepted', source.priority === 5)
}
checkThrows('Source registration with non-numeric priority is rejected', () => validateSourceRegistration({ id: 's1', entityId: 'e1', datasetId: 'd1', label: 'GPS', priority: 'high' }))

// --- Candidate points and raw-source immutability ---------------------------
{
  const sourcePoint: TrackPoint = { lat: 1, lon: 2, ele: 100, time: 1000, ext: { hdop: 0.8 } }
  const candidate = candidateFromSourcePoint('s1', 3, sourcePoint)
  check('Candidate copies the source point fields', candidate.lat === 1 && candidate.lon === 2 && candidate.ele === 100 && candidate.time === 1000)
  sourcePoint.lat = 999
  check('Mutating the source point afterward does not affect the candidate (plain-value copy)', candidate.lat === 1)
}
checkThrows('An untimed point cannot become a candidate', () => candidateFromSourcePoint('s1', 0, { lat: 1, lon: 2 }))

// --- Candidate groups ----------------------------------------------------
{
  const group = validateCandidateGroup({
    id: 'g1',
    entityId: 'e1',
    groupTimeMs: 1000,
    candidates: [
      { sourceId: 's1', sourceIndex: 0, lat: 1, lon: 2, time: 999 },
      { sourceId: 's2', sourceIndex: 5, lat: 1.001, lon: 2.001, time: 1001 },
    ],
  })
  check('Valid candidate group is accepted', group.candidates.length === 2)
}
checkThrows('Candidate group with no candidates is rejected', () => validateCandidateGroup({ id: 'g1', entityId: 'e1', groupTimeMs: 1000, candidates: [] }))
checkThrows('Candidate group with a negative sourceIndex is rejected', () => validateCandidateGroup({
  id: 'g1', entityId: 'e1', groupTimeMs: 1000, candidates: [{ sourceId: 's1', sourceIndex: -1, lat: 1, lon: 2, time: 1000 }],
}))
checkThrows('Candidate group with a non-numeric candidate time is rejected', () => validateCandidateGroup({
  id: 'g1', entityId: 'e1', groupTimeMs: 1000, candidates: [{ sourceId: 's1', sourceIndex: 0, lat: 1, lon: 2, time: 'now' }],
}))

// --- Fused point decision --------------------------------------------------
{
  const decision = validateFusedPointDecision({
    groupId: 'g1', chosenSourceId: 's2', chosenSourceIndex: 5, skippedSourceIds: ['s1'], reason: 'higher accuracy', confidence: 0.9,
  })
  check('Valid fused decision is accepted', decision.confidence === 0.9 && decision.skippedSourceIds.length === 1)
}
checkThrows('Fused decision with out-of-range confidence is rejected', () => validateFusedPointDecision({
  groupId: 'g1', chosenSourceId: 's2', chosenSourceIndex: 5, skippedSourceIds: [], reason: 'x', confidence: 1.5,
}))
checkThrows('Fused decision with a non-integer chosenSourceIndex is rejected', () => validateFusedPointDecision({
  groupId: 'g1', chosenSourceId: 's2', chosenSourceIndex: 5.5, skippedSourceIds: [], reason: 'x', confidence: 0.5,
}))

// --- Serialization round-trip ------------------------------------------------
{
  const entity = validateEntity({ id: 'e1', displayName: 'Track 1' })
  const group = validateCandidateGroup({ id: 'g1', entityId: 'e1', groupTimeMs: 1000, candidates: [{ sourceId: 's1', sourceIndex: 0, lat: 1, lon: 2, time: 1000 }] })
  const decision = validateFusedPointDecision({ groupId: 'g1', chosenSourceId: 's1', chosenSourceIndex: 0, skippedSourceIds: [], reason: 'only candidate', confidence: 1 })
  const roundTrip = JSON.parse(JSON.stringify({ entity, group, decision }))
  check('Entity/group/decision round-trip through JSON unchanged', JSON.stringify(roundTrip) === JSON.stringify({ entity, group, decision }))
  check('Round-tripped group re-validates cleanly', validateCandidateGroup(roundTrip.group).id === 'g1')
}

console.log(`\n${failures === 0 ? 'ALL FUSION MODEL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
