# Phase 1: High-Impact UI Improvements Design
**Date:** 2026-08-01  
**Scope:** Chart system overhaul + data manipulation UX polish  
**Priority:** High-impact fixes for most-used workflows

---

## Overview

The Joint Domain Data Compiler is a sophisticated TSPI workbench with 13 feature-rich tabs. Most user time is spent in **data modification after upload** within visualization and transformation panels. This phase addresses critical usability issues in charts and data manipulation UX, establishing a foundation for Phase 2 (responsive design) and Phase 3 (visual polish).

### Key Problems Addressed
1. **Charts don't match data** — users can select invalid chart types for their data
2. **No legend** — users can't tell what channels/axes represent
3. **Poor data mutation feedback** — transform operations lack preview/before-after info
4. **Scattered UX patterns** — inconsistent feedback, loading states, error handling

---

## Phase 1 Design

### 1. Chart System Improvements

**Current State:**
- `TimeSeriesChart.tsx` renders a time-series chart but doesn't validate data compatibility
- Multiple chart types available, but no validation that selected type matches available channels
- No legend explaining what each visual element represents
- Users can select inapplicable chart types (e.g., time-series when no timestamps exist)

**Solution:**

#### 1.1 Chart Type Validator
- Analyze active dataset: detect available channels, their types (numeric, timestamp, geographic), and data structure
- Define rules for each chart type (e.g., time-series requires timestamps; scatter requires 2+ numeric channels)
- Create `ChartTypeInfo` interface: `{ type, isValid, reason?, minChannels?, requiredChannelType? }`
- Export validator function: `getValidChartTypes(dataset: Dataset): ChartTypeInfo[]`

**Components:** New `src/visualization/charts/validator.ts`

#### 1.2 Dynamic Chart Type Selector
- Replace static chart type buttons with `ChartTypeSelector.tsx` component
- Only display chart types where `isValid === true`
- Show tooltip on disabled types explaining why they're unavailable
- When data changes and previously-selected type becomes invalid, auto-select best remaining type
- Include icons for each type (Material Icons: `timeline`, `scatter_plot`, `area_chart`, etc.)

**Components:** New `src/ui/ChartTypeSelector.tsx`

#### 1.3 Chart Legend
- Add `ChartLegend.tsx` component rendering above/beside the chart
- Display each channel with its visual representation (color, line style, axis assignment)
- Show units where applicable (altitude in feet/meters, speed in knots/kph)
- Include interactive legend: hover/click to highlight/toggle series visibility

**Components:** New `src/ui/ChartLegend.tsx`

#### 1.4 Data Mismatch Detection
- Before rendering, validate that selected chart type matches actual data
- If mismatch detected, show clear warning banner: "This chart type requires [X] but your data has [Y]"
- Provide action button: "Switch to [recommended type]"
- Log mismatch events to console for debugging

**Integration point:** `TimeSeriesChart.tsx` rendering logic

#### 1.5 Smart Chart Defaults
- When active dataset changes or new data is imported, run validator
- If current chart type is no longer valid, auto-select best fit
- Emit toast message: "Data changed. Switched to [new chart type]"

**Integration point:** App.tsx active dataset change handler

---

### 2. Data Manipulation UX Improvements

**Current State:**
- Transform operations (resample, smooth, etc.) execute and succeed/fail but provide minimal feedback
- No preview of what data will change
- Operation history exists (stored in `operationRecords`) but UI doesn't showcase it well
- No keyboard shortcuts for undo/redo
- Form validation is loose; invalid inputs can be submitted

**Solution:**

#### 2.1 Operation Feedback & History
- Enhance `TransformPanel.tsx` to show:
  - **Before/after stats** for each operation (point count, lat/lon/altitude ranges, timestamp span)
  - **Operation history list** showing applied transforms with parameters and results
  - **Revert individual operation** buttons (tie into undo/redo system)
- Create new `OperationHistoryPanel.tsx` component showing applied operations with their parameters, results, and rollback options

**Components affected:** `TransformPanel.tsx`, new `src/ui/OperationHistoryPanel.tsx`

#### 2.2 Transform Preview (Phased)
- For quick operations (e.g., resample), show a preview of affected point count before applying
- For expensive operations (e.g., smoothing), show a "Preview" button that runs on a sample
- Display: "This will reduce 5000 points → 2500 points" or "Altitude range: 1000–5000ft → 1020–4950ft"

**Components affected:** `TransformPanel.tsx`, `NotionalSmoothingPanel.tsx`

#### 2.3 Keyboard Shortcuts
- Undo: `Ctrl+Z` (Cmd+Z on macOS)
- Redo: `Ctrl+Y` or `Ctrl+Shift+Z`
- Implement via `useEffect` listening to `keydown` events in main App component
- Show tooltip in transform panel header: "Ctrl+Z to undo"

**Integration point:** `App.tsx`, `TransformPanel.tsx`

#### 2.4 Form Validation & Error Feedback
- Identify inputs in transform panels (e.g., resample interval, smoothing window size)
- Add client-side validation: required fields, valid numeric ranges, sensible defaults
- Show inline error messages (red text, icon) for invalid inputs
- Disable "Apply" button if validation fails; show reason in tooltip
- On operation error, show error boundary with suggested recovery

