// Modal focus containment, shared by every dialog.
//
// A plain module rather than an export from a component file: component files
// may only export components (react-refresh/only-export-components), which is
// why this previously lived as a private copy inside ReportExportDialog.
// Same precedent as core/reports/exportNaming.ts and ui/gradient.ts.

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** Cycles Tab/Shift+Tab within `container` so focus cannot escape a modal. */
export function trapFocus(event: KeyboardEvent, container: HTMLElement | null): void {
  if (!container) return
  const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE)
  if (focusable.length === 0) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  const active = document.activeElement
  if (event.shiftKey) {
    if (active === first || !container.contains(active)) {
      event.preventDefault()
      last.focus()
    }
  } else if (active === last) {
    event.preventDefault()
    first.focus()
  }
}
