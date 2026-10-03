# Contributing to JDDC

Thank you for your interest in contributing to Joint Domain Data Compiler! This guide explains how to report issues, suggest features, and submit pull requests.

## Code of Conduct

Be respectful and constructive. We value precision, clarity, and good faith collaboration.

## Reporting Issues

### Security Issues

**Do not open a public GitHub issue for security vulnerabilities.** Instead, email the maintainer with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if known)

We will respond within 48 hours and work with you on a responsible disclosure timeline.

### Bug Reports

Before opening an issue, check if it's already been reported. Include:

1. **Reproduction steps** — Exact sequence to trigger the bug
2. **Expected vs. actual behavior** — What should happen vs. what does happen
3. **Environment** — OS, Node version, browser (if web), or Electron version
4. **Logs** — Any console errors or warning messages (use the app's LogConsole)
5. **Data** — Minimal test file that reproduces the issue (attach to issue or link to `test/fixtures/` if using existing sample)

Example:

```
### Reproduction
1. Import test/fixtures/real-usgs.gpx
2. Go to Map tab
3. Click "Fit to range"
4. Switch back to Chart tab
5. Chart is blank (should show time-series plot)

### Expected
Chart displays 200 points

### Actual
Chart area is blank; no error in LogConsole

### Environment
- macOS 14.6
- Safari 17.6
- Node 22.1.0
```

### Feature Requests

Describe the workflow you want to enable:

```
### Problem
When comparing two datasets with mismatched timezones, I need to manually adjust 
timestamps in both datasets. This is error-prone and tedious.

### Proposed Solution
Add a "Align timezones" transform that:
- Detects timezone mismatches (e.g., UTC vs. UTC+8)
- Offers auto-correction or manual override
- Shows before/after statistics

### Alternative Approaches
1. Manual offset input (less user-friendly)
2. Reference-dataset detection (requires assumptions about data)

### Use Case
Multi-national flight test data often comes from different time zones; harmonizing 
before comparison is common workflow.
```

## Development Setup

### Prerequisites

- Node.js 22+
- npm (comes with Node.js)
- Git
- (Linux/macOS) xvfb and libxml2-utils for testing

### Local Setup

```bash
# Clone the repository
git clone https://github.com/A13Xg/Joint-Domain-Data-Compiler.git
cd Joint-Domain-Data-Compiler

# Install dependencies
npm ci

# Start dev server (opens browser at http://localhost:5173)
npm run dev

# In another terminal, start Electron dev mode
npm run dev:desktop
```

### Running Tests

```bash
# Full test suite (101+ harnesses)
npm test

# Linting
npm run lint

# Type checking
npx tsc -b

# All checks (required before PR)
npm run check:unit
```

### Building & Packaging

```bash
# Build web bundle
npm run build

# Build desktop app for your platform
npm run build:desktop

# Package for Linux
npm run build:desktop:linux

# Package for Windows
npm run build:desktop:win

# Package for macOS
npm run build:desktop
```

## Versioning & Releases

`package.json`'s `version` is the single place a version number lives; every other reference
(the About dialog, project/playback archive metadata, release artifact names, README badges) is
derived from it at build or release time — never edited separately.

The scheme is `major.minor.patch`, and almost none of it is manual:

1. **Patch bumps itself.** `npm install`/`npm ci` runs `npm run prepare`, which points git at
   `githooks/pre-commit`. From then on, every commit on this clone runs
   `scripts/bump-patch-version.mjs`, which increments `package.json`'s patch number and stages it
   — unless the commit already changed the version itself (see step 2), in which case the hook
   leaves it alone.
2. **You bump minor (or major) by hand when you want a release.** Edit `package.json` directly,
   e.g. `0.8.6` → `0.9.0` (reset the patch to `0`), and include that edit in your commit.
3. **CI does the rest.** On push to `main`, `ci.yml`'s `auto-tag-release` job (backed by
   `scripts/check-version-bump.mjs`) compares the new commit's version to its parent's. If the
   major or minor component changed, it tags `main` as `v<version>` and pushes the tag — which is
   exactly what `release.yml` already triggers on. A patch-only commit never tags anything, so
   routine commits never start a release.

