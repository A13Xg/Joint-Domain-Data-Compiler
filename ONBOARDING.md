# JDDC Developer Onboarding

Welcome to the Joint Domain Data Compiler. This guide covers setup, key concepts, and the development workflow.

## What is JDDC?

JDDC is a **single-screen engineering workbench** for analyzing TSPI (trajectory/flight-data) logs. It imports various data formats (GPX, CSV, KML, NMEA, GPB), lets you inspect, transform, and compare tracks, then exports in your choice of format. Built for precision, auditability, and trust—not dashboards or trends.

Core design: **one screen, 13 tabs, one active dataset at a time, with cross-cutting state (dataset list, log console) always visible.**

**Learn more:** See [`.agents/ARCHITECTURE.md`](.agents/ARCHITECTURE.md) for the data model, layer map, and invariants.

## Prerequisites

- **Node 22+** (required by Vite 8 and native crypto APIs in the parser library)
- **npm 10+** (for lockfile management)
- Git

## Local Setup

```bash
# Clone the repository
git clone https://github.com/A13Xg/Joint-Domain-Data-Compiler.git
cd Joint-Domain-Data-Compiler

# Install dependencies (use npm ci for exact lockfile match)
npm ci

# Start the dev server (browser build)
npm run dev

# Open http://localhost:5173 in your browser
```

The browser build is a full-featured web app. To also develop the Electron desktop app:

```bash
npm run dev:desktop
```

## Key Commands

### Development
- `npm run dev` — Start browser dev server (Vite, HMR enabled)
- `npm run dev:desktop` — Start Electron development mode
- `npm run dev:analyze` — Dev server with bundle analyzer

### Building
- `npm run build` — Build optimized browser bundle
- `npm run build:desktop:linux` / `:win` — Package for Linux or Windows
- `npm run build:desktop` — Package for the host platform (this is the macOS path; there is no `:mac` variant)
- `npx vite build` — Vite build only

### Testing & Quality
- `npm run check:all` — Run all checks: tests, type check, lint, build
- `npm test` — Run test suite (tests in `test/` directory via esbuild runner)
- `npx tsc -b` — Type check (full project)
- `npx eslint .` — Lint all files
- `npm run bench` — Run performance benchmarks (100k/500k/1M point synthetic datasets)
- `npm run bench:map` — Benchmark map rendering with downsampling

### Desktop
- `npm run check:desktop:linux` / `:win` / `:mac` — Smoke-test packaged renderer on that platform
- `npm run build:sbom` — Generate CycloneDX SBOM

### Project Management
- `npm start` — Open packaged Electron app (if built)
- `npm run format` — Format code (Prettier)

## Project Structure

```
src/
  App.tsx                    # Root component, tab router, sidebar
  ui/                        # Tab panels and reusable components
    ImportView.tsx           # Import tab
    MappingPanel.tsx         # CSV field mapping
    StatsPanel.tsx           # Overview tab
    MapView.tsx              # Map tab
    TimeSeriesChart.tsx      # Charts tab (with legend & type validator)
    DataTable.tsx            # Table tab (virtualized)
    ComparisonPanel.tsx      # Compare tab
    Trajectory3dPanel.tsx    # 3D perspective renderer
    TransformPanel.tsx       # Transform tab (conditioning operations)
    ProjectPanel.tsx         # Project/save tab
    ExportPanel.tsx          # Export tab
    SourcesPanel.tsx         # Sources/visibility tab
    FusionPanel.tsx          # Sensor fusion tab
    OperationHistoryPanel.tsx # Operation history display
    ChartTypeSelector.tsx    # Chart type validation & selection
    ChartLegend.tsx          # Channel legend for charts
    FormValidation.ts        # Reusable form validation utilities

  state/
    pointSelection.ts        # Linked cursor across Table/Chart/Map/3D
    workspaceDisplay.ts      # Dataset color/visibility
    workspace.ts             # Durable view settings
    mapOverlays.ts           # KML/KMZ library state
    history.ts               # Undo/redo snapshots

  core/
    parsers/                 # Format-specific parsers (GPX, CSV, KML, NMEA, GPB)
    transformations/         # Dataset operations (resample, dedupe, smooth, etc.)
    stats.ts                 # Statistical analysis (bbox, ranges, counts)
    quality/                 # Quality-event detection (gaps, duplicates, jumps)
    kinematic.ts             # Velocity, acceleration derivation
    format.ts                # Timestamp/coordinate formatting utilities
    logger.ts                # Singleton logger (feeds LogConsole)
    recipes/                 # Saved transform procedures
    reports/                 # HTML debrief report generation

  persistence/               # Save/restore .jddc-project archives
  electron/                  # Desktop-only IPC, preload, main process

  index.css                  # Design tokens, shell layout, all UI styles
  analysis.css               # Supplementary styles

test/                        # Test harnesses (check() pattern)
  *.ts / *.tsx              # Test files auto-discovered by test runner
  helpers/                   # Test utilities (linkedom shim, DOM setup)

benchmarks/                  # Performance baseline harnesses
electron/                    # Desktop app main process, preload script, security config
docs/ (removed)             # Docs consolidated into .agents/ + ONBOARDING.md

.agents/                     # AI tooling + ARCHITECTURE.md (how the app works)
AGENTS.md                    # Entrypoint for AI coding agents
ONBOARDING.md              # This file
README.md                   # User-facing project description
CLAUDE.md                   # Claude Code project configuration (local)
```

