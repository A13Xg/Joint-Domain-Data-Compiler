import { classifyRuns } from '../scripts/prune-workflow-runs.mjs'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const NOW = Date.parse('2026-08-27T12:00:00Z')
const DAY = 86_400_000
const CI = '.github/workflows/ci.yml'
const RELEASE = '.github/workflows/release.yml'
const GONE = '.github/workflows/deleted-long-ago.yml'

interface Run {
  id: number
  path: string
  status: string
  conclusion: string
  head_branch: string
  created_at: string
}

function run(id: number, overrides: Partial<Run> = {}): Run {
  return {
    id,
    path: CI,
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    created_at: new Date(NOW - 30 * DAY).toISOString(),
    ...overrides,
  }
}

const base = {
  workflowFiles: ['ci.yml', 'release.yml', '_release.yml'],
  currentRunId: 999,
  currentPath: CI,
  keep: 2,
  minAgeMs: DAY,
  now: NOW,
}

const doomedIds = (runs: Run[], overrides = {}): number[] =>
  classifyRuns(runs, { ...base, ...overrides }).map((entry: Run) => entry.id)

check(
  'Run whose workflow file no longer exists is pruned',
  doomedIds([run(1, { path: GONE })]).includes(1),
)
check(
  'App-generated path outside .github/workflows counts as orphaned',
  doomedIds([run(2, { path: 'dynamic/agents/copilot-pull-request-reviewer' })]).includes(2),
)
check('The run doing the pruning is never deleted', !doomedIds([run(999, { path: GONE })]).includes(999))
check(
  'In-progress run is never deleted',
  !doomedIds([run(3, { path: GONE, status: 'in_progress', conclusion: '' })]).includes(3),
)
check(
  'Run younger than the age floor is never deleted',
  !doomedIds([run(4, { path: GONE, created_at: new Date(NOW - 3600_000).toISOString() })]).includes(4),
)

// A successful tag run is the subject of a signed provenance attestation whose
// invocationId points at it; a failed one never produced an attestation.
const tagSweep = { scope: 'all', keep: 0 }
check(
  'Successful release-tag run is preserved even by an unlimited sweep',
  !doomedIds([run(5, { path: RELEASE, head_branch: 'v0.1.1' })], tagSweep).includes(5),
)
check(
  'Failed release-tag run is not preserved',
  doomedIds([run(6, { path: RELEASE, head_branch: 'win-v0.1.1', conclusion: 'failure' })], tagSweep).includes(6),
)
check(
  'A branch merely named like a tag is not mistaken for one',
  doomedIds([run(7, { path: GONE, head_branch: 'version-bump' })]).includes(7),
)

const fiveCiRuns = [run(11), run(12), run(13), run(14), run(15)]
check(
  'keep retains exactly the newest N of the calling workflow',
  doomedIds(fiveCiRuns).join() === '13,14,15',
)

const mixed = [...fiveCiRuns, run(21, { path: RELEASE }), run(22, { path: RELEASE }), run(23, { path: RELEASE })]
check(
  'scope=current leaves other workflows untouched',
  doomedIds(mixed).every((id) => id < 20),
)
check(
  'scope=all applies keep to every workflow independently',
  doomedIds(mixed, { scope: 'all' }).join() === '13,14,15,23',
)
check(
  'scope=all with keep 0 clears everything eligible',
  doomedIds(mixed, { scope: 'all', keep: 0 }).length === mixed.length,
)

console.log(`\n${failures === 0 ? 'ALL RUN PRUNING CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