If you are working from a fork or an environment where the hook can't run (or you need a one-off
manual bump), run `node scripts/bump-patch-version.mjs` yourself, or edit `package.json` directly
— the hook only automates the common case, it is not the only valid path.

```bash
# Example: cut a release
#  1. npm version is NOT used here -- edit package.json's "version" by hand instead,
#     so the patch resets to 0 as part of the same commit.
#  2. git commit -am "feat: whatever earned the minor bump"
#  3. git push origin main
#  -> ci.yml's auto-tag-release job pushes v0.9.0, which starts release.yml
```

## Branch Strategy

Quick summary:

- **`main`** — Stable, validated integration and release history
- **`staging-branch`** — Active development (default working branch)
- **Feature branches** — `feature/your-feature-name` from `staging-branch`

```bash
# Start a new feature
git checkout staging-branch
git pull origin staging-branch
git checkout -b feature/your-feature-name

# Commit frequently with clear messages
git commit -m "fix(transform): handle zero-length datasets in resample

Previously, zero-length datasets caused a divide-by-zero error.
Now we return early with a warning.

Fixes #123."

# Push and open PR against staging-branch
git push origin feature/your-feature-name
```

## Commit Messages

Follow the conventional commits format:

```
<type>(<scope>): <subject>

<body>

Fixes #<issue>
Co-Authored-By: <name> <email>
```

**Types:**
- `fix` — Bug fix
- `feat` — New feature
- `refactor` — Code reorganization (no behavior change)
- `perf` — Performance improvement
- `test` — Test additions or fixes
- `docs` — Documentation updates
- `chore` — Build, dependency, or tooling changes

**Scope:** Component or area (e.g., `parser`, `transform`, `ui`, `electron`, `ci`)

**Subject:** Lowercase, imperative, under 50 characters. No period.

**Body:** Explain the "why" and any non-obvious implications (wrapped at 72 chars).

## Code Style & Conventions

### TypeScript/React

- Use **meaningful variable names** — `pointIndex` not `i` (unless in obvious loops)
- Prefer **const** over let; avoid `var`
- Use **type annotations** — help catch errors early
- Avoid **any** — use unknown or specific types
- **No console.log** in production code (use logger instead)
- **No dangerouslySetInnerHTML** without review
- Export only **components from React files** (enforced by ESLint)

### File Organization

```
src/
  core/            # Data models, parsers, transforms, analytics
    model.ts       # TypeScript interfaces (Dataset, TrackPoint, etc.)
    parsers/       # GPX, KML, CSV, NMEA, GeoJSON, EAG, GPB
    transforms.ts  # Smooth, resample, simplify, etc.
    analytics/     # Kinematics, quality detection, stats
    reports/       # HTML report generation
  ui/              # React components (one file per tab)
    ImportView.tsx
    MapView.tsx
    TimeSeriesChart.tsx
    ...
  state/           # Shared state modules (hooks)
    pointSelection.ts
    workspace.ts
    history.ts
  App.tsx          # Root component, tab routing
  index.tsx        # Entry point
  index.css        # Main stylesheet (design tokens)
```

### Naming Conventions

- **Components** — PascalCase (`MapView.tsx`, `TimeSeriesChart.tsx`)
- **Hooks** — camelCase starting with "use" (`usePointSelection()`)
- **Constants** — UPPER_SNAKE_CASE (`DEFAULT_MAP_ZOOM`, `MAX_POINTS`)
- **Types/Interfaces** — PascalCase (`Dataset`, `TrackPoint`, `Transform`)
- **Classes** — PascalCase (`Parser`, `Exporter`)
- **Functions** — camelCase (`parseGpx()`, `detectQualityEvents()`)

## Testing Requirements

### Unit Tests

Add tests for:
- **Parsers** — Valid/invalid inputs, edge cases (empty files, malformed XML, etc.)
- **Transforms** — Correctness (stats preserved, no data loss), edge cases (zero length, single point)
- **Analytics** — Kinematics, quality detection, statistics
- **Utilities** — Coordinate transforms, type guards

