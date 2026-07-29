import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_REPORT_OPTIONS,
  REPORT_SECTIONS,
  createReportOptions,
  type ReportOptions,
} from '../core/reports/options'
import { sanitizeFilename } from '../core/reports/exportNaming'

interface Props {
  /** Suggested title, e.g. derived from the project/dataset name and today's date. */
  suggestedTitle: string
  /** Suggested filename stem (without extension); sanitized before use regardless of source. */
  suggestedFilename: string
  onCancel: () => void
  onConfirm: (result: { options: ReportOptions; filename: string }) => void
}

/**
 * Modal confirmation step for HTML report export (Task 3.2). Opens instead
 * of downloading immediately: lets the user rename the report, sanitize the
 * download filename, and toggle exactly which `REPORT_SECTIONS` evidence
 * categories are included before anything is generated. Cancel never
 * triggers a download.
 */
export function ReportExportDialog({ suggestedTitle, suggestedFilename, onCancel, onConfirm }: Props) {
  const [title, setTitle] = useState(suggestedTitle)
  const [filename, setFilename] = useState(sanitizeFilename(suggestedFilename))
  const [sections, setSections] = useState<Record<string, boolean>>(() => sectionStateFromOptions(DEFAULT_REPORT_OPTIONS))
  const [checklistOpen, setChecklistOpen] = useState(false)
  const headingId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleInputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key === 'Tab') trapFocus(event, dialogRef.current)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const sanitizedFilename = useMemo(() => sanitizeFilename(filename), [filename])
  const includedCount = useMemo(() => REPORT_SECTIONS.filter((section) => sections[section.key]).length, [sections])

  const resetToDefaults = () => {
    setTitle(suggestedTitle)
    setFilename(sanitizeFilename(suggestedFilename))
    setSections(sectionStateFromOptions(DEFAULT_REPORT_OPTIONS))
  }

  const toggleSection = (key: string) => {
    setSections((current) => ({ ...current, [key]: !current[key] }))
  }

  const confirm = () => {
    const options = createReportOptions({
      title: title.trim() || suggestedTitle,
      ...(sections as unknown as Partial<ReportOptions>),
    })
    onConfirm({ options, filename: sanitizedFilename })
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div
        ref={dialogRef}
        className="dialog report-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
      >
        <h2 id={headingId}>Export HTML report</h2>
        <p id={descriptionId} className="muted small">
          Choose what this report includes before it is generated. Nothing downloads until you confirm.
        </p>

        <div className="field-grid">
          <label className="field">
            <span>Report title</span>
            <input ref={titleInputRef} type="text" value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="field">
            <span>Download filename</span>
            <input type="text" value={filename} onChange={(event) => setFilename(event.target.value)} />
          </label>
        </div>
        <p className="muted small">Will save as <code>{sanitizedFilename}.html</code>. Filename characters are sanitized independently from the visible title.</p>

        <details className="dialog-checklist" open={checklistOpen} onToggle={(event) => setChecklistOpen(event.currentTarget.open)}>
          <summary>Evidence sections ({includedCount}/{REPORT_SECTIONS.length} included)</summary>
          <ul className="dialog-checklist-list">
            {REPORT_SECTIONS.map((section) => (
              <li key={section.key}>
                <label className="header-compat-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(sections[section.key])}
                    onChange={() => toggleSection(section.key)}
                  />
                  {section.label}
                </label>
              </li>
            ))}
          </ul>
        </details>

        <div className="dialog-actions">
          <button type="button" onClick={resetToDefaults}>Reset to defaults</button>
          <div className="dialog-actions-primary">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button type="button" className="export-btn" onClick={confirm}>Generate report</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function sectionStateFromOptions(options: ReportOptions): Record<string, boolean> {
  const state: Record<string, boolean> = {}
  for (const section of REPORT_SECTIONS) state[section.key] = options[section.key]
  return state
}

function trapFocus(event: KeyboardEvent, container: HTMLElement | null): void {
  if (!container) return
  const focusable = container.querySelectorAll<HTMLElement>(
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
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