## Development Workflow

### Branch Strategy

1. **Start from `main`** (stable, validated)
2. **Work on `agent/roadmap-integration`** (active development branch)
3. **Keep one open PR** from `agent/roadmap-integration` to `main`
4. **Commit incremental sub-goals** to the development branch
5. **After merge to main, fast-forward `agent/roadmap-integration`** before continuing

Historical `agent/*` branches can be deleted after confirming their PR is merged.

### Making Changes

1. **Type check** as you go: `npx tsc -b`
2. **Test your changes**: `npm test`
3. **Run the full gate before commit**: `npm run check:all`
4. **Commit with clear messages** (no generated/auto-formatted logs—write intent-focused messages)
5. **Push to `agent/roadmap-integration`**
6. **CI runs on each push** (linting, testing, build verification)

### Testing

- **Unit/integration tests** live in `test/` alongside the source (e.g., `test/chart-type-selector.tsx` tests `src/ui/ChartTypeSelector.tsx`)
- **Test harness**: `check(name, condition)` pattern (returns true/false, logs results, exit code reflects overall pass/fail)
- **DOM testing**: Uses `linkedom` (lightweight DOM implementation) + `react-dom/client` for React component tests
- **Add tests for**: new components, validators, transformations, parsers
- **Skip tests for**: 3rd-party library behavior, stable code (unless fixing a regression)

Example test structure:
```typescript
// test/my-feature.ts
import { check } from './helpers/check.js';

const results = [];
let passed = 0;

results.push(check('feature works', myFeature() === expectedResult));
passed += results[results.length - 1] ? 1 : 0;

console.log(`\n=== my-feature.ts ===\n${results.map((r, i) => `${r ? '[PASS]' : '[FAIL]'} test ${i + 1}`).join('\n')}\n`);
process.exit(passed === results.length ? 0 : 1);
```

## Code Style & Quality

- **Prettier** auto-formats on save (configured in `.prettierrc.json`)
- **ESLint** enforces rules (see `.eslintrc.*`, `eslint.config.js`)
- **TypeScript strict mode** enabled
- **React 19 conventions**: no explicit `React` imports (automatic JSX transform); prefer functional components with hooks
- **Component exports only**: Component files may only export React components (react-refresh/only-export-components)
- **No comments unless non-obvious**: Code should be self-documenting; comments explain *why*, not *what*
- **Prefer native APIs**: File, Blob, Web Crypto, fetch—over npm equivalents when possible

## Dependencies & Policies

- **Runtime dependencies**: Zero-tolerance high/critical vulnerabilities. `npm audit --omit=dev --audit-level=high` enforced in CI.
- **Dev-only dependencies**: Audit findings tracked but don't block CI (build-time only).
- **Lockfile discipline**: `package-lock.json` is canonical. Always run `npm ci` in CI; `npm install` locally. Commit any lockfile changes.
- **Updates**: Patch/minor versions individually per commit with full `check:all` gate after each. Majors on dedicated branch with changelog review.

