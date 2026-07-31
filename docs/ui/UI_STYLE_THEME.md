# JDDC Visual System & Theme Reference

Documents the current, as-implemented visual design system (`src/index.css`, `src/analysis.css`) and the deliberately separate print/export theme (`src/core/reports/htmlReport.ts`). There is no design-system dependency (no Tailwind, no CSS-in-JS, no component library) — the entire look is one hand-authored, dependency-free stylesheet, which matters for the Electron build's offline-first constraint (no remote font/CDN `@import`s anywhere).

## 1. Design philosophy

"Dark technical theme tuned for data engineers" (verbatim from `index.css`'s own header comment). The visual language borrows from engineering/ops tooling (dark IDE themes, log consoles, telemetry dashboards) rather than consumer SaaS: high information density, monospace-forward for anything numeric, minimal chrome, no illustration, no marketing gradients beyond two small accent uses (brand mark, primary buttons). Every color has a semantic job; almost nothing is decorative.

## 2. Design tokens (`:root` CSS custom properties)

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0b0f17` | Outermost background, log dock, scrollbar track |
| `--bg-1` | `#111725` | Sidebar, panel/card backgrounds, tab bar |
| `--bg-2` | `#161e2e` | Tab content area, active dataset row fill |
| `--bg-3` | `#1d2738` | Buttons, chip-on state, table stripe accents |
| `--border` | `#25324a` | Default hairline border |
| `--border-bright` | `#33425f` | Hover/emphasis border |
| `--text` | `#e6edf6` | Primary text |
| `--text-dim` | `#9fb0c8` | Secondary text, labels |
| `--text-faint` | `#65758f` | Tertiary/metadata text |
| `--accent` | `#ea4f2f` | **Primary brand accent** — burnt orange/red |
| `--accent-2` | `#0f8c6f` | **Secondary "commit" accent** — teal/green |
| `--blue` | `#3b82f6` | Info-level log badge |
| `--green` | `#16a34a` | Success states, start-of-track marker |
| `--amber` | `#eab308` | Warnings, selection-range highlight, quality gaps |
| `--red` | `#ef4444` | Errors, coordinate jumps, end-of-track marker |
| `--purple` | `#a855f7` | Log category tag, companion-track color in 3D |
| `--mono` | `ui-monospace, "SF Mono", "JetBrains Mono", "Fira Code", Menlo, monospace` | All numeric/data/log/code text |
| `--sans` | `"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | All UI chrome text |
| `--radius` | `8px` | Standard card/dialog corner radius |
| `--shadow` | `0 8px 30px rgba(0,0,0,.35)` | Toast/dialog elevation |

**The two-accent rule** is the single most important convention in the whole system and is worth calling out explicitly for anyone extending the UI: **orange (`--accent`) means "start/select/primary,"** used for the sidebar's `+ Load data` button, the active tab underline, the active dataset-item border, the selected-point map/3D marker, and the app's brand mark gradient. **Teal (`--accent-2`) means "commit/finalize/build,"** used exclusively for the CSV `Build dataset` button and the `Export` button — the two "this produces committed output" actions in the app. No other buttons use either color; all default buttons are neutral (`--bg-3` fill, `--border-bright` outline).

Semantic colors (`green`/`amber`/`red`) are reserved for data-quality meaning (valid/warn/error, start/gap/jump markers) and never used as generic UI accents — a user should be able to trust that amber/red anywhere in the app means "look at this data problem," not "this button is destructive" (destructive buttons instead just use plain neutral styling with a red *label*, e.g. the dataset remove `×`).

## 3. Typography

Two font stacks only, no display/heading font: **Inter** for all UI chrome (labels, buttons, prose, headings — headings are just bold Inter at larger size, no distinct display face), and a system monospace stack for anything that is data: coordinates, timestamps, checksums, log lines, table cells, metric values, code. This is a strict rule throughout the CSS (`.mono` utility class, `font-variant-numeric: tabular-nums` so numeric columns align). Base body size is small (14px) with a tight 1.45 line-height, biased toward density over readability whitespace — consistent with an "engineering workbench," not a content-reading app.

## 4. Layout & spacing conventions

- Cards/panels: `var(--bg-1)` fill, `1px solid var(--border)` outline, `var(--radius)` (8px) corners — used identically for metric cards, stats blocks, operation cards, dialogs, and the export preview pane. One card recipe reused everywhere rather than many bespoke ones.
- Grids favor `repeat(auto-fill, minmax(Npx, 1fr))` over fixed column counts almost everywhere (metric grid, transform operation grid, mapping fields, export format list) — panels reflow responsively without explicit breakpoints in most cases; the one explicit breakpoint (`@media max-width: 1100px`) collapses two-column grids (`stats-columns`, `export-panel`) to one column and narrows the sidebar.
- Buttons have a 1px press-down affordance (`transform: translateY(1px)` on `:active`) rather than a color change, keeping interaction feedback tactile/mechanical rather than soft.

## 5. Animation inventory

Deliberately minimal — every animation in the app is a small, purposeful CSS `@keyframes`, and there is **no animation library** (no Framer Motion, no GSAP, no react-spring). All motion is authored directly in `index.css`:

| Keyframe | Used on | Effect |
|---|---|---|
| `bob` | `.dropzone-icon` | Gentle 2.4s vertical float on the Import tab's down-arrow — the one purely "delightful" (non-functional) animation in the app |
| `spin` | `.spinner` | 0.7s linear rotation for the busy indicator |
| `slide` | `.progress-track.indeterminate .progress-fill` | 1.1s sliding highlight for indeterminate progress |
| `toast-in` | `.toast` | 0.25s fade+rise entrance |
| *(implicit transitions)* | buttons, tabs, dropzone, dataset rows | 0.05–0.2s `background`/`border-color`/`transform` transitions on hover/active/drag states — no easing exotica, all short and utilitarian |

There are no page/route transitions (there are no routes), no stagger animations, no skeleton loaders (the Spinner + ProgressBar pattern is used instead), and no scroll-triggered effects. Motion exists to communicate state (busy, dragging, progressing, just-happened) and nothing else — appropriate restraint for a tool where flight-telemetry data fidelity is the point, not the chrome.

## 6. JS/rendering libraries — and the deliberate absence of most

Dependencies (`package.json`) are minimal by design:

- **React 19** + **react-dom** — the only UI framework.
- **Leaflet** + **react-leaflet** — the *only* visualization library in the entire app, used solely for the 2D Map tab (tile basemap + path/point rendering).
- **papaparse** — CSV parsing.

Notably absent, on purpose: **no charting library** (the multi-channel time-series chart is a hand-rolled SVG component — axes, zoom/pan, brushing, quality-event markers all custom), and **no 3D/WebGL library** (the Trajectory 3D viewer is a hand-rolled 2D-`<canvas>` perspective/orthographic projector — its own matrix-free yaw/pitch/zoom math, not three.js/deck.gl). This is a conscious current-state tradeoff, not an oversight — `futureConsiderations.md` and the retired roadmap note deck.gl/Arrow evaluation as deferred backlog, not a rejected idea. Anyone extending the visualization layer should know these are green-field decisions with real prior art already sketched into the codebase's derivation/geometry layers (`src/visualization/scene3d/trajectory.ts`, `src/visualization/charts/`).

## 7. The second visual system: the printable HTML report

`src/core/reports/htmlReport.ts` generates a fully self-contained, dependency-free HTML/CSS document (no shared classes or tokens with the live app) for the Project tab's "export analysis report" feature. It is intentionally **not** a reskin of the dark app theme — it's a distinct light system nicknamed in-repo **"VectorPunk/HUD"**, designed for economical ink usage when printed and for browser-native PDF export:

- **Palette**: warm paper (`#f5f4ed` background, `#fffef8` card/paper fill) with an ink-green/teal-blue/magenta/amber accent quartet — `--signal: #238f61` (green, primary status), `--vector: #157c88` (teal, structural/grid lines), `--pulse: #b43678` (magenta, rare emphasis), `--alert: #a86f15` (amber, cautions) — plus `--ink`/`--muted`/`--line` neutrals. Nothing shares a hex value with the dark app theme; this is a fully independent design system by intent.
- **Background texture**: a faint two-axis graph-paper grid (`linear-gradient` hairlines at 32px pitch) plus a soft radial "signal bloom" in the top-left corner — evoking vector-scope/HUD readouts without literally rendering one.
- **Geometric identity marks**: small clip-path'd hex/chamfered badges (`.dataset-index`, corner-notched via `clip-path: polygon(...)`) standing in for iconography, plus a small pulsing "signal dot" (`.report-header::after`) with a soft box-shadow halo.
- **Typography**: same Inter-for-prose/monospace-for-data split as the live app, but leans harder into uppercase, wide-tracked monospace labels (`letter-spacing: .12–.16em`) for section headers and table headers — a HUD/military-readout cue that doesn't appear anywhere in the on-screen dark theme.
- **Print behavior**: a dedicated `@media print` block strips backgrounds/shadows/gradients back to plain white, keeping only structural borders — the screen version is the "display" skin, print is the "ink-economical" skin of the same markup, controlled entirely through the media query rather than a second generated document.

Anyone iterating on JDDC's visual identity should treat these as two intentionally-separate systems: the dark workbench UI is the *tool*, the light VectorPunk/HUD report is the *artifact* the tool produces for someone else to read — different audiences, different constraints (screen vs. print, engineer-facing vs. handoff/briefing-facing), and the CSS is architected as two non-overlapping files precisely because of that split.

## 8. Accessibility & responsiveness notes

- Chart quality-event overlays use both color *and* pattern/dash differentiation (`chart-event-error` vs `chart-event-warning` vs `chart-event-info` plus dasharray), not color alone.
- Interactive icon-only controls carry `aria-label`s (dataset remove, bookmark remove, playback slider).
- The only responsive breakpoint collapses two-column grids at 1100px and narrows the sidebar; below that there is no further mobile-specific layout — JDDC is explicitly a desktop-class engineering tool (reinforced by its Electron packaging), not a responsive/mobile product.
- Custom scrollbars (`::-webkit-scrollbar`) are styled to match the dark theme rather than left as default OS chrome, reinforcing the "cohesive instrument panel" feel over the app's many independently-scrolling regions (dataset list, tab content, log stream, table viewport, dialog body).
