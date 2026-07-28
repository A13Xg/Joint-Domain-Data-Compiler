# JDDC Consolidated Completion Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Deliver a fully verified, local-first Joint Domain Data Compiler by repairing the current release gate, unifying KML/KMZ track import and map overlays, improving CSV and report workflows, then completing the remaining linked-analysis, persistence, scale, and release evidence work in impact order.

**Architecture:** Keep immutable imported datasets separate from persistent map-overlay resources and derived outputs. Build pure typed core/persistence contracts before renderer/UI wiring, preserve provenance through all transforms and reports, and run focused test-first vertical slices before broad gates. Treat native-package/hosted-CI proof as distinct from local code correctness.

**Tech Stack:** TypeScript 6, React 19, Vite 8, Electron 42, electron-builder 26, Leaflet/react-leaflet, Canvas 2D local ENU, Web Workers, Playwright, esbuild test harnesses.

---

## Current verified context and constraints

- Repository: `C:\Users\SnowBlind\Documents\GitHub\Joint-Domain-Data-Compiler`; inspect the active branch before each change.
- Raw imports must never be mutated. Derived, fused, smoothed, comparison, and overlay state must remain explicit and auditable.
- Current clean-install verification: `npm ci` and lint pass; two harnesses fail because Electron path tests use host path semantics while simulating other platforms.
- Runtime production audit has historically passed. The full development audit has 16 high findings in Electron Builder’s build-only dependency graph; do not run `npm audit fix --force` or downgrade Electron Builder without a verified packaging plan.
- GitHub Actions is externally blocked by repository billing; macOS signing/notarization requires owner-provided credentials. These are release-evidence blockers, not reasons to weaken local gates.
- A pull request is open. Commit verified coherent slices with short conventional messages and push them to the active PR branch. Add brief PR comments only for material verification milestones, blockers, or decisions.

## Product decisions fixed by this plan

1. KML/KMZ **track import** remains a normal Import-tab parser route that produces a normal immutable dataset.
2. KML/KMZ **map overlay** is a separately persisted visual resource rendered only by Map; showing it must not silently create a dataset.
3. Remove the top-level KML/KMZ tab. Move its storage/management controls into Map → Overlays.
4. Package `KML-KMZ/Special_Use_Airspace.kml` as a read-only seed and copy it idempotently into the Electron user library on first run without overwriting user files.
5. CSV mapping previews the first 20 physical rows including row one, infers headers with an explainable confidence, and lets users override with accessible help.
6. HTML report export opens a naming/configuration dialog with safe defaults and expandable granular report-content controls.

---

# Phase 0 — Re-establish a trustworthy verification baseline

### Task 0.1: Pin target-platform executable path behavior

**Objective:** Remove host-OS path leakage from Electron fuse path logic and tests.

**Files:**
- Modify: `scripts/electron-fuses.cjs:29-39`
- Modify: `test/electron-fuses.ts:17-36`

**Step 1: Write failing test**

Add explicit target-platform cases with the expected Windows `\\`, POSIX `/`, and macOS `.app/Contents/MacOS` layouts independent of the host running the test.

**Step 2: Run test to verify failure**

Run: `npx esbuild test/electron-fuses.ts --bundle --platform=node --format=esm --outfile=.test-build/electron-fuses.mjs && node .test-build/electron-fuses.mjs`

Expected: three target-layout assertions fail on Windows before the implementation change.

**Step 3: Write minimal implementation**

Select `path.win32` for `win32` and `path.posix` for Linux/macOS inside `packagedExecutablePath`; do not change the generated product/executable naming contract.

**Step 4: Run focused test to verify pass**

Re-run the command from Step 2. Expected: all fuse checks pass.

### Task 0.2: Make library-containment tests platform-correct

**Objective:** Preserve strict KML/KMZ path containment while testing valid paths using the host’s path dialect.

**Files:**
- Modify: `electron/security.cjs:21-35` only if a pure containment helper needs normalization
- Modify: `test/electron-integration.ts:33-42`

**Step 1: Write failing test**

Create test directory/name values with `path.join()`/`path.resolve()` and assert safe basename reduction, valid in-library resolution, traversal rejection, and prefix-collision rejection.

