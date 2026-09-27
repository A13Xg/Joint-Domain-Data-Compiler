import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Dataset } from '../core/model'
import { trapFocus } from './focusTrap'
import { sanitizeFilename } from '../core/reports/exportNaming'
import type { PlaybackDatasetMetadata } from '../persistence/playback'

interface Props {
  datasets: Dataset[]
  suggestedScenarioName: string
  suggestedFilename: string
  onCancel: () => void
  onConfirm: (result: {
    scenarioName: string
    filename: string
    compressed: boolean
    datasetMetadata: Record<string, PlaybackDatasetMetadata>
  }) => void
}

/**
 * Confirmation step for ".jddc-playback" export. Every loaded dataset is
 * exported (Playback has no use for a workbench-only subset today); this
 * dialog only lets the operator attach the callsign/aircraft-type labels
 * the playback/graph apps display, before anything downloads.
 */
export function PlaybackExportDialog({ datasets, suggestedScenarioName, suggestedFilename, onCancel, onConfirm }: Props) {
  const [scenarioName, setScenarioName] = useState(suggestedScenarioName)
  const [filename, setFilename] = useState(sanitizeFilename(suggestedFilename))
  const [compressed, setCompressed] = useState(true)
  const [callsigns, setCallsigns] = useState<Record<string, string>>(() => Object.fromEntries(datasets.map((d) => [d.id, d.name])))
  const [aircraftTypes, setAircraftTypes] = useState<Record<string, string>>({})
  const headingId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    nameInputRef.current?.focus()
    return () => previouslyFocused?.focus()
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

  const confirm = () => {
    const datasetMetadata: Record<string, PlaybackDatasetMetadata> = {}
    for (const dataset of datasets) {
      const callsign = callsigns[dataset.id]?.trim()
      const aircraftType = aircraftTypes[dataset.id]?.trim()
      if (callsign || aircraftType) {
        datasetMetadata[dataset.id] = { ...(callsign ? { callsign } : {}), ...(aircraftType ? { aircraftType } : {}) }
      }
    }
    onConfirm({ scenarioName: scenarioName.trim() || suggestedScenarioName, filename: sanitizedFilename, compressed, datasetMetadata })
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div
        ref={dialogRef}
        className="dialog playback-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
      >
        <h2 id={headingId}>Export to Playback</h2>
        <p id={descriptionId} className="muted small">
          Exports every loaded dataset&apos;s current points and channels as a <code>.jddc-playback</code> scenario
          — no undo history, recipes, or fusion artifacts. Nothing downloads until you confirm.
        </p>

        <div className="field-grid">
          <label className="field">
            <span>Scenario name</span>
            <input ref={nameInputRef} type="text" value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} />
          </label>
          <label className="field">
            <span>Download filename</span>
            <input type="text" value={filename} onChange={(event) => setFilename(event.target.value)} />
          </label>
        </div>
        <p className="muted small">Will save as <code>{sanitizedFilename}.jddc-playback</code>.</p>

        <label className="header-compat-toggle">
          <input type="checkbox" checked={compressed} onChange={(event) => setCompressed(event.target.checked)} />
          Gzip-compress (uncheck to save as plain, human-readable JSON)
        </label>

        <table className="playback-export-table">
          <thead>
            <tr><th>Dataset</th><th>Callsign</th><th>Aircraft type</th></tr>
          </thead>
          <tbody>
            {datasets.map((dataset) => (
              <tr key={dataset.id}>
                <td>{dataset.name}</td>
                <td>
                  <input
                    type="text"
                    aria-label={`Callsign for ${dataset.name}`}
                    value={callsigns[dataset.id] ?? ''}
                    onChange={(event) => setCallsigns((current) => ({ ...current, [dataset.id]: event.target.value }))}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    aria-label={`Aircraft type for ${dataset.name}`}
                    placeholder="e.g. F-16C"
                    value={aircraftTypes[dataset.id] ?? ''}
                    onChange={(event) => setAircraftTypes((current) => ({ ...current, [dataset.id]: event.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="dialog-actions">
          <div className="dialog-actions-primary">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button type="button" className="export-btn" onClick={confirm}>Export</button>
          </div>
        </div>
      </div>
    </div>
  )
}
