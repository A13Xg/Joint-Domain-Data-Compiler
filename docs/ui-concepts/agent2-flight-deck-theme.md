# JDDC — Visual System: The Flight Deck

*Colors, type, and motion as they actually exist in `src/index.css`, `src/analysis.css`, and `src/core/reports/htmlReport.ts` — plus, clearly marked at the end, where this could go next.*

There's no design-system dependency underneath any of this. No Tailwind, no CSS-in-JS, no component library, no icon font pulled from a CDN. One hand-authored stylesheet, offline-safe by construction — a real constraint for an Electron app that needs to work with no network at all, not a stylistic flex. Every visual decision below is doing a job; there is almost no decoration for its own sake.

## The one-line brief

If you had to compress the whole visual identity into a sentence, it's this: **a dark instrument panel where color is a signal, not a mood.** The reference points are dark IDE themes, log consoles, and telemetry displays — not consumer SaaS, not marketing sites. High density, monospace wherever a number lives, and exactly two places where the palette allows itself a flourish: the brand mark and the two primary-action buttons. Everything else is neutral fill and hairline border.

## Color tokens — the real values

These are the actual custom properties defined in `:root`. Nothing here is aspirational.

| Token | Hex | What it's for |
|---|---|---|
| `--bg` | `#0b0f17` | Outermost background, log dock, scrollbar track |
| `--bg-1` | `#111725` | Sidebar, panel/card fills, tab bar |
| `--bg-2` | `#161e2e` | Tab content area, the active dataset row's fill |
| `--bg-3` | `#1d2738` | Default button fill, chip-on state, table stripe |
| `--border` | `#25324a` | Default hairline |
| `--border-bright` | `#33425f` | Hover/emphasis border |
| `--text` | `#e6edf6` | Primary text |
| `--text-dim` | `#9fb0c8` | Secondary text, field labels |
| `--text-faint` | `#65758f` | Tertiary/metadata text |
| `--accent` | `#ea4f2f` | Primary brand accent — burnt orange/red |
| `--accent-2` | `#0f8c6f` | Secondary "commit" accent — teal/green |
| `--blue` | `#3b82f6` | Info-level log badge |
| `--green` | `#16a34a` | Success states, start-of-track marker |
| `--amber` | `#eab308` | Warnings, the selection-range highlight, quality gaps |
| `--red` | `#ef4444` | Errors, coordinate jumps, end-of-track marker |
| `--purple` | `#a855f7` | Log category tag, companion-track color in the 3D view |
| `--mono` | `ui-monospace, "SF Mono", "JetBrains Mono", "Fira Code", Menlo, monospace` | Every number, log line, code fragment |
| `--sans` | `"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | All UI chrome |
| `--radius` | `8px` | Standard corner radius, cards through dialogs |
| `--shadow` | `0 8px 30px rgba(0,0,0,.35)` | Toast/dialog elevation |

### The two-accent rule

If you remember one governing rule from this system, make it this one, because it's load-bearing across the entire product: **orange means "start."** It's the `+ Load data` button, the active tab's underline, the active dataset row's border, the selected-point marker on the Map and in 3D, the brand mark's gradient. It's the color of *beginning* something or *pointing at* something.

**Teal means "commit."** It appears in exactly two places in the entire app: the CSV Mapping tab's `Build dataset` button, and the Export tab's `Export` button. That's it — two buttons, one meaning, zero ambiguity. Everything else defaults to plain neutral (`--bg-3` fill, `--border-bright` outline on hover) — including destructive actions, which get a red *label*, not a red button. The dataset-removal `×` doesn't scream at you in red chrome; it's a neutral control with red text, because a loud red button next to every list item would cheapen red everywhere else it's used for something that actually matters — an invalid coordinate, a coordinate jump, an error state.

That's the second half of the rule: `green`/`amber`/`red` are reserved, completely, for data-quality meaning. Amber and red anywhere in this app mean "there's a problem with your *data*," never "this button will do something drastic." Once you know that, you can trust the color system implicitly instead of hovering over every red-adjacent thing to check what it does.

## Typography

Two typefaces, no more. **Inter** carries every piece of UI chrome — labels, buttons, prose, and headings (headings are just larger, bolder Inter; there's no separate display face doing extra work). The system monospace stack carries everything that's *data*: coordinates, timestamps, checksums, log lines, table cells, metric values, code. This split is enforced as a hard rule via a `.mono` utility class, and numeric columns get `font-variant-numeric: tabular-nums` so digits line up vertically without any layout trickery.

Base body text sits at 14px with a tight 1.45 line-height — a deliberate lean toward density over generous reading whitespace. This is not a blog; it's an instrument that wants to show you as much telemetry as it can in the space it has.

## Layout mechanics

- **One card recipe, reused everywhere.** `--bg-1` fill, `1px solid var(--border)`, `8px` radius — metric tiles, stats blocks, operation cards, the report dialog, the export preview pane. Nobody invents a bespoke container; they all reach for the same one.
- **Fluid grids over fixed columns.** Almost every grid in the app (`repeat(auto-fill, minmax(Npx, 1fr))`) reflows on its own — the metric grid, the transform operation cards, the CSV mapping fields, the export format list. There is exactly one explicit breakpoint in the whole system, `@media (max-width: 1100px)`, which collapses the two-column layouts (`stats-columns`, `export-panel`) down to one column and narrows the sidebar. Below that, there's no further mobile adaptation — this is not a responsive product, by design.
- **Buttons press, they don't glow.** The tactile feedback on `:active` is a 1px `translateY` — a physical push-down, not a color flash. It reads mechanical, closer to a real console switch than a soft consumer-app tap state.

## Animation inventory — the whole list

This is genuinely the complete set. There is **no animation library** anywhere in the dependency tree — no Framer Motion, no GSAP, no react-spring. Every motion in the product is a small CSS `@keyframes` block, hand-written directly in `index.css`:

| Keyframe | Where | What it does |
|---|---|---|
| `bob` | `.dropzone-icon` (Import tab) | A gentle 2.4s vertical float on the down-arrow icon — notably, the *only* animation in the entire app that exists purely for delight rather than to communicate state |
| `spin` | `.spinner` | 0.7s linear rotation, the busy indicator |
| `slide` | `.progress-track.indeterminate .progress-fill` | 1.1s sliding highlight sweeping an indeterminate progress bar |
| `toast-in` | `.toast` | 0.25s fade + rise entrance |
| *(implicit transitions)* | buttons, tabs, the dropzone, dataset rows | 0.05–0.2s transitions on `background` / `border-color` / `transform` for hover/active/drag states — short, linear-ish, utilitarian |

That's four named keyframes and a handful of short implicit transitions. No route transitions (there are no routes to transition between), no staggered reveals, no skeleton loaders — busy states use the Spinner/ProgressBar pair instead — and nothing scroll-triggered. Every animation that exists is answering "is something happening right now?" The `bob` on the dropzone is the sole exception, and it's telling that the app allows itself exactly one purely decorative flourish, on the one screen that's effectively an empty-state landing page.

## The libraries actually in use

The dependency list is short on purpose, and the gaps are as intentional as the inclusions:

- **React 19** + **react-dom** — the entire UI framework.
- **Leaflet** + **react-leaflet** — the *only* visualization library anywhere in the app, doing exactly one job: the 2D Map tab's tile basemap and path/point rendering.
- **papaparse** — CSV parsing.

That's the complete list. There is no charting library backing the Charts tab — its multi-channel time-series view is a hand-rolled SVG component, with its own axes, zoom/pan, brushing, and quality-event markers built from scratch. There is no 3D or WebGL library backing the 3D tab either — it's a hand-rolled 2D-canvas perspective/orthographic projector with its own yaw/pitch/zoom math, no three.js, no deck.gl. This isn't an oversight; the project's own forward-looking notes (`futureConsiderations.md`) name deck.gl and Arrow as evaluated-and-deferred, not rejected — there's real groundwork already sitting in the derivation/geometry layers (`src/visualization/scene3d/trajectory.ts`, `src/visualization/charts/`) for whoever picks that thread back up.

## The second system: VectorPunk/HUD (the printable report)

The Project tab's report export doesn't render through the dark app theme at all — `src/core/reports/htmlReport.ts` generates a fully self-contained HTML/CSS document that shares *zero* classes or tokens with the live UI. In-repo, it's nicknamed **VectorPunk/HUD**, and the split is deliberate: the dark workbench is the *instrument*, this light document is the *artifact* the instrument produces for somebody else to read — a briefing, a handoff, a printed page. Different reader, different medium, different rules.

Its own palette, entirely independent of the app's:

| Token | Hex | Role |
|---|---|---|
| `--signal` | `#238f61` | Primary status green |
| `--vector` | `#157c88` | Structural/grid teal-blue |
| `--pulse` | `#b43678` | Rare-emphasis magenta |
| `--alert` | `#a86f15` | Cautions, amber |
| paper background | `#f5f4ed` | Warm off-white page |
| card/paper fill | `#fffef8` | Near-white content surface |

