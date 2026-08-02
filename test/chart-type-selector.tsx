// Verifies ChartTypeSelector renders one button per chart type, disabling
// types that are invalid for the current dataset (per validator.ts) with the
// validator's reason surfaced as a tooltip, highlighting the current type,
// and notifying the parent via onSelectType only for valid clicks.
import { parseHTML } from 'linkedom'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { Dataset } from '../src/core/model.ts'
import { ChartTypeSelector } from '../src/ui/ChartTypeSelector.tsx'

// react-dom needs a browser-like `document`/`window` before it can mount into
// a container. parseHTML gives us a minimal one for this Node test process
// only; production always renders against a real browser DOM. react-dom's
// own module init doesn't touch these eagerly, so setting them up after the
// imports above (but before the first render() call) is safe.
const { window } = parseHTML('<!doctype html><html><body></body></html>')
;(globalThis as unknown as { window: unknown }).window = window
;(globalThis as unknown as { document: unknown }).document = window.document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
;(globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number
;(globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) =>
  clearTimeout(id as unknown as ReturnType<typeof setTimeout>)

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

// Timestamped points with only `ele` numeric data: timeSeries and area are
// valid (both need timestamps, which this dataset has), scatter is not
// (needs 2+ numeric channels; this dataset only has 1: elevation).
const mixedDataset: Dataset = {
  id: 'mixed',
  name: 'Mixed',
  sourceFormat: 'csv',
  warnings: [],
  channels: [],
  createdAt: Date.now(),
  points: [
    { lat: 0, lon: 0, ele: 100, time: 1000 },
    { lat: 1, lon: 1, ele: 200, time: 2000 },
  ],
}

function renderSelector(dataset: Dataset, currentType: string, onSelectType: (type: string) => void) {
  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  const root = createRoot(container as unknown as Element)
  flushSync(() => {
    root.render(<ChartTypeSelector dataset={dataset} currentType={currentType} onSelectType={onSelectType} />)
  })
  return container
}

// --- Scenario 1: mixed validity, currentType = 'timeSeries' ---
const selections: string[] = []
const container = renderSelector(mixedDataset, 'timeSeries', (type) => selections.push(type))
const buttons = Array.from(container.querySelectorAll('button')) as unknown as HTMLButtonElement[]

check('renders one button per chart type', buttons.length === 3)

const [timeSeriesBtn, scatterBtn, areaBtn] = buttons

check('timeSeries button is enabled (dataset has timestamps)', timeSeriesBtn?.disabled === false)
check('timeSeries button is marked active (matches currentType)', timeSeriesBtn?.classList.contains('active') === true)
check('timeSeries button has a non-empty aria-label', !!timeSeriesBtn?.getAttribute('aria-label'))
check('timeSeries button has no title tooltip (it is valid)', timeSeriesBtn?.getAttribute('title') === null)

check('scatter button is disabled (needs 2+ numeric channels, dataset has 1)', scatterBtn?.disabled === true)
check(
  "scatter button's title tooltip explains why it is disabled",
  !!scatterBtn?.getAttribute('title')?.includes('numeric channels'),
)
check('scatter button is not marked active', scatterBtn?.classList.contains('active') === false)

check('area button is enabled (timestamped with 1+ numeric channel)', areaBtn?.disabled === false)
check('area button is not marked active (currentType is timeSeries)', areaBtn?.classList.contains('active') === false)

// Click the enabled area button: should notify the parent with its type.
areaBtn?.dispatchEvent(new window.Event('click', { bubbles: true }))
check('clicking an enabled button calls onSelectType with its chart type', selections.includes('area'))
check('clicking an enabled button does not fire for other types', !selections.includes('timeSeries') && !selections.includes('scatter'))

// Click the disabled scatter button: should NOT notify the parent.
scatterBtn?.dispatchEvent(new window.Event('click', { bubbles: true }))
check('clicking a disabled button does not call onSelectType', !selections.includes('scatter'))

// --- Scenario 2: same dataset, currentType = 'area' ---
const container2 = renderSelector(mixedDataset, 'area', () => {})
const buttons2 = Array.from(container2.querySelectorAll('button')) as unknown as HTMLButtonElement[]
check(
  'active class follows currentType across renders',
  buttons2[2]?.classList.contains('active') === true && buttons2[0]?.classList.contains('active') === false,
)

console.log(`\n${failures === 0 ? 'ALL CHART TYPE SELECTOR CHECKS PASSED' : `${failures} CHART TYPE SELECTOR CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
