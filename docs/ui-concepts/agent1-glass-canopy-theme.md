# JDDC Glass Canopy Reference — Phosphor, Symbology & Motion

The instrument styling described here is what actually ships in `src/index.css` / `src/analysis.css` (cockpit glass) and `src/core/reports/htmlReport.ts` (the printed debrief card), read through avionics-symbology conventions rather than restated as generic web-design tokens. Every hex value below is the real, current value — nothing in this document is a repaint. Where the avionics framing suggests something the codebase does *not* currently do, it is called out explicitly as a proposal in §7, never folded in as if it already exists.

## 1. Lighting doctrine: one mode, tuned for night ops

The suite ships with exactly one lighting mode for its own glass — dark, tuned for a low-ambient operations room, the same reasoning that puts most tactical MFDs and ops-center consoles in a dark theme by default rather than a bright office one. There is no day/bright variant of the cockpit glass itself; the only bright surface the suite produces is the printed debrief card described in §6, which is a deliberately separate artifact for a deliberately separate reading context (paper/PDF handed to someone outside the cockpit), not a "light mode toggle" for the live UI.

There is no design-system dependency underneath any of this — no Tailwind, no CSS-in-JS runtime, no component-library theme layer. It's one hand-authored stylesheet, which matters for a suite that has to run fully offline in its Electron rig: no remote font or CDN `@import` anywhere in the build.

## 2. Phosphor table — the cockpit glass palette

| Token | Hex | Symbology role |
|---|---|---|
| `--bg` | `#0b0f17` | Outer glass, CAS message queue, scrollbar track — the darkest surface in the cockpit |
| `--bg-1` | `#111725` | Track library column, page cards, page-select bezel |
| `--bg-2` | `#161e2e` | Active page face, designated-track row fill |
| `--bg-3` | `#1d2738` | Bezel keys at rest, chip-on fill, table stripe |
| `--border` | `#25324a` | Standard hairline between instruments |
| `--border-bright` | `#33425f` | Hover/emphasis edge |
| `--text` | `#e6edf6` | Primary readout text |
| `--text-dim` | `#9fb0c8` | Secondary labels |
| `--text-faint` | `#65758f` | Tertiary/metadata caption text |
| `--accent` | `#ea4f2f` | **Designate/select phosphor** — burnt orange |
| `--accent-2` | `#0f8c6f` | **EXEC/commit phosphor** — teal-green |
| `--blue` | `#3b82f6` | Info-level CAS tag |
| `--green` | `#16a34a` | Nominal/valid state, start-of-track mark |
| `--amber` | `#eab308` | Caution — warnings, range designation, fault gaps |
| `--red` | `#ef4444` | Warning — hard errors, coordinate jumps, end-of-track mark |
| `--purple` | `#a855f7` | CAS category tag; companion-track color on the 3D page |
| `--mono` | `ui-monospace, "SF Mono", "JetBrains Mono", "Fira Code", Menlo, monospace` | All numeric/data/log/code readouts |
| `--sans` | `"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | All chrome/label text |
| `--radius` | `8px` | Standard card/dialog corner |
| `--shadow` | `0 8px 30px rgba(0,0,0,.35)` | Elevation under the master-caution flash and the one dialog |

### The two-phosphor rule

This is the load-bearing convention of the whole glass, and it maps directly onto a distinction every glass-cockpit and FMC actually makes: **designate vs. execute.**

**Orange (`--accent`, `#ea4f2f`) is the designate/select phosphor** — the color of "you have pointed at something, or you are about to begin." It lights the `[LOAD TRACK]` key, the active bezel key's underline, the active track-library row's border, the designated-point mark on TSD and 3D, and the brand roundel. It is the visual language of a line-select key or a cursor-slew designation: pick a thing, point at it, begin an action.