Example:

```typescript
// test/parsers/csv.ts
const validCsv = `lat,lon,ele,time\n47.6,−122.3,100,1700000000000`
const dataset = parseCsv(validCsv)
check('CSV parser extracts coordinates', dataset.points.length === 1 && dataset.points[0].lat === 47.6)
check('CSV parser infers timestamp', dataset.points[0].time === 1700000000000)
check('CSV parser flags missing elevation', dataset.warnings.length > 0)
```

### E2E Tests

Test complete workflows (import → transform → export). See `test/e2e/workbench-smoke.spec.ts` for examples.

### Performance Tests

If your change touches:
- **Parser performance** — Run `npm run bench` and compare against baseline
- **Transform efficiency** — Benchmark with 100k, 500k, 1M point datasets
- **Render performance** — Profile with DevTools or Lighthouse

## Pull Request Guidelines

### Before Opening a PR

1. **Branch from `staging-branch`**, not `main`
2. **Run full checks locally** — `npm run check:unit`
3. **Update tests** — Add or modify tests for your changes
4. **Update docs** — If you changed user-facing behavior
5. **Keep commits clean** — One logical change per commit

### PR Description

```markdown
## Summary
Brief explanation of what this PR does and why.

## Changes
- Fixed bug in resample transform when time delta is zero
- Added edge-case test for empty datasets
- Updated docs/transforms.md with new example

## Type
- [ ] Bug fix
- [ ] Feature
- [ ] Performance improvement
- [ ] Documentation update
- [ ] Refactoring

## Testing
- [x] Added unit tests
- [x] Ran npm run check:unit locally
- [x] Tested in browser (dev mode)
- [ ] Tested in Electron desktop app
- [ ] Ran e2e tests

## Related Issues
Fixes #123, relates to #456

## Checklist
- [x] Commits follow conventional format
- [x] No console.log or debug code
- [x] TypeScript compiles with no errors
- [x] ESLint passes
- [x] Tests pass
```

### Review Process

- **Maintainer review** — Code style, logic, tests, performance
- **CI checks** — All tests, linting, type checking must pass
- **Performance assessment** — Material regressions must be investigated
- **Documentation review** — User-facing changes need clear docs

After approval, your PR will be squash-merged to `staging-branch` with attribution preserved.

## Documentation Updates

For user-facing changes, update:

1. **`README.md`** — If new format, feature, or major workflow
2. **`CHANGELOG.md`** — User-visible changes (added section at top)
3. **Code comments** — Explain *why*, not *what* (well-named code is self-documenting)
4. **`ROADMAP.md`** — If this is a Phase 1/2+ item (mark as complete or update timeline)

Example CHANGELOG entry:

```markdown
## Unreleased

### Added
- Support for EAG TSPI format (European Air Group tab-delimited ECEF coordinates) with automatic date extraction from filename

### Fixed
- Zero-length datasets in resample transform no longer cause divide-by-zero error
```

## Performance Guidelines

### Don't Optimize Prematurely

Before optimizing:
1. **Profile** — Use DevTools or benchmark harness to identify bottleneck
2. **Measure** — Baseline before/after (run `npm run bench` twice)
3. **Verify** — Ensure optimization doesn't introduce data loss or UI lag

### Common Optimization Strategies

| Problem | Solution |
|---------|----------|
| CSV parsing slow for >100k points | Use chunked Worker export; suggest GPB format |
| Map rendering stutters | Downsample for display; use requestAnimationFrame |
| Chart re-renders on every state change | Memoize with useMemo; check dependency array |
| Memory spikes during export | Stream output; avoid building full array in memory |

## Getting Help

- **Questions about architecture?** — See [`.agents/ARCHITECTURE.md`](.agents/ARCHITECTURE.md) or `FUTURE_CONSIDERATIONS.md`
- **Need dev setup help?** — Check `ONBOARDING.md`
- **Have a design question?** — Open a discussion or issue
- **Found a bug in tests?** — Report it; test infrastructure is critical

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (check LICENSE file for details).

---

**Thank you for contributing!** Your work makes JDDC better for everyone.
