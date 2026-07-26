# Branch Strategy

## Canonical branches

- `main` is the protected, validated integration branch and currently contains all merged roadmap work through PR #24.
- `agent/roadmap-integration` is the single active development branch for subsequent roadmap implementation.

## Superseded feature branches

Branches created for PRs #2 through #24 are historical implementation branches. Their validated changes have already been merged into `main`; none should be treated as a newer or more complete source of truth than `main`.

## Working policy

1. Start all new roadmap work from `agent/roadmap-integration`.
2. Commit incremental sub-goals to that branch.
3. Keep one open pull request from `agent/roadmap-integration` to `main`.
4. Run focused checks and full CI on each meaningful increment.
5. Merge the integration PR only at a deliberate milestone.
6. After merge, recreate or fast-forward `agent/roadmap-integration` from the updated `main` before continuing.

## Branch cleanup

Historical `agent/*` branches may be deleted after confirming their associated PR is merged or intentionally closed. They are retained only as Git history references and are not active development branches.
