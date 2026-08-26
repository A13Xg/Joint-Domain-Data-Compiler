// Tranche 6 Task 6.3 (core layer): Auto-Combine and the audit report.
import type { CandidateGroup, SourceRegistration } from '../src/core/fusion/model.ts'
import { FusionValidationError, validateCandidateGroup, validateFusionOverrides } from '../src/core/fusion/model.ts'
import { autoCombine } from '../src/core/fusion/autoCombine.ts'
import { buildFusionReport, fusionDecisionsToCsv, fusionReportToMarkdown, serializeFusionReportJson } from '../src/core/fusion/report.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const gps: SourceRegistration = { id: 'gps', entityId: 'e1', datasetId: 'd1', label: 'GPS', priority: 5 }
const ins: SourceRegistration = { id: 'ins', entityId: 'e1', datasetId: 'd2', label: 'INS', priority: 1 }
const sources = [gps, ins]

function group(id: string, groupTimeMs: number, candidates: Array<{ sourceId: string; time: number; hdop?: number }>): CandidateGroup {
  return validateCandidateGroup({
    id, entityId: 'e1', groupTimeMs,
    candidates: candidates.map((c, i) => ({ sourceId: c.sourceId, sourceIndex: i, lat: 1, lon: 2, time: c.time, hdop: c.hdop })),
  })
}

// --- Picks a real candidate, never synthesizes ------------------------------
{
  const groups = [group('g0', 1000, [{ sourceId: 'gps', time: 1000, hdop: 0.8 }, { sourceId: 'ins', time: 1005, hdop: 5 }])]
  const result = autoCombine(groups, sources)
  check('Produces one fused point per group', result.points.length === 1)
  check('Fused point coordinates match a real candidate exactly (never averaged)', result.points[0]?.lat === 1 && result.points[0]?.lon === 2)
  check('Higher-priority/better-quality source is chosen', result.decisions[0]?.chosenSourceId === 'gps')
  check('The other source is recorded as skipped', result.decisions[0]?.skippedSourceIds.includes('ins'))
  check('Fused point records its source in ext', result.points[0]?.ext?.fused_source === 'gps')
}

// --- Override validation ---------------------------------------------------
{
  const groups = [group('g0', 1000, [{ sourceId: 'gps', time: 1000 }, { sourceId: 'ins', time: 1000 }])]
  let rejected = false
  try { validateFusionOverrides({ pointOverrides: [{ entityId: 'e1', groupId: 'g0', sourceId: 'missing' }] }, groups, sources) } catch (error) { rejected = error instanceof FusionValidationError }
  check('Override validation rejects an unknown source', rejected)
  rejected = false
  try { validateFusionOverrides({ intervalOverrides: [{ entityId: 'e1', sourceId: 'gps', startMs: 2000, endMs: 1000 }] }, groups, sources) } catch (error) { rejected = error instanceof FusionValidationError }
  check('Override validation rejects a reversed interval range', rejected)
  rejected = false
  try { autoCombine(groups, sources, { pointOverrides: [{ entityId: 'e1', groupId: 'missing', sourceId: 'gps' }] }) } catch (error) { rejected = error instanceof FusionValidationError }
  check('Auto-Combine validates override groups before producing output', rejected)
}

// --- Single-candidate group: maximal confidence, nothing skipped -----------
{
  const groups = [group('g0', 1000, [{ sourceId: 'ins', time: 1000 }])]
  const result = autoCombine(groups, sources)
  check('A single-candidate group has confidence 1', result.decisions[0]?.confidence === 1)
  check('A single-candidate group skips nothing', result.decisions[0]?.skippedSourceIds.length === 0)
}

// --- Point override takes precedence over scoring --------------------------
{
  const groups = [group('g0', 1000, [{ sourceId: 'gps', time: 1000 }, { sourceId: 'ins', time: 1000 }])]
  const result = autoCombine(groups, sources, { pointOverrides: [{ entityId: 'e1', groupId: 'g0', sourceId: 'ins' }] })
  check('Point override selects the overridden source despite lower priority', result.decisions[0]?.chosenSourceId === 'ins')
  check('Point override is recorded as manual in the reason', /manual point override/.test(result.decisions[0]?.reason ?? ''))
  check('Point override yields full confidence', result.decisions[0]?.confidence === 1)
}
{
  // Override references a source not present in this particular group — falls back to scoring.
  const groups = [group('g0', 1000, [{ sourceId: 'gps', time: 1000 }])]
  let rejected = false
  try { autoCombine(groups, sources, { pointOverrides: [{ entityId: 'e1', groupId: 'g0', sourceId: 'ins' }] }) } catch { rejected = true }
  check('An override for an absent source is rejected', rejected)
}

