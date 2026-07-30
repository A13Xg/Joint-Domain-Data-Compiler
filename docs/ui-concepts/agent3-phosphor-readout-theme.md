┌──────────────────────────────────────────────────────────────────────────┐
│  JDDC COLOR TELEMETRY & MOTION PROFILE                                   │
│  "Phosphor Readout" Documentation Set — Visual System & Theme             │
│  [STATUS] Dark engineering theme + separate light print overlay.         │
└──────────────────────────────────────────────────────────────────────────┘

Live application visual identity sourced from `src/index.css` and
`src/analysis.css` (hand-authored, zero design-system dependency).
Printed report export identity sourced from `src/core/reports/htmlReport.ts`
(independent light theme, deliberately different).

No Tailwind. No CSS-in-JS. No component library. No remote font/CDN imports
(offline-first Electron constraint). One dependency-free stylesheet,
entirely self-contained.

═══════════════════════════════════════════════════════════════════════════

█ DESIGN PHILOSOPHY

"Dark technical theme tuned for data engineers." Borrowed from engineering/ops
tooling (dark IDE themes, log consoles, telemetry dashboards) rather than
consumer SaaS. Maxims:

  — High information density. Monospace-forward for anything numeric.
  — Minimal chrome. No illustration, no marketing gradients (except 2 small
    brand uses).
  — Every color has semantic job; almost nothing decorative.
  — Appropriately restrained motion (state-signaling only; data fidelity
    is the point).

═══════════════════════════════════════════════════════════════════════════

█ TOKEN MANIFEST (`:root` CSS custom properties)

BACKGROUND PALETTE:
  --bg              #0b0f17    Outermost bg, log dock, scrollbar track
  --bg-1            #111725    Sidebar, panel/card fills, tab bar
  --bg-2            #161e2e    Tab content area, active dataset row fill
  --bg-3            #1d2738    Button fills, chip-on state, table stripe

BORDERS & STRUCTURE:
  --border          #25324a    Default hairline border
  --border-bright   #33425f    Hover/emphasis border

TEXT (foreground/legibility):
  --text            #e6edf6    Primary text (body, labels, headings)
  --text-dim        #9fb0c8    Secondary text (hints, metadata)
  --text-faint      #65758f    Tertiary/metadata (timestamps, checksums)

╔═══════════════════════════════════════════════════════════════════════════╗
║  THE TWO-ACCENT RULE — SINGLE MOST IMPORTANT CONVENTION                  ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                           ║
║  ORANGE / "START-SELECT"                                                 ║
║  --accent                #ea4f2f                                         ║
║  (burnt orange / red-orange phosphor, reminiscent of 1980s scope)        ║
║                                                                           ║
║  Used on:                                                                ║
║    ✓ Sidebar "+ Load data" button (primary entry point)                 ║
║    ✓ Active tab underline (2px accent bar)                              ║
║    ✓ Active dataset-item border + fill                                  ║
║    ✓ Selected-point marker on Map/3D                                    ║
║    ✓ App brand mark gradient                                            ║
║    ✓ Any "start / initiate / select" primary action                     ║
║                                                                           ║
║  TEAL / "COMMIT-BUILD-FINALIZE"                                          ║
║  --accent-2               #0f8c6f                                         ║
║  (teal-green, signal-processing accent)                                  ║
║                                                                           ║
║  Used on:                                                                ║
║    ✓ CSV "Build dataset" button (finalize input)                        ║
║    ✓ "Export" button (produce committed output)                         ║
║    ✓ Any "commit / finalize / build" action                             ║
║    ✗ NO OTHER BUTTONS USE EITHER ACCENT                                 ║
║                                                                           ║
║  All default buttons: neutral --bg-3 fill + --border-bright outline.    ║
║                                                                           ║
║  Semantic rule for engineers: if accent appears, user is *acting*.      ║
║  Orange = "I'm choosing something now." Teal = "I'm committing now."   ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝

SEMANTIC COLORS (quality signals, never generic UI accents):
  --blue              #3b82f6    Info-level log badge / informational tag
  --green             #16a34a    Success states, start-of-track marker (O)
  --amber             #eab308    Warnings, selection-range highlight,
                                  quality gaps, cautionary overlays
  --red               #ef4444    Errors, coordinate jumps, end-of-track
                                  marker (●), data-quality failures
  --purple            #a855f7    Log category tags, companion-track color
                                  in 3D scene (fixed color for secondary
                                  datasets)

