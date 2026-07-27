# Dependency Policy

Tranche 9 Task 9.2, step 2. Establishes the rules this project follows for Node support and
dependency updates so upgrades are a routine, low-risk lane rather than an ad hoc decision each
time.

## Node support

- **Minimum: Node 22.** Vite 8 (rolldown-based) and the native `File`/`Blob`/Web Crypto APIs the
  parsers and checksum helper rely on require it. CI (`ci.yml`, `release.yml`) pins the
  `actions/setup-node` implementation to an immutable commit and uses `node-version: 22`.
- Do not lower the minimum to widen compatibility without first confirming Vite 8 and the parser
  test suite (`test/parser-limits.ts`, `test/csv-import-limits.ts`) still pass on the lower version.

## Update cadence

- **Patch and minor versions** of direct dependencies: update individually (not in a single bulk
  `npm update`), one package per commit, running the full `npm run check:all` gate after each.
  Bulk updates make a regression's cause ambiguous.
- **Major versions**: only on a dedicated branch, with the specific breaking-change list from the
  package's changelog reviewed against this codebase's actual usage before merging. Electron and
  React majors in particular can change renderer security defaults or hook semantics.
- **Electron**: patch upgrades must pass the native packaged renderer smoke jobs on Linux,
  Windows, and macOS in addition to artifact checks, since Electron patch releases can change
  bundled Chromium/Node behavior.
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

As of 2026-07-27, `electron-builder` is pinned exactly to `26.15.3`, the version used for the
verified Linux AppImage/DEB build and packaged renderer launch. `npm audit` reports 16 high
findings through its build-only `@electron/asar`/`@electron/universal`/glob/minimatch chain and
suggests a forced downgrade to `22.14.13`. Those packages execute only in the controlled release
builder and are not present in the shipped runtime dependency set; the runtime audit remains
zero. Do not take the forced downgrade:

1. First check whether a newer `26.x` (or later major) release of `electron-builder` resolves the
   same finding without downgrading.
2. If no compatible fixed release exists yet, keep the exact working pin and re-review this
   exception by 2026-08-31 or at the next release dependency pass, whichever comes first.

## CI supply-chain pins

- GitHub Actions are referenced by immutable commit SHA with the readable major tag retained in
  an inline comment.
- The Semgrep Linux/amd64 container is referenced by immutable OCI manifest digest.
- Resolve and review new commits/digests deliberately during dependency maintenance; do not
  replace pins with moving major tags or `latest`.

## Rollback procedure

1. Identify the last known-good commit on `main` (the most recent one where
   `docs/performance-baseline.md`-style evidence or a passing `check:all` run confirms health).
2. `git revert` the offending commit(s) — do not force-push or rewrite `main` history.
3. If a bad dependency version was already published in a tagged release, do not delete the tag;
   publish a new patch tag with the revert and note the affected version range in the GitHub
   Release notes.
4. Re-run the full gate (`npm run check:all`, plus `npm run build:desktop:win`/`:linux`/mac build
   locally or via a manual workflow dispatch) before re-tagging.

## Remaining maintenance work

The controlled patch/minor update pass remains intentionally incremental. `npm outdated` is
reviewed at release time; upgrades are not bundled merely to reach the newest version. Native
Windows/macOS smoke definitions are present in the release workflow but still require a real
GitHub Actions run after repository billing is restored.
