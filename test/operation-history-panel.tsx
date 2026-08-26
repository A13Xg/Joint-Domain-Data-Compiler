// Verifies OperationHistoryPanel renders one list item per operation record
// (summary, ISO timestamp, operation id/version, formatted params, scope
// when present, and warnings), shows the "No operations yet." empty state
// when the list is empty, and renders the current dataset's own stats as a
// summary header regardless of operation count.
import { parseHTML } from 'linkedom'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { ReactElement } from 'react'
import type { Dataset } from '../src/core/model.ts'
import type { OperationRecord } from '../src/core/recipes/model.ts'
import { OperationHistoryPanel } from '../src/ui/OperationHistoryPanel.tsx'

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

function render(node: ReactElement) {
  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  const root = createRoot(container as unknown as Element)
  flushSync(() => {
    root.render(node)
  })
  return container
}

const dataset: Dataset = {
  id: 'flight-1',
  name: 'Flight 1',
  sourceFormat: 'csv',
  warnings: [],
  channels: ['altitude_ft'],
  createdAt: Date.now(),
  points: [
    { lat: 10, lon: 20, time: 1000, ext: { altitude_ft: 100 } },
    { lat: 11, lon: 21, time: 2000, ext: { altitude_ft: 200 } },
    { lat: 12, lon: 22, time: 3000, ext: { altitude_ft: 300 } },
  ],
}

const operations: OperationRecord[] = [
  {
    id: 'op-1',
    operationId: 'resample-fixed-rate',
    operationVersion: 1,
    params: { intervalMs: 1000, method: 'linear' },
    inputDatasetHash: 'hash-0',
    outputDatasetHash: 'hash-1',
    createdAt: Date.UTC(2026, 0, 1, 12, 0, 0),
    summary: 'Resampled to 1 Hz',
    warnings: [],
  },
  {
    id: 'op-2',
    operationId: 'trim-range',
    operationVersion: 2,
    params: { startIndex: 0, endIndex: 2 },
    inputDatasetHash: 'hash-1',
    outputDatasetHash: 'hash-2',
    scope: { indexRange: { start: 0, end: 2 } },
    createdAt: Date.UTC(2026, 0, 1, 12, 5, 0),
    summary: 'Trimmed to selection',
    warnings: ['1 point dropped for missing time'],
  },
]

// --- Scenario 1: operations present ---
const container = render(<OperationHistoryPanel operations={operations} dataset={dataset} />)

check('renders the operation-history-panel wrapper', container.querySelector('.operation-history-panel') !== null)
check('renders an operation-list', container.querySelector('ul.operation-list') !== null)

const items = Array.from(container.querySelectorAll('li.operation-item')) as unknown as HTMLLIElement[]
check('renders one item per operation', items.length === 2)

const summaries = items.map((item) => item.querySelector('.operation-summary')?.textContent ?? '')
check('first operation summary is shown', summaries[0] === 'Resampled to 1 Hz')
check('second operation summary is shown', summaries[1] === 'Trimmed to selection')

const timestamps = items.map((item) => item.querySelector('time.operation-timestamp'))
check('every item renders a <time> element', timestamps.every((time) => time !== null))
check(
  'timestamp is formatted as ISO and matches the record createdAt',
  timestamps[0]?.getAttribute('dateTime') === new Date(operations[0]!.createdAt).toISOString()
    && (timestamps[0]?.textContent ?? '').includes('2026-01-01'),
)

const details = items.map((item) => item.querySelector('.operation-item-detail')?.textContent ?? '')
check('first item shows operationId and version', details[0]!.includes('resample-fixed-rate v1'))
check('first item shows formatted params', details[0]!.includes('intervalMs: 1000') && details[0]!.includes('method: linear'))
check('second item shows its own params', details[1]!.includes('startIndex: 0') && details[1]!.includes('endIndex: 2'))
check('second item shows scope range derived from indexRange', details[1]!.includes('points #0–2'))
check('first item has no scope (none recorded)', !details[0]!.includes('scope:'))

const warningItems = items[1]?.querySelectorAll('.operation-warnings li') ?? []
check('warnings render for the operation that recorded them', warningItems.length === 1 && (warningItems[0]?.textContent ?? '').includes('1 point dropped for missing time'))
check('operation with no warnings renders no warnings list', items[0]?.querySelector('.operation-warnings') === null)

check(
  'summary header reports the current dataset point count',
  (container.querySelector('.operation-history-summary')?.textContent ?? '').includes('3 points'),
)
check('empty state is not shown when operations exist', container.querySelector('.operation-history-empty') === null)

// --- Scenario 2: empty operations list ---
const emptyContainer = render(<OperationHistoryPanel operations={[]} dataset={dataset} />)
check('renders the wrapper for an empty operation list', emptyContainer.querySelector('.operation-history-panel') !== null)
check('shows the "No operations yet." empty state', (emptyContainer.querySelector('.operation-history-empty')?.textContent ?? '') === 'No operations yet.')
check('renders no operation-list when empty', emptyContainer.querySelector('ul.operation-list') === null)
check(
  'still reports current dataset stats when there is no history',
  (emptyContainer.querySelector('.operation-history-summary')?.textContent ?? '').includes('3 points'),
)

console.log(`\n${failures === 0 ? 'ALL OPERATION HISTORY PANEL CHECKS PASSED' : `${failures} OPERATION HISTORY PANEL CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