TEXT STACKS (font families):
  --mono    ui-monospace, "SF Mono", "JetBrains Mono", "Fira Code", Menlo,
            monospace
            ↑ All numeric/data/log/code text. Tabular-nums enabled.
            Tight letter-spacing, fixed-width. Scanline-ready.

  --sans    "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif
            ↑ All UI chrome text (labels, buttons, headings, prose).
            Headings: just bold Inter at larger size, no display face.

LAYOUT TOKENS:
  --radius            8px        Standard card/dialog corner radius
  --shadow            0 8px 30px rgba(0,0,0,.35)  Toast/dialog elevation

BASE TYPOGRAPHY:
  Body size: 14px, line-height 1.45 (tight, density-biased)
  Utility class: `.mono` forces monospace on any element
  Numeric columns: `font-variant-numeric: tabular-nums` for alignment

═══════════════════════════════════════════════════════════════════════════

█ COMPONENT RECIPES (reused everywhere)

CARDS / PANELS (one recipe, infinite applications):
  Background:  var(--bg-1)
  Border:      1px solid var(--border)
  Corners:     var(--radius) (8px, `border-radius`)
  Shadow:      (none in cards; shadow only on toast/dialog)
  Padding:     1rem–1.5rem (context-dependent)

Used identically for:
  — Metric tiles in Overview
  — Operation cards in Transform
  — Export preview pane
  — Mapping field group
  — Stats blocks, dialogs, etc.

GRIDS (responsive without breakpoints):
  Syntax: `repeat(auto-fill, minmax(Npx, 1fr))`
  Used on:
    — Metric grid (minmax 150px): reflows 8→4→2 columns by viewport
    — Transform op grid (minmax 280px): reflows 3→2→1 column
    — Mapping fields (minmax 220px): inline-form columns
    — Export format list (minmax 160px): card grid

  One explicit @media breakpoint at 1100px (collapse 2-col to 1-col,
  narrow sidebar). Below that: no further mobile layout—JDDC is
  desktop-class tool (Electron app), not responsive product.

BUTTONS (tactile mechanical affordance):
  Active state: `transform: translateY(1px)` (press-down, not color-shift)
  Hover: color `transition: 0.1s` smooth
  No box-shadow, no skew, no soft shadows.

═══════════════════════════════════════════════════════════════════════════

█ ANIMATION INVENTORY (minimal, purposeful)

**NO animation library.** No Framer Motion, no GSAP, no react-spring.
All motion hand-authored in `index.css` as CSS `@keyframes`.

┌────────────────────────────────────────────────────────────────┐
│ KEYFRAME                 ELEMENT(S)            EFFECT          │
├────────────────────────────────────────────────────────────────┤
│ @keyframes bob           .dropzone-icon        Gentle 2.4s     │
│                                                vertical float  │
│                                                (Import tab only│
│                                                — purely        │
│                                                delightful,     │
│                                                non-functional) │
│                                                                │
│ @keyframes spin          .spinner              0.7s linear     │
│                                                rotation        │
│                                                (busy indicator)│
│                                                                │
│ @keyframes slide         .progress-track       1.1s sliding    │
│                          .indeterminate        highlight for   │
│                          .progress-fill        indeterminate   │
│                                                progress bar    │
│                                                                │
│ @keyframes toast-in      .toast                0.25s fade +    │
│                                                rise entrance   │
│                                                (notification   │
│                                                appear)         │
│                                                                │
│ (implicit transitions)   buttons, tabs,        0.05–0.2s on    │
│                          dropzone, dataset     `background`/   │
│                          rows                  `border-color`/ │
│                                                `transform`     │
│                                                (hover/active   │
│                                                states)         │
│                                                No easing       │
│                                                exotica, all    │
│                                                utilitarian.    │
└────────────────────────────────────────────────────────────────┘

What is **NOT** animated (by design):
  ✗ Page/route transitions (no routes exist)
  ✗ Stagger animations
  ✗ Skeleton loaders (Spinner + ProgressBar pattern used instead)
  ✗ Scroll-triggered effects
  ✗ Parallax or long-running ambiance loops

Animation serves only to communicate state (busy, dragging, progressing,
just-happened). Appropriate restraint for a tool where flight telemetry
fidelity is the point, not the visual spectacle.

═══════════════════════════════════════════════════════════════════════════

█ JS/RENDERING LIBRARY MANIFEST