## Performance

- **Benchmark baseline** updated at release (stored in code + CI pipeline)
- **Run benchmarks**: `npm run bench` (100k/500k/1M point synthetic datasets)
- **Map visual budget**: ~4,000 points max (larger datasets downsampled for display; full data preserved for export)
- **DOM parsing limit**: 100k points (larger datasets use GPB binary format or chunked Worker export)
- **Profile before optimizing**: Use Chrome DevTools Performance tab; flamegraph in Vite profile mode

## Electron Desktop App

The desktop app (`.exe` / `.dmg` / AppImage) packages the browser build with:

- **Preload IPC** for 5 KML/KMZ library operations (read-only, no arbitrary file access)
- **Native packaged renderer** launched via `BrowserWindow.loadFile`
- **Fuse V1 security**: ASAR integrity, cookie encryption, sandboxing + context isolation
- **Project archive** stored as `.jddc-project` (ZIP + embedded JSON)

To test locally:
```bash
npm run build:desktop:linux  # or :win; use `build:desktop` on macOS
npm run check:desktop:linux  # or :win, :mac
```

Releases run per-platform. Tag `v0.2.0` to build all three, or `linux-v0.2.0` /
`win-v0.2.0` / `mac-v0.2.0` to add a single platform to that same release. Every
platform workflow can also be run on demand from the Actions tab. macOS signing is manual.

## Common Tasks

### Adding a new tab/panel

1. Create `src/ui/MyPanel.tsx` exporting a React component
2. Add a `tabs` entry in `src/App.tsx` with tab id, label, and enable condition
3. Render conditionally: `{activeTab === 'myTab' && <MyPanel {...props} />}`
4. Add state management in `src/state/` if needed (cross-tab state) or keep local
5. Add tests in `test/my-panel.tsx`

### Adding a new data transformation

1. Create the operation function in `src/core/transformations/`
2. Add a card UI in `TransformPanel.tsx`
3. Call the operation, create an `OperationRecord`, update history
4. Show before/after stats and a toast confirmation
5. Test with `npm test`

### Adding a new parser format

1. Create `src/core/parsers/myFormat.ts` exporting `parseMyFormat(text: string): Dataset`
2. Add format detection in `src/ui/ImportView.tsx` (file extension sniffing)
3. Add tests in `test/myformat-parser.ts`
4. Update supported-formats display

### Debugging

- **Browser dev**: Open Chrome DevTools (F12)
- **Node test runner**: Add `console.log()` in test file; output appears in terminal
- **Electron main process**: VS Code attach debugger or use `chrome://inspect`
- **React DevTools**: Install browser extension
- **Performance profiling**: `npm run build && npm run vite:profile`

## Getting Help

- **Architecture questions**: Read [`.agents/ARCHITECTURE.md`](.agents/ARCHITECTURE.md) (data model, layers, invariants)
- **Component questions**: Check `src/ui/` file nearest to your task; most components are self-documented
- **State management**: See `src/state/*.ts` modules
- **Data pipeline**: Trace imports → parsing → transformations → export in `src/core/`
- **Testing**: Look at existing test files (e.g., `test/chart-type-selector.tsx`)
- **Performance baseline**: Check benchmarks/ and release-checklist notes

## Release Process

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full release checklist. High-level:

1. Update version in `package.json`, `package-lock.json`, `README.md`
2. Commit release prep, wait for CI (Quality Gates workflow)
3. Create and push `vX.Y.Z` tag
4. Wait for Linux/Windows/macOS builds to complete
5. Verify `SHA256SUMS.txt`, SBOMs, and provenance attestations
6. Review release notes before announcing

**Important**: Never move or delete an existing tag. If a release has a bug, publish a corrective new version.

---

**Ready to start?** Run `npm run dev`, open http://localhost:5173, and explore. The UI is the spec—every control and state behavior is the source of truth.