**Teal (`--accent-2`, `#0f8c6f`) is the EXEC/commit phosphor** — reserved *exclusively* for the two keys in the whole suite that actually produce committed output: **Build dataset** on XLATE and **Export** on XPORT. This is the FMC-EXEC convention: on a real flight-management CDU, you can enter and re-enter a modification all day in a neutral color, but the EXEC light only comes on when there's a valid, buildable state to commit, and pressing it is the one action that turns a proposal into a real, downstream-consequential result. Nowhere else in the suite uses either phosphor — every other bezel key and control is neutral (`--bg-3` fill, `--border-bright` edge). If you're extending the UI and reaching for orange or teal for anything other than "begin/designate" or "commit/build," that's the tell you've mis-mapped the action.

Semantic caution/warning colors (`green`/`amber`/`red`) are held to data-quality meaning only — valid/caution/fault, start/gap/jump marks — and never repurposed as generic UI accent. An operator has to be able to trust that amber or red anywhere on the glass means "a data condition needs your attention," never "this button is dangerous to press." Destructive controls (the track-library strike `×`, recipe delete) instead stay neutral in fill and only tint their *label* red — the chrome doesn't cry wolf.

## 3. Type — one label face, one data face

Two stacks, no third "display" face for headings: **Inter** for every piece of chrome — labels, keys, prose, section headers, all just bold Inter at a larger size — and the system monospace stack for anything that is *data*: coordinates, timestamps, checksums, CAS log lines, table cells, readout tiles, code. This split is enforced everywhere (`.mono` utility, `font-variant-numeric: tabular-nums` so numeric columns stay vertically aligned like a real digital readout column). Base body text runs small (14px, 1.45 line-height) — density over whitespace, the correct trade for an instrument panel where the job is to fit a lot of live parameters in front of one operator, not to read comfortably like a document.

## 4. Panel construction

- **Cards** — one recipe, reused without exception: `--bg-1` fill, `1px solid var(--border)`, `8px` radius. Readout tiles, stats blocks, MX operation cards, the one dialog, and the XPORT preview pane all share this exact recipe rather than each getting bespoke framing — one instrument-bezel casing style for the whole cockpit.
- **Grids** — `repeat(auto-fill, minmax(Npx, 1fr))` almost everywhere a page needs to lay out repeating instruments (readout tiles, MX operation cards, XLATE fields, XPORT format placards), so pages reflow without hand-tuned breakpoints. The single explicit breakpoint (`max-width: 1100px`) collapses the STATUS two-column readout and the XPORT two-column layout down to one column and narrows the track library column — the only concession to a smaller display in the whole suite.
- **Key-press feedback** — bezel keys and buttons give a 1px `translateY` press-down on `:active` rather than a color flash. Feedback is mechanical/tactile, the way a real bezel key gives you a physical click rather than a screen glow.

## 5. Motion inventory — every animation that exists, and nothing invented

The suite runs no animation library at all (no Framer Motion, no GSAP, no spring physics) — every bit of motion is a small, purpose-built CSS `@keyframes` block authored directly in `index.css`. This is the complete list; there is nothing beyond it:

| Keyframe | Where | Reads as |
|---|---|---|
| `bob` | `.dropzone-icon` on IMPORT | A slow 2.4s vertical float on the down-arrow — the one animation in the suite that exists purely for feel rather than to report a state, the cockpit's single "welcome aboard" flourish |
| `spin` | `.spinner` | 0.7s linear rotation — the busy annunciation that bumps the track counter off the status bar during a blocking op |
| `slide` | `.progress-track.indeterminate .progress-fill` | 1.1s sliding highlight — indeterminate progress on long-running, not-yet-quantifiable jobs |
| `toast-in` | `.toast` (master caution flash) | 0.25s fade+rise entrance |
| *(short transitions, uncataloged)* | keys, bezel, dropzone, track-library rows | 0.05–0.2s background/border/transform transitions on hover, active, and drag states — utilitarian, no easing flourish |

No page transitions (there are no routes to transition between), no stagger, no skeleton loaders — the spinner-plus-progress-strip pattern covers that job instead — and no scroll-triggered effects anywhere. Motion exists strictly to annunciate a state (busy, dragging, progressing, just-committed) and stops there, which is the correct restraint for an instrument whose subject is flight-telemetry fidelity, not its own chrome.

