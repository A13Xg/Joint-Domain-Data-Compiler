# Independent review of the 3 creative-divergence agent doc sets

A final pass over all six agent-produced files in this folder, checked line-by-line against the actual source (`src/App.tsx`, `src/ui/*`, `src/index.css`, `src/core/reports/htmlReport.ts`) and against the ground-truth docs in `../ui/`. Goal: catch any invented feature, wrong value, or fact presented as current when it isn't.

## Agent1 (glass-canopy)

None found. `agent1-glass-canopy-layout.md` and `agent1-glass-canopy-theme.md` were checked against the real tab list/enablement rules, the real color tokens, the real four-keyframe animation set, and the real library list — all accurate, and the one proposed addition (§7, NVG low-luminance mode) is clearly and repeatedly marked as not implemented.

One cosmetic nit, not a factual error: the theme doc's §7 cites "§8 of the layout reference's source material" for the color+pattern quality-flag redundancy claim. That claim is true and does trace back to a real §8 ("Accessibility & responsiveness notes") — but in `docs/ui/UI_STYLE_THEME.md`, not the layout doc, and neither of Agent1's own two documents has 8 numbered sections. The cross-reference is just pointed at the wrong document name; the underlying fact is correct. Not worth a fix, just noting it.

## Agent2 (flight-deck)

None found. `agent2-flight-deck-layout.md` and `agent2-flight-deck-theme.md` were checked in full — all 13 tabs, enablement rules, color hex values, the two-accent rule, the four real keyframes, and the three real dependencies (React 19, Leaflet/react-leaflet, papaparse) are all stated correctly. The closing "Forward-looking commentary" section (proposing framer-motion/react-spring and visx/deck.gl) is explicitly and unambiguously separated from the current-state documentation above it.

## Agent3 (phosphor-readout)

One real factual error, one minor fabricated example detail:

1. **Wrong expansion of the GPB format**, in `agent3-phosphor-readout-layout.md`, Export tab section (the format-card ASCII block): GPB is labeled "Protocol Buffers." That's incorrect — in this codebase GPB is JDDC's own **"Geo Point Binary"** compact numeric container (`src/core/parsers/gpb.ts`, magic header `"GPB1"`), unrelated to Google's Protocol Buffers serialization format. This is stated as plain fact (not flagged speculative), so it should be corrected to something like "compact JDDC binary container" if this file is kept as reference material.
2. **A "Last saved: 2024-06-15 14:22:00" line** in the Project tab ASCII mockup (same file) doesn't correspond to anything in the real `ProjectPanel.tsx` — there is no last-saved timestamp displayed anywhere in that panel today (only a dirty/"Unsaved changes" badge). Minor, since it reads as illustrative example data inside a mockup rather than an assertion of a real feature, but worth knowing if anyone treats the ASCII mockups as pixel-accurate.

`agent3-phosphor-readout-theme.md` was checked in full separately and is fully accurate: correct hex values, correct four-keyframe list, correct library list, and the CRT-easter-egg section is clearly bracketed as speculative in three separate places.

## Baseline docs note (not agent-caused)

While re-verifying the Project tab against the live `ProjectPanel.tsx` to check the "Last saved" claim above, found that `docs/ui/UI_LAYOUT.md`'s own Project-tab section had omitted two real features that exist in the code: the **"Export manifest only"** action and the **Diagnostics / "Export diagnostic bundle"** section (optional note + bundle export, excluding raw points and KML/KMZ library files). Since all three agents were briefed to trust that document rather than re-audit the codebase, this gap is why none of the six files mention those two controls either — it originated in the ground truth, not in any agent's work. Already corrected directly in `docs/ui/UI_LAYOUT.md`; no other gaps of this kind turned up elsewhere in that document during this pass.