// --- Interval override applies to every group within its time window -------
{
  const groups = [
    group('g0', 1000, [{ sourceId: 'gps', time: 1000 }, { sourceId: 'ins', time: 1000 }]),
    group('g1', 2000, [{ sourceId: 'gps', time: 2000 }, { sourceId: 'ins', time: 2000 }]),
    group('g2', 10_000, [{ sourceId: 'gps', time: 10_000 }, { sourceId: 'ins', time: 10_000 }]),
  ]
  const result = autoCombine(groups, sources, { intervalOverrides: [{ entityId: 'e1', sourceId: 'ins', startMs: 500, endMs: 2500 }] })
  check('Interval override applies to groups inside its window', result.decisions[0]?.chosenSourceId === 'ins' && result.decisions[1]?.chosenSourceId === 'ins')
  check('Interval override does not apply outside its window', result.decisions[2]?.chosenSourceId === 'gps')
}
{
  // A point override for one group and an interval override covering it: point override wins.
  const groups = [group('g0', 1000, [{ sourceId: 'gps', time: 1000 }, { sourceId: 'ins', time: 1000 }])]
  const result = autoCombine(groups, sources, {
    pointOverrides: [{ entityId: 'e1', groupId: 'g0', sourceId: 'gps' }],
    intervalOverrides: [{ entityId: 'e1', sourceId: 'ins', startMs: 0, endMs: 5000 }],
  })
  check('A point override takes precedence over an overlapping interval override', result.decisions[0]?.chosenSourceId === 'gps')
}

// --- Chronological output, unknown source is a hard error -------------------
{
  const groups = [group('g0', 2000, [{ sourceId: 'gps', time: 2000 }]), group('g1', 1000, [{ sourceId: 'gps', time: 1000 }])]
  const result = autoCombine(groups, sources)
  check('Output order follows input group order (caller\'s responsibility to pass chronological groups)', result.points[0]?.time === 2000 && result.points[1]?.time === 1000)
}
{
  const groups = [group('g0', 1000, [{ sourceId: 'unregistered', time: 1000 }])]
  let threw = false
  try { autoCombine(groups, sources) } catch { threw = true }
  check('A candidate from an unregistered source is a hard error, not silently dropped', threw)
}

// --- Fusion report ----------------------------------------------------------
{
  const groups = [
    group('g0', 1000, [{ sourceId: 'gps', time: 1000, hdop: 0.8 }, { sourceId: 'ins', time: 1000, hdop: 5 }]),
    group('g1', 2000, [{ sourceId: 'gps', time: 2000, hdop: 0.8 }]),
  ]
  const result = autoCombine(groups, sources)
  const report = buildFusionReport(result.decisions, sources, 5000)
  check('Report counts chosen sources correctly', report.sourceSummaries.find((s) => s.sourceId === 'gps')?.chosenCount === 2)
  check('Report counts skipped sources correctly', report.sourceSummaries.find((s) => s.sourceId === 'ins')?.skippedCount === 1)
  check('Report includes every registered source even with zero activity', report.sourceSummaries.length === 2)
  check('Report totalGroups matches decision count', report.totalGroups === 2)

  const json = serializeFusionReportJson(report)
  check('JSON report round-trips', JSON.parse(json).totalGroups === 2)

  const markdown = fusionReportToMarkdown(report)
  check('Markdown report includes a source table row', markdown.includes('GPS (gps)') && markdown.includes('| 2 | 0 |'))

  const csv = fusionDecisionsToCsv(result.decisions)
  const csvLines = csv.split('\n')
  check('CSV export has a header plus one row per decision', csvLines.length === 3)
  check('CSV escapes embedded quotes in the reason field', /confidence/.test(csvLines[0]!))
}

console.log(`\n${failures === 0 ? 'ALL FUSION AUTO-COMBINE CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