**Step 2: Run test to verify failure**

Run: `npx esbuild test/electron-integration.ts --bundle --platform=node --format=esm --outfile=.test-build/electron-integration.mjs && node .test-build/electron-integration.mjs`

Expected: current POSIX literal test aborts on Windows.

**Step 3: Write minimal implementation**

Keep `safeLibraryName` and fixed-root containment enforcement. Use resolved absolute paths and a separator-aware prefix boundary; do not expose arbitrary paths through preload.

**Step 4: Run focused test to verify pass**

Re-run the command from Step 2. Expected: all IPC/security checks pass.

### Task 0.3: Establish baseline evidence

**Objective:** Prove the current tree is valid before feature changes.

**Files:** None unless a gate reveals a genuine defect.

**Step 1:** Run `npm ci`.

**Step 2:** Run `npm run lint && npm test && npm run build`.

**Step 3:** Run `npm run build:desktop:win && npm audit --omit=dev --audit-level=high && git diff --check`.

**Expected:** all local gates pass. Record hosted-CI/macOS proof as externally blocked if still unavailable.

---

# Phase 1 — KML/KMZ dual-mode import and Map overlay management

### Task 1.1: Define immutable overlay contracts

**Objective:** Model map overlays separately from datasets and normalize only safe persisted state.

**Files:**
- Create: `src/state/mapOverlays.ts`
- Modify: `src/state/workspace.ts`
- Test: `test/map-overlays.ts`

**Step 1: Write failing tests**

Cover `MapOverlay` creation and normalization for `id`, `sourceKind` (`bundled`, `library`, `project`), safe source key, name, visibility, opacity `[0,1]`, z-index, digest, status, and missing-resource reconciliation.

**Step 2:** Bundle/run `test/map-overlays.ts`; expect missing module/function failures.

**Step 3: Implement minimal pure functions**

Create deterministic display defaults, validated restore normalization, visibility/opacity/order updates, and reconciliation that marks unavailable overlays rather than silently deleting provenance.

**Step 4:** Re-run focused test; expect pass.

### Task 1.2: Persist overlays through project manifests safely

**Objective:** Save overlay references and controls, not renderer objects or arbitrary file paths.

**Files:**
- Modify: `src/persistence/project/manifest.ts`
- Modify: `src/persistence/project/archive.ts`
- Modify: `src/state/workspace.ts`
- Test: `test/project-manifest.ts`, `test/project-archive.ts`, `test/map-overlays.ts`

**Step 1: Write failing round-trip tests**

Prove bundled/library references survive archive save/open; malformed fields normalize/reject; missing resources are surfaced; point data is not duplicated in overlay state.

**Step 2:** Run the focused project harnesses; expect new assertions to fail.

**Step 3: Implement schema evolution**

Add an optional, versioned-compatible overlay field, migration/default behavior for old archives, and manifest validation with record/size limits.

**Step 4:** Re-run focused harnesses; expect pass.

### Task 1.3: Package and seed the representative overlay

**Objective:** Ship `Special_Use_Airspace.kml` and make it safely available on every fresh desktop installation.

**Files:**
- Modify: `package.json` Electron Builder configuration
- Modify: `electron/main.cjs`, `electron/security.cjs`
- Modify: `electron/preload.cjs`, `src/types/desktop.d.ts`, `src/desktop/kmlLibrary.ts` only for necessary narrow APIs
- Modify: `KML-KMZ/README.md`
- Test: `test/electron-integration.ts`, new `test/kml-seed.ts` or main-process helper test

**Step 1: Write failing seed tests**

Cover packaged resource lookup, first-run copy, repeat-run idempotency, user-file no-overwrite, unsupported extension rejection, byte bounds, and no renderer-visible absolute path.

**Step 2:** Run the focused test. Expected: no seed lifecycle exists.

**Step 3: Implement minimal main-process seeding**

Use packaged `extraResources` plus a read-only seed directory, copy only absent entries into `app.getPath('userData')`, and preserve the current bounded library IPC surface.

**Step 4:** Run focused tests and `npm run build:desktop:win`. Expected: seed tests and package pass.

### Task 1.4: Move KML/KMZ management to Map

