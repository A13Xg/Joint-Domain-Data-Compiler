import { validateFusionArtifact } from '../src/core/fusion/artifact.ts'

let failures = 0
function check(name: string, condition: boolean): void { if (!condition) failures++; console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`) }

const artifact = {
  id: 'fusion-1', entityId: 'adhoc', fusedDatasetId: 'fused-1', timeToleranceMs: 2000, createdAt: 1,
  sourceRegistrations: [
    { id: 'source-a', entityId: 'adhoc', datasetId: 'dataset-a', label: 'A', priority: 1 },
    { id: 'source-b', entityId: 'adhoc', datasetId: 'dataset-b', label: 'B', priority: 2 },
  ],
  decisions: [{ groupId: 'group-1', chosenSourceId: 'source-a', chosenSourceIndex: 0, skippedSourceIds: ['source-b'], reason: 'priority', confidence: 1 }],
  report: { generatedAt: 1, totalGroups: 1, meanConfidence: 1, sourceSummaries: [] },
}

let accepted = true
try { validateFusionArtifact(artifact) } catch { accepted = false }
check('Valid fusion artifact is accepted', accepted)

let unknownSourceRejected = false
try { validateFusionArtifact({ ...artifact, decisions: [{ ...artifact.decisions[0], chosenSourceId: 'missing' }] }) } catch { unknownSourceRejected = true }
check('Decision source must be registered', unknownSourceRejected)

let unknownSkippedSourceRejected = false
try { validateFusionArtifact({ ...artifact, decisions: [{ ...artifact.decisions[0], skippedSourceIds: ['missing'] }] }) } catch { unknownSkippedSourceRejected = true }
check('Skipped decision source must be registered', unknownSkippedSourceRejected)

let reportMismatchRejected = false
try { validateFusionArtifact({ ...artifact, report: { ...artifact.report, totalGroups: 2 } }) } catch { reportMismatchRejected = true }
check('Report group count must match decisions', reportMismatchRejected)

if (failures) process.exitCode = 1
else console.log('\nALL FUSION ARTIFACT CHECKS PASSED')