Plus neutral `--ink`/`--muted`/`--line` tokens rounding out the text and rule colors. Not one hex value is shared with the dark app — this is a fully separate design system, not a light-mode variant of the same one.

The texture is where the "HUD" half of the name earns itself: a faint two-axis graph-paper grid at 32px pitch sits behind the content, with a soft radial "signal bloom" glowing in the top-left corner — evocative of a vector-scope readout without literally drawing one. Small clip-path'd, corner-notched badges (`.dataset-index`) stand in for iconography, and a soft-haloed pulsing "signal dot" marks the report header. Typography reuses the same Inter/monospace split as the dark app, but leans much harder into uppercase, wide-tracked monospace section and table headers (`letter-spacing: .12–.16em`) — a military-readout cue that has no equivalent anywhere in the on-screen theme.

Print itself is handled through a dedicated `@media print` block that strips backgrounds, shadows, and gradients back to plain white with only structural borders surviving — the same markup serving two skins, screen and ink, switched purely by media query rather than generating a second document.

## Accessibility and responsiveness, as implemented

- Chart quality-event overlays never rely on color alone — `chart-event-error`/`chart-event-warning`/`chart-event-info` differ by dasharray as well as hue.
- Icon-only interactive controls (dataset remove, bookmark remove, the playback slider) carry `aria-label`s.
- The single 1100px breakpoint is the entire responsive story. JDDC does not attempt a mobile layout — it's a desktop-class tool, reinforced by its own Electron packaging, and doesn't pretend otherwise.
- Scrollbars are custom-styled (`::-webkit-scrollbar`) to match the dark theme rather than left as default OS chrome — a small detail, but one that matters across an interface with this many independently-scrolling regions (dataset list, tab content, log stream, table viewport, dialog body) all visible at once.

