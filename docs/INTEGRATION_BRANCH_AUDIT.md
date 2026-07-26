# Integration Branch Audit

**Branch:** `agent/roadmap-integration`  
**Pull request:** #25  
**Base:** `main`  
**Audit date:** 2026-07-26

## Executive result

The branch was created from the current validated `main` and contains no missing historical feature work. GitHub reports the pull request as mergeable, and the branch has no merge conflicts with `main` at the audited head.

The integration branch is suitable as the sole active non-main development branch. Historical `agent/*` branches are superseded.

## Repository hardening applied

- Added repository-wide CODEOWNERS coverage.
- Added CodeQL JavaScript/TypeScript security-and-quality analysis.
- Consolidated every TypeScript regression harness into `npm test`.
- Updated CI to run the full suite, use concurrency cancellation, enforce a timeout, and preserve a broader source snapshot.
- Retained the existing security and supply-chain workflow for runtime dependency audit, SBOM generation, and release checksums.
- Updated the README to reflect actual current functionality, test coverage, release behavior, and branch workflow.

A dependency-review-action workflow was evaluated and removed because the current private-repository configuration does not support that platform feature. The existing npm audit and SBOM workflow remains enforceable and green.

## Validation results

The audited branch passed:

- deterministic dependency installation;
- ESLint;
- all discovered TypeScript regression harnesses;
- GPX XSD validation;
- TypeScript project compilation;
- Vite production build;
- selection-model focused checks;
- runtime dependency and supply-chain checks.

CodeQL was added and must complete successfully before merge.

## Merge and compatibility review

### Merge status

- GitHub mergeability: clean at audit time.
- Branch is based directly on the current `main` integration history.
- No unmerged validated work was found on historical feature branches.
- No package-lock changes were introduced by this hardening increment.

### Runtime requirements

- Node.js 22 or newer.
- Modern Chromium/Electron runtime provided by Electron 42.
- Browser support assumes Web Workers, `structuredClone`-compatible message payloads, React 19, and current evergreen-browser APIs.

### Packaging considerations

- Windows NSIS and portable x64 outputs are configured.
- Linux AppImage and DEB outputs are configured.
- macOS DMG and ZIP outputs are configured.
- Windows and macOS signing/notarization are not configured.
- The portable Windows executable may still write Electron cache and user-data files.

## Source-quality review

### Clean findings

The audited production source contains:

- no `TODO`, `FIXME`, `HACK`, or `XXX` markers;
- no `@ts-ignore` directives;
- no ESLint suppression comments;
- no explicit `any` escapes;
- no duplicate active branch implementation beyond `main`;
- no malformed merge markers;
- no detected production placeholder or mock behavior.

Non-null assertions are limited to locations where preceding bounds or existence checks establish the invariant. They should still be reduced opportunistically when nearby code is modified.

### Intentional currently-unused foundations

Several exported modules are not yet connected to the primary UI but are intentional roadmap foundations rather than dead code:

- project manifest parsing and serialization;
- recipe execution and replay APIs;
- plugin registry;
- relative-track analytics;
- 3D trajectory geometry;
- selected core range/time helpers;
- production compute client and Worker tasks.

These exports should not be removed solely because the current application UI does not yet invoke all of them.

### Maintainability risks

1. `src/App.tsx` remains a large orchestration component and should be split into workspace state, import flow, history, and tab-shell hooks/components.
2. `src/ui/TimeSeriesChart.tsx` combines selection interaction, rendering, presets, scaling, statistics, and readouts; a chart-controller hook and renderer adapter would reduce coupling.
3. `src/ui/TransformPanel.tsx` is growing into a monolithic operation catalog; operation descriptors should eventually generate controls and scope rules.
4. The stylesheet is large and global. Component-level organization or CSS modules would reduce accidental style coupling.
5. Numerous focused Actions workflows now overlap with the consolidated CI suite. They are useful diagnostics, but workflow count and runner usage should be reviewed after the consolidated suite is stable.

### Performance risks

1. Worker tasks currently receive arrays of object-shaped points through structured cloning. Large datasets will incur serialization and memory duplication costs. Typed arrays or a columnar transferable representation remain the recommended next performance boundary.
2. Range statistics iterate through selected records and numeric channels synchronously. The Worker foundation should be used once selections regularly exceed interactive budgets.
3. The SVG chart is bounded by downsampling, but zoom/pan and multiple dense channels will eventually justify the planned uPlot or Canvas/WebGL adapter.
4. Map point rendering is capped, but source-index lookups and range highlighting should avoid repeated full-array searches.
5. The consolidated test runner bundles each harness separately. This is deterministic and cross-platform, but a future shared build or test framework could reduce CI duration.

## Required branch-protection settings

GitHub branch/ruleset mutation was not available through the connected repository tool during this audit. Apply the following rules to both `main` and `agent/roadmap-integration` in repository settings:

### `main`

- Require a pull request before merging.
- Require at least one approving review when another reviewer is available.
- Require review from CODEOWNERS when another qualified owner is available.
- Dismiss stale approvals when new commits are pushed.
- Require all conversations to be resolved.
- Require branches to be up to date before merging.
- Require these status checks:
  - `CI / validate`
  - `CodeQL / Analyze TypeScript and JavaScript`
  - the runtime dependency/security job from `Security and supply-chain checks`
- Block force pushes.
- Block branch deletion.
- Require linear history if squash or rebase merges are the chosen repository convention.
- Include administrators unless emergency bypass behavior is intentionally required.

### `agent/roadmap-integration`

- Block force pushes.
- Block branch deletion.
- Require `CI / validate` and CodeQL before merging into `main`.
- Allow direct commits only for the repository owner/maintainer workflow, or require PRs if multiple contributors begin using the branch.

## Merge recommendation

Do not merge until CodeQL is green. Once all checks are green, PR #25 is compatible with `main` and has no known merge conflict or blocking source defect.