## 6. The debrief card — a separate rig entirely

`src/core/reports/htmlReport.ts` produces the printed/PDF debrief card raised from the MSN page's dialog. It shares **zero** CSS tokens with the cockpit glass — a deliberate second visual system, in-repo nicknamed **"VectorPunk/HUD,"** built for the completely different job of leaving the cockpit as paper or PDF for someone who never sat in the seat:

- **Palette** — warm paper (`#f5f4ed` background, `#fffef8` card fill) instead of glass-black, with its own accent quartet: `--signal: #238f61` (green, primary status), `--vector: #157c88` (teal-blue, structural/grid lines), `--pulse: #b43678` (magenta, rare emphasis), `--alert: #a86f15` (amber, cautions), plus dedicated `--ink`/`--muted`/`--line` neutrals. Not one hex value is shared with the cockpit-glass table in §2 — this is intentionally a fully independent rig, not a light-mode recolor of the dark one.
- **Background texture** — a faint two-axis graph-paper grid (hairlines on a 32px pitch) plus a soft radial "signal bloom" bleeding in from the top-left corner, evoking a vector-scope/HUD readout without literally drawing one.
- **Geometric identity marks** — small clip-path'd, corner-chamfered badges standing in for iconography, plus a soft-pulsing "signal dot" with its own halo — the debrief card's version of a HUD reticle, present only here.
- **Type** — the same Inter-prose/monospace-data split as the cockpit glass, but leaning harder into uppercase, wide-tracked monospace section and table headers (`.12–.16em` letter-spacing) — a HUD-readout cue this document's cockpit glass never uses on-screen.
- **Print behavior** — a dedicated `@media print` block strips backgrounds, shadows, and gradients back to plain white with only structural borders retained. The on-screen version is the "briefing room" skin; print is the "ink-economical" skin of the identical markup, switched purely by media query rather than generating two documents.

Treat the cockpit glass and the debrief card as two permanently separate systems: the dark glass is the instrument the operator flies the mission with; the light debrief card is the artifact the instrument hands to someone standing outside the cockpit. Different audience, different medium (screen vs. paper), and the CSS is split into two non-overlapping files for exactly that reason — there is no shared theme layer to keep in sync.

## 7. Proposed enhancement — NVG-safe low-luminance mode (not implemented)

**Everything above this line is current, shipped behavior. Everything in this section is a proposal only — none of it exists in the codebase today.**

The cockpit glass's single dark mode is well-suited to a lit ops room but is not what real night-vision-goggle-compatible avionics do: NVG-safe cockpits run a low-luminance, narrow-spectrum scheme (commonly deep amber or deep green monochrome, luminance clamped well below normal night-mode dark themes) so the display doesn't bloom or wash out an intensified image. A plausible extension worth scoping — *not* built, *not* scheduled — would be a third lighting mode alongside the current glass:

- A single low-luminance monochrome phosphor (e.g., a clamped deep-green or deep-amber family) substituting for the full `--accent`/`--accent-2`/`--green`/`--amber`/`--red`/`--purple`/`--blue` set, preserving the same designate-vs-EXEC *shape* distinction (still two visually distinct "designate" and "commit" states) but collapsed to luminance/pattern differences rather than hue, since hue discrimination is exactly what degrades under intensified low-light viewing.
- Fault-flag redundancy (already dash/pattern-coded today per §8 of the layout reference's source material, not just color-coded) would carry even more weight in this mode, since color alone would no longer reliably separate caution from fault under a single-phosphor palette.
- This would be additive — a selectable third mode, not a replacement for the current dark glass — and would need its own pass through every quality-event/legend/marker surface in TSD, TREND, DATA, and 3D before it could be called complete.

Flagging this here because the avionics framing surfaces it naturally, not because it's on any roadmap; treat it strictly as a "if someone wants to take this further" note, not a description of current capability.
