# AGENTS.md

Entrypoint for AI coding agents working in this repository.

**JDDC** is a single-screen engineering workbench for TSPI (trajectory / flight-data)
logs. It imports 7 formats, normalizes them into one internal `Dataset`, and lets an
engineer inspect, transform, compare, and re-export them. Built for precision and
auditability — not dashboards.

## Read first

| Document | Covers |
|---|---|
| [`.agents/ARCHITECTURE.md`](.agents/ARCHITECTURE.md) | **How it works.** Data model, layers, invariants. Read before non-trivial changes. |
| [`ONBOARDING.md`](ONBOARDING.md) | What it does, setup, project layout. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branch, commit, and release workflow. |

## Commands

```bash
npm ci                # install (never `npm install` in CI)
npm run dev           # browser dev server, http://localhost:5173
npm run check:all     # lint + 62 test harnesses + build + app health
npm run check:e2e     # 10 Playwright workflow tests (needs chromium)
npx tsc -b            # types only — fastest feedback loop
```

Run `npm run check:all` before committing. Install `libxml2-utils` locally, or the
GPX/KML schema assertions in `test/validate.ts` skip silently instead of running.

## Conventions

- **TypeScript strict**, React 19 (no explicit `React` import — automatic JSX transform).
- **Component files export only components** (`react-refresh/only-export-components`).
- **Comments explain *why*, not *what*.** Match the density of surrounding code.
- **Prefer native APIs** — `File`, `Blob`, Web Crypto, `fetch` — over npm equivalents.
- **Tests use real data, no mocks.** Harnesses live in `test/` and use the `check()` pattern.

## Non-negotiables

Full list in [`.agents/ARCHITECTURE.md`](.agents/ARCHITECTURE.md) §10. The short version:

1. **Never fabricate data.** Downsample for display only; export the full dataset.
   If a value cannot be honestly derived, drop it with a warning.
2. **Transforms are pure** and preserve `provenance` and quality flags.
3. **Coordinate math is antimeridian-safe**, including angular channels.
4. **Validate untrusted input at the boundary** — operation params and restored
   project manifests arrive as `unknown` and must reject malformed data loudly.
5. **Canonical units are degrees, meters, and epoch milliseconds.** Convert at import.
