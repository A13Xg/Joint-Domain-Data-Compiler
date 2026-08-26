// Transient status notifications.
//
// The previous implementation held a single string in state, so a second
// message replaced the first before it had been read — during an import that
// emits several results in quick succession, most of them were never seen.
// This stacks them, types them by severity, and lets the user dismiss one
// early or let it expire.

import { useEffect } from 'react'
import { TOAST_DURATION_MS, TOAST_ICON, type ToastMessage } from './toastModel'

interface Props {
  toasts: ToastMessage[]
  onDismiss: (id: number) => void
  /** Shifts the stack down when the log dock is collapsed to a single line. */
  compactDock: boolean
}

export function ToastStack({ toasts, onDismiss, compactDock }: Props) {
  if (toasts.length === 0) return null
  return (
    <div className={`toast-stack${compactDock ? ' toast-stack-low' : ''}`} role="region" aria-label="Notifications">
      {toasts.map((toast) => <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />)}
    </div>
  )
}

function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  // onDismiss is a stable useCallback in App, so listing it here does not
  // restart the timer on every render.
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_DURATION_MS[toast.tone])
    return () => window.clearTimeout(timer)
  }, [toast.id, toast.tone, onDismiss])

  const urgent = toast.tone === 'error' || toast.tone === 'warn'

  return (
    <div
      className={`toast toast-${toast.tone}`}
      // Errors and warnings interrupt; routine confirmations wait their turn
      // rather than talking over whatever a screen reader is already saying.
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
    >
      <span className="toast-icon" aria-hidden="true">{TOAST_ICON[toast.tone]}</span>
      <span className="toast-body">
        <span className="toast-message">{toast.message}</span>
        {toast.detail && <span className="toast-detail">{toast.detail}</span>}
      </span>
      <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>×</button>
      <span
        className="toast-timer"
        style={{ animationDuration: `${TOAST_DURATION_MS[toast.tone]}ms` }}
        aria-hidden="true"
      />
    </div>
  )
}
