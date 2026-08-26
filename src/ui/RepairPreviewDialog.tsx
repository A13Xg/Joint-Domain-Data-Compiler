// Accept-or-revert gate for a proposed repair.
//
// The repair is computed but never applied until Accept is pressed, which is
// what makes "no choice defaults to revert" structural rather than a handler
// per exit path: Escape, the backdrop, and unmounting all land on the same
// no-op. Revert holds initial focus for the same reason.
//
// This dialog also carries what ConfirmDialog used to say about a destructive
// operation — the summary, the warnings, and the before/after counts — so a
// repair raises one gate, not two.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { TrackPoint } from '../core/model'
import type { TrackDiff } from '../core/repair/diff'
import { describeTrackDiff } from '../core/repair/diff'
import { trapFocus } from './focusTrap'
import { TrackDiffPlot, type DiffPlotView } from './TrackDiffPlot'

export interface RepairPreviewRequest {
  /** The operation's label, e.g. "Drop outliers". */
  title: string
  /** The operation's own one-line account of what it did. */
  summary: string
  warnings: string[]
  before: TrackPoint[]
  after: TrackPoint[]
  diff: TrackDiff
  /** Extra context, e.g. that the run was scoped to the selected range. */
  note?: string
}

interface Props {
  request: RepairPreviewRequest
  onAccept: () => void
  onRevert: () => void
}

export function RepairPreviewDialog({ request, onAccept, onRevert }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const revertRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const summaryId = useId()
  const { diff } = request

  const views = useMemo(() => availableViews(diff), [diff])
  const [view, setView] = useState<DiffPlotView>(views[0] ?? 'plan')

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Revert, not Accept: the safe outcome is the one a stray Enter should pick.
    revertRef.current?.focus()
    return () => previouslyFocused?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // usePointSelection installs a window-level Escape handler that clears
        // the whole selection; without stopping propagation one Escape would
        // both revert the repair and wipe the selection behind it.
        event.preventDefault()
        event.stopPropagation()
        onRevert()
        return
      }
      if (event.key === 'Tab') trapFocus(event, dialogRef.current)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onRevert])

  const facts = describeTrackDiff(diff)

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onRevert() }}>
      <div
        className="dialog dialog-repair-preview"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={summaryId}
      >
        <header className="repair-preview-head">
          <h3 id={titleId} className="dialog-title">{request.title} — proposed repair</h3>
          <p id={summaryId} className="dialog-message">{request.summary}</p>
        </header>

        {views.length > 1 && (
          <div className="repair-preview-views" role="tablist" aria-label="Comparison view">
            {views.map((candidate) => (
              <button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={view === candidate}
                className={`repair-view-tab${view === candidate ? ' active' : ''}`}
                onClick={() => setView(candidate)}
              >
                {candidate === 'plan' ? 'Plan view' : 'Profile'}
              </button>
            ))}
          </div>
        )}

        <TrackDiffPlot before={request.before} after={request.after} diff={diff} view={view} />

        <div className="repair-preview-legend">
          <span className="legend-item"><span className="legend-swatch legend-before" aria-hidden="true" />Original</span>
          <span className="legend-item"><span className="legend-swatch legend-after" aria-hidden="true" />Proposed repair</span>
          {diff.counts.removed > 0 && <span className="legend-item"><span className="legend-swatch legend-removed" aria-hidden="true" />Removed</span>}
          {diff.counts.added > 0 && <span className="legend-item"><span className="legend-swatch legend-added" aria-hidden="true" />Added</span>}
          {diff.counts.modified > 0 && <span className="legend-item"><span className="legend-swatch legend-modified" aria-hidden="true" />Moved or retimed</span>}
        </div>

        <ul className="dialog-details mono small">
          {facts.map((fact) => <li key={fact}>{fact}</li>)}
          {request.note && <li>{request.note}</li>}
        </ul>

        {request.warnings.length > 0 && (
          <ul className="repair-preview-warnings small">
            {request.warnings.map((warning) => <li key={warning} className="warn">{warning}</li>)}
          </ul>
        )}

        <div className="dialog-actions repair-preview-actions">
          <span className="muted small">Nothing has been applied yet. Closing this reverts.</span>
          <button type="button" ref={revertRef} onClick={onRevert}>Revert</button>
          <button type="button" className="primary" onClick={onAccept}>Accept</button>
        </div>
      </div>
    </div>
  )
}

/** Only offers a view that has something to show; plan first when the geometry moved. */
function availableViews(diff: TrackDiff): DiffPlotView[] {
  const views: DiffPlotView[] = []
  if (diff.changed.position || diff.alignment === 'rebuilt') views.push('plan')
  if (diff.changed.elevation || diff.changed.time || diff.alignment === 'rebuilt') views.push('profile')
  return views.length > 0 ? views : ['plan']
}