**Objective:** Replace the top navigation KML/KMZ tab with a Map-owned overlay manager without regressing track import.

**Files:**
- Create: `src/ui/MapOverlayPanel.tsx`
- Modify: `src/ui/MapView.tsx`, `src/App.tsx`, `src/index.css`
- Modify or retire: `src/ui/KmlLibraryPanel.tsx`
- Test: `test/e2e/workbench-smoke.spec.ts`, focused overlay state tests

**Step 1: Write failing UI/integration tests**

Assert no `kmlLibrary` primary tab is rendered; Map exposes Overlays; bundled entry toggles visibility/opacity/zoom; "Import as track" routes through existing parser flow; overlay failure does not block map or dataset render.

**Step 2:** Run the focused E2E/component-equivalent test; expect failure.

**Step 3: Implement Map Overlay manager**

Render overlay manager as Map-local drawer/panel. Retain upload, refresh, remove user file, source badges, ordering, reset bundled seed, and error/status UX. Render overlay geometry below interactive dataset paths with accessible labels and non-color-only status.

**Step 4:** Run focused tests plus `npm run test:e2e`; expect pass.

### Task 1.5: Verify KML/KMZ track import remains ordinary import

**Objective:** Ensure overlay work cannot break parser-backed KML/KMZ datasets.

**Files:**
- Modify: `test/parser-fixtures.ts`, `test/e2e/workbench-smoke.spec.ts`
- Inspect: `src/core/parsers/kml.ts`, import flow in `src/App.tsx`

**Step 1:** Add test importing KML/KMZ from Import and asserting a normal dataset reaches map/table/3D/export behavior.

**Step 2:** Run test to verify baseline behavior or reveal a regression.

**Step 3:** Apply only parser/import wiring fixes required by the failing test.

**Step 4:** Re-run parser/E2E tests; expect pass.

---

# Phase 2 — CSV preview and header detection

### Task 2.1: Add pure, explainable header inference

**Objective:** Infer but never silently force whether physical row 1 is headers.

**Files:**
- Create: `src/core/parsers/csvPreview.ts`
- Modify: `src/core/parsers/csv.ts`
- Test: `test/csv-preview.ts`

**Step 1: Write failing tests**

Cover headered rows, all-numeric/headerless rows, dates/coordinates, duplicate/blank names, mixed ambiguous data, delimiter variants, quoted commas/newlines, and output `{ inferred, confidence, reasons }`.

**Step 2:** Run focused test; expect module absent.

**Step 3: Implement bounded sampling/inference**

Read only sufficient data for the first 20 physical rows and apply deterministic heuristic scoring. Return `ambiguous` confidence rather than guessing certainty.

**Step 4:** Re-run focused test; expect pass.

### Task 2.2: Add accessible mapping preview and override

**Objective:** Make the proposed header decision inspectable and reversible before import.

**Files:**
- Modify: `src/ui/MappingPanel.tsx`, `src/App.tsx`, `src/index.css`
- Test: `test/e2e/workbench-smoke.spec.ts`, `test/csv-preview.ts`

**Step 1: Write failing browser test**

Assert first 20 physical rows including row one appear, the checkbox/switch has a clear label and help text, inferred confidence/reasons are visible, and toggling header mode changes generated column behavior.

**Step 2:** Run focused browser test; expect failure.

**Step 3: Implement UI state**

Keep source-scoped preview/header override state; reset only on source replacement. Use a `<details>` explanation or accessible tooltip explaining that unchecked means row 1 is data and generated column names are used.

**Step 4:** Run focused browser and parser tests; expect pass.

### Task 2.3: Honor final mapping during streaming import

**Objective:** Prevent preview/mapping settings from diverging from actual CSV ingestion.

**Files:**
- Modify: `src/core/parsers/csv.ts`, `src/App.tsx`
- Test: `test/csv-import-limits.ts`, `test/csv-preview.ts`

**Step 1:** Add failing test proving override changes first emitted point/field mapping while streaming point budgets and cancellation still work.

**Step 2:** Run focused test; expect failure if mapping state is bypassed.

**Step 3:** Thread final mapping/header config into stream parsing without retaining full file rows.

**Step 4:** Run focused tests; expect pass.

---

