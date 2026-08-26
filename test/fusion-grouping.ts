// Tranche 6 Task 6.2: deterministic candidate grouping and source scoring.
import type { CandidatePoint, SourceRegistration } from '../src/core/fusion/model.ts'
import { groupCandidatesByTime } from '../src/core/fusion/grouping.ts'
import { rankScores, scoreCandidate } from '../src/core/fusion/scoring.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function candidate(sourceId: string, time: number, overrides: Partial<CandidatePoint> = {}): CandidatePoint {
  return { sourceId, sourceIndex: 0, lat: 1, lon: 2, time, ...overrides }
}

// --- Grouping: same-time candidates from different sources merge -----------
{
  const groups = groupCandidatesByTime([candidate('gps', 1000), candidate('ins', 1010)], { entityId: 'e1', timeToleranceMs: 100 })
  check('Two close-in-time candidates from different sources form one group', groups.length === 1)
  check('The group contains both candidates', groups[0]?.candidates.length === 2)
}

// --- Grouping: distant candidates split into separate groups ---------------
{
  const groups = groupCandidatesByTime([candidate('gps', 1000), candidate('gps', 5000)], { entityId: 'e1', timeToleranceMs: 100 })
  check('Distant candidates form separate groups', groups.length === 2)
}

// --- Grouping: anchor-based (not rolling) — documented trade-off -----------
{
  // 0, 90, 180 with tolerance 100: 90 joins the anchor(0) group (90-0<=100);
  // 180 does not (180-0=180>100), starting a new group anchored at 180.
  const groups = groupCandidatesByTime([candidate('a', 0), candidate('a', 90), candidate('a', 180)], { entityId: 'e1', timeToleranceMs: 100 })
  check('Anchor-based grouping does not drift the window past the tolerance from the first member', groups.length === 2 && groups[0]?.candidates.length === 2)
}

// --- Grouping: deterministic across input order -----------------------------
{
  const a = groupCandidatesByTime([candidate('gps', 2000), candidate('ins', 1000)], { entityId: 'e1', timeToleranceMs: 5000 })
  const b = groupCandidatesByTime([candidate('ins', 1000), candidate('gps', 2000)], { entityId: 'e1', timeToleranceMs: 5000 })
  check('Grouping is independent of input array order', JSON.stringify(a) === JSON.stringify(b))
}

// --- Grouping: rejects a negative tolerance ---------------------------------
{
  let threw = false
  try { groupCandidatesByTime([candidate('gps', 0)], { entityId: 'e1', timeToleranceMs: -1 }) } catch { threw = true }
  check('Negative time tolerance is rejected', threw)
}

check('Empty candidate list yields no groups', groupCandidatesByTime([], { entityId: 'e1', timeToleranceMs: 1000 }).length === 0)

// --- Scoring: source priority dominates ------------------------------------
{
  const lowPrioritySource: SourceRegistration = { id: 'ins', entityId: 'e1', datasetId: 'd1', label: 'INS', priority: 1 }
  const highPrioritySource: SourceRegistration = { id: 'gps', entityId: 'e1', datasetId: 'd2', label: 'GPS', priority: 5 }
  const poorGpsCandidate = candidate('gps', 1000, { hdop: 15 }) // deliberately bad HDOP
  const goodInsCandidate = candidate('ins', 1000, { hdop: 0.6 })
  const gpsScore = scoreCandidate({ candidate: poorGpsCandidate, source: highPrioritySource, groupTimeMs: 1000 })
  const insScore = scoreCandidate({ candidate: goodInsCandidate, source: lowPrioritySource, groupTimeMs: 1000 })
  check('Higher source priority wins even with worse quality signals (bounded adjustments)', gpsScore.score > insScore.score)
}

// --- Scoring: HDOP and satellite count nudge score within a source ----------
{
  const source: SourceRegistration = { id: 'gps', entityId: 'e1', datasetId: 'd1', label: 'GPS', priority: 3 }
  const goodFix = scoreCandidate({ candidate: candidate('gps', 1000, { hdop: 0.8, satelliteCount: 10 }), source, groupTimeMs: 1000 })
  const poorFix = scoreCandidate({ candidate: candidate('gps', 1000, { hdop: 8, satelliteCount: 4 }), source, groupTimeMs: 1000 })
  check('Better HDOP/satellite count scores higher within the same source', goodFix.score > poorFix.score)
}

// --- Scoring: timing penalty --------------------------------------------
{
  const source: SourceRegistration = { id: 'gps', entityId: 'e1', datasetId: 'd1', label: 'GPS', priority: 3 }
  const onTime = scoreCandidate({ candidate: candidate('gps', 1000), source, groupTimeMs: 1000 })
  const offTime = scoreCandidate({ candidate: candidate('gps', 1500), source, groupTimeMs: 1000 })
  check('A candidate closer to the group time scores higher', onTime.score > offTime.score)
}

// --- Scoring: identical inputs are deterministic ----------------------------
{
  const source: SourceRegistration = { id: 'gps', entityId: 'e1', datasetId: 'd1', label: 'GPS', priority: 3 }
  const c = candidate('gps', 1000, { hdop: 1.2, satelliteCount: 8 })
  const s1 = scoreCandidate({ candidate: c, source, groupTimeMs: 1000 })
  const s2 = scoreCandidate({ candidate: c, source, groupTimeMs: 1000 })
  check('Scoring is deterministic for identical inputs', s1.score === s2.score && s1.reason === s2.reason)
}

// --- Ranking: deterministic tie-break by sourceId ---------------------------
{
  const tiedScores = [{ sourceId: 'zulu', score: 5, reason: 'x' }, { sourceId: 'alpha', score: 5, reason: 'y' }]
  const ranked = rankScores(tiedScores)
  check('Tied scores break deterministically by sourceId', ranked[0]?.sourceId === 'alpha')
}
{
  const scores = [{ sourceId: 'a', score: 1, reason: '' }, { sourceId: 'b', score: 9, reason: '' }, { sourceId: 'c', score: 5, reason: '' }]
  const ranked = rankScores(scores)
  check('Ranking sorts strictly highest-score-first', ranked.map((s) => s.sourceId).join(',') === 'b,c,a')
}

console.log(`\n${failures === 0 ? 'ALL FUSION GROUPING/SCORING CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