**Components affected:** `TransformPanel.tsx`, `NotionalSmoothingPanel.tsx`

#### 2.5 Disabled State Clarity
- Operations that require certain data (e.g., "smooth altitude" when no altitude channel exists) should be disabled
- Disabled operations show tooltip: "Requires [missing channel]"
- Visual indication: greyed out, cursor: not-allowed

**Components affected:** All operation/transform UIs

---

### 3. Visual Polish (Phase 1 Scope)

#### 3.1 Consistent Spacing & Typography
- Audit transform/data manipulation panels for consistent padding, margins, font sizes
- Use design tokens (if available) or establish baseline: 8px grid, 1rem base font, 1.5rem headings
- Apply to: `TransformPanel.tsx`, `NotionalSmoothingPanel.tsx`, new `ChartLegend.tsx`, new `OperationHistoryPanel.tsx`

#### 3.2 Improved Button States
- All buttons show clear hover/focus/active/disabled states
- Disabled buttons show cursor: not-allowed and include explanatory tooltip
- Primary actions (e.g., "Apply Transform") have visual weight
- Use consistent iconography (Material Icons or Lucide)

#### 3.3 Loading States
- Replace generic spinners with contextual feedback:
  - "Building dataset from CSV..." (with progress bar)
  - "Applying transform..." (with operation name)
  - "Processing 10,000 points..." (with percentage)
- Existing `ProgressBar` component in `Spinner.tsx` — extend if needed

#### 3.4 Error Boundaries & Recovery
- Wrap chart rendering in error boundary; if chart fails, show message with fallback options
- Transform operations that fail show error message with "Undo" button
- Toast messages for errors include retry/undo actions where applicable

#### 3.5 Toast Message Enhancements
- After successful transform, show: "Applied [operation name] — [before/after stats]" with "Undo" action
- For errors: "Transform failed: [reason]" with "Retry" or "Undo last change" actions
- Consistent styling and positioning

---

## Architecture & Component Hierarchy

```
App.tsx
├── TimeSeriesChart.tsx (existing)
│   ├── ChartTypeSelector.tsx (new) ← validates available types
│   ├── ChartLegend.tsx (new)       ← shows channel→visual mapping
│   └── [Chart rendering]           ← with mismatch detection
│
├── TransformPanel.tsx (enhanced)
│   ├── [Operation forms] with inline validation
│   ├── OperationHistoryPanel.tsx (new)
│   └── [Before/after stats display]
│
├── NotionalSmoothingPanel.tsx (enhanced)
│   └── Form validation + preview feedback
│
└── [Keyboard shortcut handlers for undo/redo]
```

**New/Modified Files:**
- `src/visualization/charts/validator.ts` (new)
- `src/ui/ChartTypeSelector.tsx` (new)
- `src/ui/ChartLegend.tsx` (new)
- `src/ui/OperationHistoryPanel.tsx` (new)
- `src/ui/TimeSeriesChart.tsx` (enhanced)
- `src/ui/TransformPanel.tsx` (enhanced)
- `src/ui/NotionalSmoothingPanel.tsx` (enhanced)
- `src/App.tsx` (keyboard shortcuts, toast actions)

---

## Success Criteria

- ✅ Chart type selector only shows types valid for active dataset's data structure
- ✅ All charts display a legend explaining channels, axes, and units
- ✅ Data mismatch detection prevents rendering invalid chart configurations
- ✅ Transform operations show before/after statistics
- ✅ Operation history is visible and operations can be reverted
- ✅ Undo/redo work with Ctrl+Z / Ctrl+Y keyboard shortcuts
- ✅ Transform forms validate inputs before apply; invalid inputs disable button with tooltip
- ✅ Disabled operations show clear reason in tooltip
- ✅ All button states (hover, focus, active, disabled) are visually distinct
- ✅ Error messages are actionable and include recovery options
- ✅ Toast messages summarize operations and include undo action

---

## Known Constraints & Decisions

1. **Chart types supported:** Start with time-series, scatter, area. Add bar/histogram in Phase 3 if data supports it.
2. **Legend positioning:** Place above chart by default; make repositionable via workspace state if time permits.
3. **Preview scope:** Implement full before/after stats for all operations; expensive preview runs (sampling) as nice-to-have for Phase 1b.
4. **Keyboard shortcuts:** Ctrl+Z/Y on Windows/Linux; Cmd+Z/Y on macOS (handled by `useKeyboardShortcut` hook or similar).
5. **Responsive design:** Phase 1 focuses on functionality; Phase 2 will handle mobile/tablet layouts.

---

## Phase 1 Deliverables

1. Chart validation system with dynamic type selector
2. Chart legend component
3. Transform operation preview & history UI
4. Keyboard shortcuts for undo/redo
5. Form validation & error handling in data mutation panels
6. Toast message enhancements with actions
7. Visual polish: spacing, button states, loading/error feedback

---

## Next Phases (Preview)

**Phase 2:** Responsive design across all tabs (sidebar collapse, tab bar scrolling, panel layouts on mobile)  
**Phase 3:** Maps & 3D visualization polish, general UI consistency, additional chart types

