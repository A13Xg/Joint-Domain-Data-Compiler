# Dependency Policy

Tranche 9 Task 9.2, step 2. Establishes the rules this project follows for Node support and
dependency updates so upgrades are a routine, low-risk lane rather than an ad hoc decision each
time.

## Node support

- **Minimum: Node 22.** Vite 8 (rolldown-based) and the native `File`/`Blob`/Web Crypto APIs the
  parsers and checksum helper rely on require it. CI (`ci.yml`, `release.yml`) pins
  `actions/setup-node@v4` to `node-version: 22`.
- Do not lower the minimum to widen compatibility without first confirming Vite 8 and the parser
  test suite (`test/parser-limits.ts`, `test/csv-import-limits.ts`) still pass on the lower version.

## Update cadence

- **Patch and minor versions** of direct dependencies: update individually (not in a single bulk
  `npm update`), one package per commit, running the full `npm run check:all` gate after each.
  Bulk updates make a regression's cause ambiguous.
- **Major versions**: only on a dedicated branch, with the specific breaking-change list from the
  package's changelog reviewed against this codebase's actual usage before merging. Electron and
  React majors in particular can change renderer security defaults or hook semantics.
- **Electron**: patch upgrades should be verified with a packaged Windows smoke test (the existing
  `build:desktop:win` + artifact-size/executable-count checks in `release.yml`) before merging,
  since Electron patch releases can change bundled Chromium/Node behavior.
- **electron-builder**: treat separately from other dependencies (see "Known constraint" below).

## Lockfile discipline

- `package-lock.json` is committed and is the source of truth for CI (`npm ci`, never `npm
  install`, in both workflows).
- Any command that modifies dependencies (`npm install <pkg>`, `npm audit fix`) must be followed
  by committing the resulting `package-lock.json` diff in the same change — never left uncommitted
  or regenerated silently in CI.
- If `npm ci` and `package.json` ever disagree (as happened once in this repository's history — a
  lockfile drift that broke CI until an unrelated `npm install` incidentally fixed it), treat that
  as a bug to fix immediately, not a CI flake to route around.

## Audit thresholds: runtime vs. build-only

- **Runtime dependencies** (what ships in the browser bundle and the packaged Electron app): zero
  tolerance for high/critical vulnerabilities. CI enforces this with
  `npm audit --omit=dev --audit-level=high` in `ci.yml`'s security job.
- **Dev-only dependencies** (build tooling, test runner, `electron-builder`'s own dependency
  chain): audit findings here are tracked but do not block CI, since they cannot reach a shipped
  artifact. They still need a resolution path — see "No silent workaround" below.
- **No silent workaround.** Never run `npm audit fix --force` to make a finding disappear; it can
  silently downgrade a package to an incompatible major version. Resolve dev-chain findings through
  a tested upgrade or an explicit, dated, documented pin instead.

## Known constraint: electron-builder vs. its audit-suggested downgrade

As of this writing, `npm audit` may suggest downgrading `electron-builder` from `^26.15.2` to an
incompatible `25.1.8` to resolve a dev-only transitive finding. Do not take that suggestion
automatically:

1. First check whether a newer `26.x` (or later major) release of `electron-builder` resolves the
   same finding without downgrading.
2. If no compatible fixed release exists yet, keep the pinned working version, document the exact
   finding and why it's build-time-only (never reaches a shipped artifact), and set a review date
   (e.g. the next time this policy doc's dependencies are audited) rather than leaving it as a
   silent, undated exception.

## Rollback procedure

1. Identify the last known-good commit on `main` (the most recent one where
   `docs/performance-baseline.md`-style evidence or a passing `check:all` run confirms health).
2. `git revert` the offending commit(s) — do not force-push or rewrite `main` history.
3. If a bad dependency version was already published in a tagged release, do not delete the tag;
   publish a new patch tag with the revert and note the affected version range in the GitHub
   Release notes.
4. Re-run the full gate (`npm run check:all`, plus `npm run build:desktop:win`/`:linux`/mac build
   locally or via a manual workflow dispatch) before re-tagging.

## What this policy does not yet cover

Electron IPC channel/byte-limit integration tests (Task 9.2 step 3) and the controlled first
patch/minor update pass across current dependencies (step 4) are not done as of this document —
see `.hermes/plans/2026-07-26_223300-full-roadmap-execution.md` Tranche 9 for current status.