**Minimal dependencies by design.** Live app libraries (from `package.json`):

  REQUIRED:
    React 19 + react-dom
      ↑ Only UI framework. Modern JSX, hooks, Suspense.

  VISUALIZATION:
    Leaflet + react-leaflet
      ↑ ONLY visualization library in entire app.
      ↑ Used solely for 2D Map tab (tile basemap + path/point rendering).

  DATA:
    papaparse
      ↑ CSV parsing (parsing only, not serialization).

  **NOTABLY ABSENT, ON PURPOSE:**

    ✗ No charting library
      → Multi-channel time-series chart is **hand-rolled SVG component**.
      → Axes, zoom/pan, brushing, quality-event markers all custom-coded.
      → See `src/visualization/charts/` for implementation.

    ✗ No 3D/WebGL library
      → Trajectory 3D viewer is **hand-rolled 2D Canvas**
      → Custom perspective/orthographic projector.
      → Matrix-free yaw/pitch/zoom math, not three.js/deck.gl.
      → See `src/visualization/scene3d/trajectory.ts` for implementation.

This is deliberate tradeoff (not oversight). `futureConsiderations.md` notes
deck.gl/Arrow evaluation as deferred backlog. Anyone extending viz layer
should know these are greenfield decisions with existing prior art in
codebase geometry layers.

═══════════════════════════════════════════════════════════════════════════

█ SEMANTIC SIGNAL RULES (how to read color)

A user should trust that:

  AMBER/RED anywhere = "Look at this data problem"
    — never "this button is destructive" (buttons use plain styling + red label)
    — never generic emphasis (use orange for that)
    — always: quality failure, gap, warning, coordinate jump

  ORANGE button = "I'm starting/selecting/picking something now"
    — Load data, tab click, dataset activation, selected marker
    — Never: cautionary or secondary action

  TEAL button = "I'm finalizing output now"
    — Build dataset, Export
    — Rare. Only on high-commitment actions.

  BLUE badge = "Informational log message" (log console only)

  GREEN marker = "Valid/start state" (track start marker, success icon)

  PURPLE = "Companion dataset" (3D scene, log category tag—fixed role)

═══════════════════════════════════════════════════════════════════════════

█ PRINT EXPORT THEME: "VECTORPUNK/HUD"

Report HTML generated by `src/core/reports/htmlReport.ts` uses
**completely separate** light visual system (intentional non-shared design).

NOT a reskin of dark app theme. Distinct system for print/PDF:

PALETTE (ink-economical warm paper background):
  --signal      #238f61    Green, primary status (success, valid)
  --vector      #157c88    Teal, structural/grid lines, accent
  --pulse       #b43678    Magenta, rare emphasis (caution calls)
  --alert       #a86f15    Amber, warnings + cautions
  --ink         #2a1810    Text (warm brown, not pure black)
  --muted       #7a6f68    Secondary text, borders
  --line        #e8e3d8    Grid lines, dividers

  Background paper:  #f5f4ed (warm, off-white)
  Card fill:         #fffef8 (cream, nearly white)

**Nothing shares hex value with dark app theme.** Fully independent.

BACKGROUND TEXTURE:
  — Faint two-axis graph-paper grid (linear-gradient hairlines, 32px pitch)
    — Evoking vector-scope / lab graph paper
  — Soft radial "signal bloom" in top-left corner (radial-gradient soft)
    — Evoking radar/scope readout glow, no literal rendering

GEOMETRIC IDENTITY (icons + badges):
  .dataset-index badge:
    clip-path: polygon(...) → hex/chamfered corner-notch effect
    (instead of circular icons, use small notched squares)

  .report-header::after "signal dot":
    Small pulsing dot with soft box-shadow halo
    (animated pulse, echoes "data is live")

TYPOGRAPHY (HUD-specific):
  — Same Inter-for-prose / monospace-for-data split as live app
  — **BUT:** uppercase, wide-tracked monospace labels for section headers
    & table headers
    `letter-spacing: .12–.16em` (0.12–0.16 em)
    → Evoking military readout / HUD / scope labels
    → Does NOT appear anywhere in dark on-screen theme

PRINT BEHAVIOR:
  Dedicated `@media print` block:
    — Strips backgrounds, shadows, gradients back to plain white
    — Keeps only structural borders
    — Screen = "display" skin (color, glow, bloom)
    — Print = "ink-economical" skin (same markup, stripped by media query)

