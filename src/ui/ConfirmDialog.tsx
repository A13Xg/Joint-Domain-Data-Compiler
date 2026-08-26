// Destructive-action confirmation.
//
// Replaces window.confirm, which renders a chrome-styled box that says nothing
// about *what* is about to change and cannot show structured detail. This can:
// the operation, the consequence, and the affected counts are all visible
// before the user commits.
//
// Follows the ReportExportDialog pattern exactly — .dialog-backdrop, role,
// aria-modal, click-out guard, Escape, shared trapFocus, focus restore.

import { useEffect, useId, useRef } from 'react'
import { trapFocus } from './focusTrap'

export interface ConfirmRequest {
  title: string
  /** The consequence, in plain language. */
  message: string
  /** Optional structured facts — counts, ranges — shown as a compact list. */
  details?: string[]
  confirmLabel?: string
  cancelLabel?: string
  /** Styles the confirm button as destructive. Defaults to true. */
  destructive?: boolean
}

interface Props {
  request: ConfirmRequest
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ request, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const messageId = useId()

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Focus the confirm button, not the dialog: a keyboard user should be one
    // Enter from proceeding and one Escape from backing out.
    confirmRef.current?.focus()
    return () => previouslyFocused?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // usePointSelection installs a window-level Escape handler that clears
        // the whole selection. preventDefault alone does not stop it, so a
        // single Escape would close this dialog *and* wipe the user's
        // selection behind it.
        event.preventDefault()
        event.stopPropagation()
        onCancel()
        return
      }
      if (event.key === 'Tab') trapFocus(event, dialogRef.current)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onCancel])

  const destructive = request.destructive ?? true

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div
        className="dialog dialog-confirm"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <h3 id={titleId} className="dialog-title">
          <span className={`dialog-icon${destructive ? ' dialog-icon-danger' : ''}`} aria-hidden="true">{destructive ? '!' : '?'}</span>
          {request.title}
        </h3>
        <p id={messageId} className="dialog-message">{request.message}</p>
        {request.details && request.details.length > 0 && (
          <ul className="dialog-details mono small">
            {request.details.map((detail) => <li key={detail}>{detail}</li>)}
          </ul>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>{request.cancelLabel ?? 'Cancel'}</button>
          <button type="button" ref={confirmRef} className={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
            {request.confirmLabel ?? 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