---

## Forward-looking commentary — not current state

Everything above this line is documentation of what ships today. Everything below is a proposal — my own read on where this system could go, clearly separated from fact.

If the motion layer were ever revisited, **`framer-motion` or `react-spring`** would be a defensible addition specifically for the two places where state changes are currently binary CSS transitions rather than physically-motivated movement: the toast's entrance/exit (today a fixed 0.25s fade+rise — a spring-based settle would sell "just arrived" better than a linear ease) and the tab-switch underline (today an instant `::after` jump — a spring-driven slide between tab positions would visually connect "you were here, now you're here" in a way an instant cut doesn't). This is explicitly *not* a recommendation to add a general animation library for its own sake — the restraint documented above is a real strength for a data-integrity tool, and most of the app's transitions are correctly minimal as-is. The proposal is narrow: two touch points, motivated by continuity rather than delight.

Similarly, if the Charts or 3D tabs were ever rebuilt from scratch rather than extended, the hand-rolled SVG/canvas approach documented above is a genuinely reasonable place to still land — a library like `visx` (SVG charting primitives without taking over layout) or `deck.gl` (already scoped in the project's own deferred-backlog notes) would only be worth the dependency weight if the derivation/geometry layer needed capabilities the current custom code can't reasonably grow into. That's a real architectural conversation the project has already started having with itself; it isn't one this document is trying to resolve.