# Phase 3 — Configurable HTML report export

### Task 3.1: Define report option and section contracts

**Objective:** Generate only explicitly requested optional evidence with truthful omission language.

**Files:**
- Modify: `src/core/reports/htmlReport.ts`
- Create: `src/core/reports/options.ts`
- Test: `test/html-report.ts`, new `test/report-options.ts`

**Step 1: Write failing tests**

Cover safe default options, mandatory title/generated-at/scope statement, individually disabled source metadata/warnings/quality/bookmarks/history, comparison/fusion/notional/overlay inventory sections, hostile title/filename handling, and invalid option combinations.

**Step 2:** Run focused tests; expect missing option contract.

**Step 3: Implement typed report options**

Split report into pure section builders driven by validated options. Do not post-process HTML strings. Include a clear “Included evidence” and “Not included” scope block.

**Step 4:** Re-run report tests; expect pass.

### Task 3.2: Add report export configuration dialog

**Objective:** Let users name a report and choose granular contents before download.

**Files:**
- Create: `src/ui/ReportExportDialog.tsx`
- Modify: `src/ui/ProjectPanel.tsx`, `src/App.tsx`, `src/index.css`
- Test: `test/e2e/workbench-smoke.spec.ts`

**Step 1: Write failing browser test**

Open Export HTML report and assert prefilled project/dataset/date-derived title and filename, expandable accessible checklist, reset defaults, selected exclusion reflected in generated report, and cancel causes no download.

**Step 2:** Run focused E2E; expect failure.

**Step 3: Implement dialog**

Use semantic dialog/focus handling, filename sanitization, option descriptions, and a pre-generation confirmation. Browser downloads selected safe filename; Electron invokes the existing save bridge only after confirmation.

**Step 4:** Run focused E2E/report tests; expect pass.

### Task 3.3: Persist report preferences only by explicit opt-in

**Objective:** Avoid unexpected project-level retention while enabling repeatable reports.

**Files:**
- Modify: `src/state/workspace.ts`, `src/persistence/project/manifest.ts`, `src/persistence/project/archive.ts`
- Modify: `src/ui/ReportExportDialog.tsx`
- Test: `test/project-manifest.ts`, `test/project-archive.ts`, `test/report-options.ts`

**Step 1:** Add failing archive tests for absent preferences, remembered preferences, invalid restored values, and no raw data embedded in preferences.

**Step 2:** Run focused tests; expect failure.

**Step 3:** Add optional validated preferences plus explicit “Remember these settings for this project” control; defaults remain non-persistent.

**Step 4:** Run focused project/report tests; expect pass.

---

# Phase 4 — Linked multi-source inspection and visualization completion

### Task 4.1: Establish compatibility-gated shared 3D origin

**Objective:** Render visible compatible tracks in 3D without inventing a reference frame.

**Files:**
- Modify: `src/visualization/scene3d/trajectory.ts`, `src/ui/Trajectory3dPanel.tsx`, `src/App.tsx`
- Modify: `src/core/metadataCompatibility.ts`
- Test: `test/trajectory-3d.ts`, `test/metadata-compatibility.ts`

**Steps:** write failure for compatible multi-track shared ENU origin → implement pure shared-origin geometry → test warning/blocked incompatible case → wire controlled display state → run focused tests.

### Task 4.2: Synchronize timestamp-driven playback and comparison selection

**Objective:** Share a time cursor across map, chart, table, comparison, and 3D.

**Files:** `src/state/pointSelection.ts`, `src/ui/{MapView,TimeSeriesChart,DataTable,Trajectory3dPanel,ComparisonPanel}.tsx`, tests for selection and E2E.

**Steps:** test time-cursor propagation and gap behavior → implement state contract → wire each view incrementally → test keyboard/mouse/playback synchronization → run E2E.

### Task 4.3: Finish comparison analysis UX

**Objective:** Expose already-tested interpolation and add reproducible error analysis/reporting.

**Files:** `src/ui/ComparisonPanel.tsx`, `src/core/analytics/relative.ts`, new comparison report module, relevant tests.

**Steps:** test interpolation toggle → wire it with derived labels → add clock offset/drift and along/cross-track pure operations only after tests → add residual/closest-approach views → persist settings/report → run unit/E2E tests.

