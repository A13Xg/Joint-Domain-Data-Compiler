# JDDC Roadmap Execution Status

**Roadmap:** `JDDC-ROADMAP-2026-01`

This document is the concise execution ledger for the implementation roadmap. The detailed architecture, scope, acceptance criteria, and PR segmentation remain in `docs/IMPLEMENTATION_ROADMAP.md`.

## Status key

- `DONE` — merged into `main` and validated.
- `ACTIVE` — implementation or CI validation is in progress.
- `READY` — dependencies are complete and the increment may begin.
- `BLOCKED` — waiting on an earlier dependency.

## Phases

| Phase | Status | Current increment |
|---|---|---|
| 0 — Baseline stabilization | DONE | PR #2 merged; lint, tests, XSD validation, and production build passed |
| 1 — Shared selection | DONE | PR #5 merged; selection primitives and focused CI added |
| 2 — Derived analytics | ACTIVE | PR #6 adds versioned derivation registry and standard kinematics |
| 3 — Time-series workspace | BLOCKED | Begins after analytics contracts are merged |
| 4 — Data-massaging pipeline v2 | BLOCKED | Begins after analytics and selection contracts stabilize |
| 5 — Workers and large-data architecture | BLOCKED | Begins after operation contracts exist |
| 6 — Multi-dataset comparison | BLOCKED | Begins after shared selection and analytics are integrated |
| 7 — Local 3D trajectory viewer | BLOCKED | Begins after shared cursor, playback, and ENU helpers exist |
| 8 — GPU map and optional globe | BLOCKED | Begins after 2D/3D selection contracts stabilize |
| 9 — Format expansion | BLOCKED | Prioritized after project and columnar-storage decisions |
| 10 — Projects, reproducibility, reports | BLOCKED | Begins after operation recipes are versioned |
| 11 — Extensibility boundaries | BLOCKED | Begins after at least two implementations exist per extension family |
| 12 — Release and security hardening | ACTIVE | Baseline packaging exists; signing, SBOM, attestations, and fuzzing remain |

## Dependency chain

```text
Baseline → Selection → Analytics → Linked views → Chart workspace
         ↘ Recipes → Workers → Multi-dataset → Playback/3D → GPU/global views
                    ↘ Projects/reports → Plugins → Final distribution hardening
```

## Merge discipline

Each increment must remain isolated, pass full repository CI, pass its focused checks where present, and include explicit scope exclusions. Later branches must not merge until their dependency PRs are on `main`.