SEPARATE FILES:
  Generated entirely in `htmlReport.ts` (no shared classes/tokens with
  live app). CSS inlined in generated HTML (no external stylesheet),
  fully self-contained for portability.

═══════════════════════════════════════════════════════════════════════════

█ ACCESSIBILITY & RESPONSIVE NOTES

Color strategy:
  — Chart quality-event overlays use BOTH color AND pattern (dash/dash-array)
    → not color-alone (colorblind-safe)
  — Interactive icon-only controls carry `aria-label` attributes
    → dataset remove, bookmark remove, playback scrub slider

Responsive breakpoint (single @media):
  @media (max-width: 1100px):
    — Collapse two-column grids (stats-columns, export-panel) to one
    — Narrow sidebar from 256px to 210px
  Below 1100px: no further mobile-specific layout.
  JDDC is explicitly desktop-class tool (reinforced by Electron packaging),
  not responsive/mobile product.

Custom scrollbars:
  ::-webkit-scrollbar styled to match dark theme (#0b0f17 track,
  #25324a thumb) rather than left as default OS chrome.
  Reinforces "cohesive instrument panel" feel across many independently-
  scrolling regions (dataset list, tab content, log stream, table viewport,
  dialog body).

═══════════════════════════════════════════════════════════════════════════

█ SPECULATIVE "CRT EASTER EGG MODE" (NOT CURRENTLY IMPLEMENTED)

[SPECULATIVE CONCEPT — NOT A REAL FEATURE OF JDDC]

If a future implementation wanted to add a retro "phosphor scope" mode,
consider:

  — Scanline effect overlay (CSS `repeating-linear-gradient` 1–2px
    horizontal lines, low opacity, blended mode `overlay`)

  — Monochrome palette swap: orange → green phosphor (#0f0), text → dim green
    gradient, all semantics preserved but rendered in classic 1980s amber/green

  — CRT blur filter: `filter: blur(0.5px)` + `text-shadow` to simulate
    phosphor glow

  — Subtle vignette: `radial-gradient` dark corners (noir studio lighting)

  — Keystroke "click" sound library (optional, user-toggleable, respect OS
    a11y settings)

  — Frame-rate limiter (60 FPS target, or configurable 30/50/120 FPS for
    retro feel)

This is **not** current JDDC behavior. These are conceptual elements that
could thematically *support* this documentation's "phosphor readout" framing
if added in future. The real app is the dark theme documented above.

[END SPECULATIVE CONCEPT]

═══════════════════════════════════════════════════════════════════════════

█ SUMMARY

LIVE APP (dark theme):
  — One hand-authored stylesheet, zero design-system dependencies
  — Burnt orange + teal two-accent rule (start vs. commit)
  — Monospace-forward, 14px body, tight 1.45 line-height (density-biased)
  — Four reusable motion primitives (bob, spin, slide, toast-in)
  — React 19 + Leaflet only (hand-rolled SVG charts, Canvas 3D)
  — High-contrast semantic color palette (green/amber/red for data quality)
  — Tactile affordances (press-down buttons, underline tabs)
  — No animation library, no stagger, no easing exotica

PRINT EXPORT (light theme):
  — Independent "VectorPunk/HUD" system in htmlReport.ts
  — Warm paper + signal-green/teal/magenta accent quartet
  — Graph-paper grid + signal bloom texture
  — Uppercase, wide-tracked monospace labels (HUD cue)
  — Media-query @print strips color for ink economy
  — Fully self-contained HTML (no external assets)

TWO-ACCENT RULE: orange="start/select," teal="commit/build." Everything else
flows from that single principle.

The workbench looks like an 1980s command-center readout because it *is*
one: dense, purposeful, built for focused data work at a single screen,
not for scrolling or discovery. Color is signal. Motion is functional.
Typography prioritizes data over prose. The theme serves the tool, not vice
versa.

┌──────────────────────────────────────────────────────────────────────────┐
│ TELEMETRY CLOSED                                                        │
│ Visual system fully documented. Color tokens verified. Motion inventory  │
│ catalogued. Library manifest logged. Both themes (live + export)         │
│ described in full.                                                       │
│                                                                          │
│ JDDC UI is one coherent instrument. Dark workbench + light report.      │
│ No chrome minimalism, all context, all the time. Appropriate for an     │
│ engineering tool where data fidelity and cross-cutting visibility are   │
│ more valuable than screen real estate.                                  │
└──────────────────────────────────────────────────────────────────────────┘