### Task 4.4: Finish chart/map/3D evidence surfaces

**Objective:** Provide trustworthy multi-pane charts, explicit axes, exportable deterministic visual evidence, and persisted camera/layout state.

**Files:** chart/Map/3D UI and state modules; tests and Playwright visual setup.

**Steps:** introduce typed layout/camera contracts → test restore normalization → add one pane at a time with labelled scale → add raw/processed overlay → add deterministic SVG/PNG export → add report attachment only after visual stability tests.

---

# Phase 5 — Reproducible transforms, fusion, projects, and reports

### Task 5.1: Add recipe capture/replay UI and bounded history

**Files:** `src/core/recipes/*`, `src/ui/TransformPanel.tsx`, manifest/archive, recipe tests.

**Steps:** test recipe serialization/replay mismatch → implement UI capture/save/load → test engine version/fingerprint warning → introduce checkpoint/delta policy with migration → validate archive round trips.

### Task 5.2: Expand transforms only with explicit contracts

**Files:** `src/core/transforms.ts`, new focused modules/tests, `TransformPanel`.

**Steps:** for each transform (EMA, rolling analytics, timestamp correction, distance resampling, monotone interpolation), write invalid/edge/immutability test → implement pure core → expose validated control → verify provenance and preview. Defer Butterworth until uniform sampling preconditions are implemented and tested.

### Task 5.3: Complete auditable fusion

**Files:** `src/core/fusion/*`, `src/ui/FusionPanel.tsx`, project persistence, fusion tests.

**Steps:** test entity/source persistence → add spatial/metadata gate → test manual point and interval overrides → add timeline UI → persist fused output/report/overrides → test restore and export provenance.

### Task 5.4: Complete project annotations and evidence-backed reporting

**Files:** manifest/archive, `ProjectPanel`, report modules/tests.

**Steps:** test annotation validation → implement project notes → test missing-resource repair → add optional chart/map/3D report images after stable capture → test report/diagnostic privacy boundaries.

---

# Phase 6 — Measured scale architecture and format expansion

### Task 6.1: Complete benchmark matrix

**Files:** `benchmarks/*`, `scripts/run-benchmarks.mjs`, `docs/performance-baseline.md`.

**Steps:** add tests for deterministic fixtures → measure parsing, chart, geometry, comparison, project IO, exports at 100k/500k/1M → publish actual thresholds → add user-visible warning/refusal tests.

### Task 6.2: Move only proven hotspots to Workers

**Files:** `src/core/compute/*`, `src/workers/*`, optional `src/core/columns/*`, tests.

**Steps:** test cancellation/progress for one hotspot → implement cooperative yielding → benchmark → add transfer-safe columns only if it wins → test round trip and memory → repeat for next proven bottleneck.

### Task 6.3: Add formats only after architecture evidence

**Files:** new parser/export modules, fixtures/tests, package manifest only if required.

**Steps:** harden GPB bounds/revision and unit normalization first → decide Arrow/Parquet after column model → require valid/malformed fixtures, units, limits, and round-trip expectations before each format lands.

---

# Phase 7 — Release and operational evidence

### Task 7.1: Complete local automated evidence

**Files:** E2E tests, packaged smoke scripts, workflows, docs.

**Steps:** add visual smoke once deterministic → extend critical workflow E2E to CSV, overlay, comparison, fusion, report preferences → run packaged Windows smoke → verify release bundle/checksums/SBOM/attestation contract.

### Task 7.2: Complete external release proof

**Files:** release workflow/docs only as needed.

**Steps:** after billing unblocks Actions, run Linux/Windows/macOS matrix → attach evidence → configure macOS signing/notarization only with owner credentials → verify signed/unsigned fallback behavior and documented rollback.

---

# Final verification requirements

After each vertical slice:

```bash
npm run lint
npm test
npm run build
```

Before marking a phase complete:

```bash
npm ci
npm run lint
npm test
npm run build
npm run build:desktop:win
npm audit --omit=dev --audit-level=high
git diff --check
```

Also run `npm run test:e2e`, packaged smoke, Semgrep, and release-bundle verification whenever the slice touches browser UI, Electron bridge/main process, packaging, or release workflow. Keep hosted-CI, macOS credential, and billing blockers explicitly separate from code-test results.

