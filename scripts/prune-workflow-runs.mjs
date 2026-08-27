import { readdir } from 'node:fs/promises'
import { basename } from 'node:path'

// Deletes Actions runs that no longer earn their keep: runs belonging to
// workflow files that have since been deleted from the repository, plus the
// tail of the calling workflow's own history beyond `keep`. Runs on a ceiling
// so a large backlog drains over several invocations rather than one long job.

const WORKFLOW_DIR = '.github/workflows'

// Release tags carry build provenance: the signed attestation names its run as
// `invocationId`. Verification is cryptographic and would still pass, but
// deleting the run turns that audit link into a dead URL, so tag runs are kept
// regardless of age or count.
const RELEASE_TAG = /^(?:win-|mac-|linux-)?v\d/

// `scope: 'current'` prunes only the calling workflow's own tail -- the right
// default for a job wired into every build. `scope: 'all'` applies `keep` to
// every workflow independently, which is what a one-off backlog sweep wants.
export function classifyRuns(runs, { workflowFiles, currentRunId, currentPath, keep, minAgeMs, now, scope = 'current' }) {
  const live = new Set(workflowFiles.map((name) => `${WORKFLOW_DIR}/${name}`))
  const keptPerWorkflow = new Map()
  const doomed = []

  for (const run of runs) {
    if (run.id === currentRunId) continue
    if (run.status !== 'completed') continue
    // Only a *successful* tag run carries provenance worth preserving; a failed
    // one never produced an attestation, so it has no audit link to protect.
    if (run.conclusion === 'success' && RELEASE_TAG.test(run.head_branch ?? '')) continue
    // A sibling that started moments ago is still a valid API "completed" run;
    // the age floor keeps this from erasing a concurrent run's record.
    if (now - Date.parse(run.created_at) < minAgeMs) continue

    // Anything whose defining file is gone is unreachable history. This also
    // catches app-generated paths outside .github/workflows entirely (e.g.
    // `dynamic/agents/copilot-pull-request-reviewer`), which is intended.
    if (!live.has(run.path)) {
      doomed.push({ ...run, reason: 'orphaned workflow' })
      continue
    }
    if (scope !== 'all' && run.path !== currentPath) continue
    const kept = keptPerWorkflow.get(run.path) ?? 0
    if (kept < keep) {
      keptPerWorkflow.set(run.path, kept + 1)
      continue
    }
    doomed.push({ ...run, reason: `beyond newest ${keep} of ${run.path}` })
  }
  return doomed
}

async function api(path, { token, method = 'GET' } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  })
  if (method === 'DELETE') return response.ok || response.status === 404
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`)
  return response.json()
}

async function listAllRuns(repo, token) {
  const runs = []
  for (let page = 1; page <= 20; page += 1) {
    const body = await api(`/repos/${repo}/actions/runs?per_page=100&page=${page}`, { token })
    runs.push(...body.workflow_runs)
    if (body.workflow_runs.length < 100) break
  }
  return runs
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY
  const token = process.env.GH_TOKEN
  const currentRunId = Number(process.env.GITHUB_RUN_ID)
  const keep = Number(process.env.PRUNE_KEEP ?? 30)
  const maxDeletes = Number(process.env.PRUNE_MAX_DELETES ?? 150)
  const minAgeMs = Number(process.env.PRUNE_MIN_AGE_HOURS ?? 24) * 3600_000
  const dryRun = process.env.PRUNE_DRY_RUN === 'true'
  const scope = process.env.PRUNE_SCOPE === 'all' ? 'all' : 'current'

  const workflowFiles = await readdir(WORKFLOW_DIR)
  const runs = await listAllRuns(repo, token)
  const current = runs.find((run) => run.id === currentRunId)
  // Reusable workflows report the *caller's* path, which is what we want to
  // scope by; fall back to pruning orphans only when the current run is unknown.
  const currentPath = current?.path ?? null

  const doomed = classifyRuns(runs, {
    workflowFiles,
    currentRunId,
    currentPath,
    keep,
    minAgeMs,
    now: Date.now(),
    scope,
  })

  console.log(`scope=${scope} keep=${keep} ${runs.length} runs visible; ${doomed.length} eligible; ceiling ${maxDeletes}.`)
  const batch = doomed.slice(0, maxDeletes)
  let deleted = 0
  for (const run of batch) {
    if (dryRun) {
      console.log(`would delete ${run.id}  ${run.path}  (${run.reason})`)
      continue
    }
    if (await api(`/repos/${repo}/actions/runs/${run.id}`, { token, method: 'DELETE' })) deleted += 1
    else console.log(`could not delete ${run.id} (non-fatal)`)
  }
  console.log(dryRun ? `dry run: ${batch.length} would be deleted.` : `deleted ${deleted} of ${batch.length}.`)
  if (doomed.length > batch.length) {
    console.log(`${doomed.length - batch.length} remain; the next run of this workflow continues the drain.`)
  }
}

if (process.argv[1] && basename(process.argv[1]) === 'prune-workflow-runs.mjs') {
  await main()
}
