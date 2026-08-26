import type { Dataset } from '../core/model'
import { setVisibility, type WorkspaceDisplay } from '../state/workspaceDisplay'

interface Props {
  datasets: Dataset[]
  activeId: string | null
  display: WorkspaceDisplay
  onDisplayChange: (next: WorkspaceDisplay) => void
  onSelectActive: (id: string) => void
}

export function SourcesPanel({ datasets, activeId, display, onDisplayChange, onSelectActive }: Props) {
  if (datasets.length === 0) return <div className="panel-empty">Load one or more datasets to manage sources.</div>

  return (
    <div className="sources-panel">
      <p className="muted small">
        Toggle which loaded datasets are visible as additional color-coded paths on the map, alongside the active dataset.
        Visibility is display-only — it never changes or removes any dataset.
      </p>
      <table className="compact-table sources-table">
        <thead><tr><th></th><th>color</th><th>name</th><th>format</th><th>points</th><th>visible</th><th></th></tr></thead>
        <tbody>
          {datasets.map((dataset) => {
            const entry = display[dataset.id]
            const isActive = dataset.id === activeId
            return (
              <tr key={dataset.id} className={isActive ? 'active-row' : undefined}>
                <td>{isActive ? '●' : ''}</td>
                <td><span className="chip-dot" style={{ background: entry?.color ?? '#475569' }} /></td>
                <td>{dataset.name}</td>
                <td className="mono">{dataset.sourceFormat}</td>
                <td className="mono">{dataset.points.length.toLocaleString()}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={entry?.visible ?? true}
                    aria-label={`Toggle visibility of ${dataset.name}`}
                    onChange={(event) => onDisplayChange(setVisibility(display, dataset.id, event.target.checked))}
                  />
                </td>
                <td>{!isActive && <button type="button" onClick={() => onSelectActive(dataset.id)}>Make active</button>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