---

# Phase 8 — Packaged Windows renderer reliability

**Goal:** Ensure the packaged Windows application renders the complete JDDC workbench, not an empty native window with only its menu bar.

### Task 8.1: Reproduce and capture renderer diagnostics

**Files:** `scripts/smoke-packaged.mjs`, `electron/main.cjs`, packaged Windows artifacts.

**Steps:** Launch the current unpacked and portable builds with remote debugging enabled; inspect the renderer document URL, console, network failures, uncaught exceptions, and DOM root content. If GUI automation is needed, use a verified Windows Sandbox unless the user explicitly opts out. Treat a DevTools endpoint/title response alone as insufficient evidence that React mounted.

### Task 8.2: Write a failing packaged-content smoke contract

**Files:** `scripts/smoke-packaged.mjs`, `test/packaged-smoke.ts` if the pure helpers warrant a unit harness.

**Steps:** Require packaged renderer evaluation to confirm a non-empty `#root`, the expected import/workbench landmark, and no fatal console exception. Run it against the failing package to prove it detects the blank-window condition.

### Task 8.3: Fix the actual packaged-only cause

**Likely files:** `electron/main.cjs`, `vite.config.*`, package configuration, asset/resource paths, preload or CSP configuration.

**Steps:** Apply the narrowest fix supported by the capture evidence. Preserve secure `contextIsolation`, sandboxing, and navigation policy. Rebuild Windows artifacts and prove both unpacked and portable/installer renderer content loads.

### Task 8.4: Retain verified release artifact

**Steps:** Copy the freshly verified unsigned Setup and Portable executables plus checksum evidence to `C:\Users\SnowBlind\Downloads\JDDC-0.1.0-windows-build\`. Do not imply signing; verify the actual signing state separately if required.

**Acceptance:** The packaged app has a populated React root and visible JDDC Import/workbench content, with console errors treated as test failures. `npm run check:desktop:win` proves content rather than merely window launch.

---

# Phase 9 — Independent implementation audit

**Goal:** Perform a read-only, evidence-based review of every roadmap phase and feature claim after implementation, without relying on prior completion labels.

### Task 9.1: Audit contracts and source wiring

**Files:** all roadmap-referenced modules, tests, manifests, Electron bridge, UI entry points, package/workflow configuration.

**Steps:** Record HEAD and dirty state; map each phase requirement to implementation, focused test, integration entry point, persistence behavior, and release evidence. Classify every item as verified, implemented-but-unverified, partial, missing, or externally blocked.

### Task 9.2: Independently execute verification matrix

**Steps:** Run clean install, lint, full unit harnesses, web build, Windows package/content smoke, runtime audit, whitespace check, E2E, Semgrep, and release-bundle verification where installed. Mark skipped/unavailable checks explicitly rather than treating them as passes.

### Task 9.3: Review correctness, security, UX, and regressions

**Steps:** Check immutable-data/provenance guarantees, archive migration/normalization, Electron trust boundaries, input/resource limits, accessibility/non-color states, persistence/control wiring, parser/format coverage, and report truthfulness. Inspect diff and tests as independent evidence; fix confirmed defects with separate TDD slices.

**Acceptance:** Publish a phase-by-phase audit table with exact evidence, remaining scope, and external blockers. Do not mark the consolidated roadmap complete until every non-deferred acceptance criterion has fresh proof.

# Risks and decisions

- **KML/KMZ rendering breadth:** support the features the existing parser/renderer can faithfully display; surface unsupported constructs instead of silently losing them.
- **Seed provenance:** bundled seed assets are versioned application content, while user-library copies are user data. Never overwrite user copies during updates.
- **CSV header inference:** it is a proposal, not data truth. Override must be obvious and retained for the selected source.
- **Report privacy/truthfulness:** configuration controls inclusion, mandatory scope language discloses omission, and preferences are opt-in.
- **Scope control:** do not substitute speculative columnar/WebGL/format rewrites for benchmark-backed work.
- **External constraints:** no claim of cross-platform CI/signing completion before the actual jobs run with required billing/secrets.
