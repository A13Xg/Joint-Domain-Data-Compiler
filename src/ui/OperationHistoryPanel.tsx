import type { OperationRecord } from '../core/recipes/model'
import type { Dataset } from '../core/model'
import { computeStats } from '../core/stats'
import { epochMsToIso } from '../core/format'

export interface OperationHistoryPanelProps {
  operations: OperationRecord[]
  dataset: Dataset
}

/**
 * Renders a flat key: value summary of an operation's params. Params are
 * `unknown` at the type level (each operation defines its own shape), so this
 * takes the pragmatic approach of listing own-enumerable properties for plain
 * objects and falling back to `JSON.stringify` for everything else
 * (primitives, arrays, `null`), which keeps the panel from throwing on any
 * operation's param shape.
 */
function formatParams(params: unknown): string {
  if (params === null || params === undefined) return '—'
  if (typeof params !== 'object' || Array.isArray(params)) return JSON.stringify(params)
  const entries = Object.entries(params as Record<string, unknown>)
  if (entries.length === 0) return '—'
  return entries.map(([key, value]) => `${key}: ${formatParamValue(value)}`).join(', ')
}

/** Operation params are replayed from a project file, so a value can be any
 *  JSON shape. Never let one render as "[object Object]" — this panel is the
 *  audit trail for what was actually applied to the data. */
function formatParamValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  if (value === undefined) return '—'
  try {
    // JSON.stringify returns undefined for functions and symbols; neither
    // belongs in a recorded param, so label it rather than stringify it.
    return JSON.stringify(value) ?? '[unrepresentable]'
  } catch {
    return '[unserializable]'
  }
}

/** Human-readable label for a scope's affected range, when the operation recorded one. */
function formatScope(scope: OperationRecord['scope']): string | null {
  if (!scope) return null
  if (scope.indexRange) return `points #${scope.indexRange.start}–${scope.indexRange.end}`
  if (scope.timeRange) return `${epochMsToIso(scope.timeRange.startMs)} → ${epochMsToIso(scope.timeRange.endMs)}`
  return null
}

/**
 * Displays the operations applied to a dataset (its recipe history) as a
 * timestamped list with parameters and, where derivable, scope and result
 * stats. Individual `OperationRecord`s only carry before/after dataset
 * *hashes*, not full snapshots, so a true before/after point-count diff isn't
 * calculable per entry from just `operations` + the current `dataset`. What
 * *is* calculable — and shown — is the current dataset's own stats (as
 * "current result") and, per operation, the scope it was applied to when one
 * was recorded.
 */
export function OperationHistoryPanel({ operations, dataset }: OperationHistoryPanelProps) {
  const stats = computeStats(dataset)

  return (
    <div className="operation-history-panel">
      <div className="operation-history-summary">
        <h3>Operation history ({operations.length})</h3>
        <p className="muted small mono">
          current result: {stats.pointCount.toLocaleString()} points
          {stats.bounds && ` · bbox [${stats.bounds.minLat.toFixed(5)}, ${stats.bounds.minLon.toFixed(5)}] → [${stats.bounds.maxLat.toFixed(5)}, ${stats.bounds.maxLon.toFixed(5)}]`}
        </p>
      </div>
      {operations.length === 0
        ? <p className="muted small operation-history-empty">No operations yet.</p>
        : <ul className="operation-list">
          {operations.map((operation, index) => {
            const scopeLabel = formatScope(operation.scope)
            return (
              <li key={operation.id} className="operation-item">
                <div className="operation-item-header">
                  <span className="operation-index">#{index + 1}</span>
                  <span className="operation-summary">{operation.summary}</span>
                  <time className="operation-timestamp muted small mono" dateTime={epochMsToIso(operation.createdAt)}>
                    {epochMsToIso(operation.createdAt)}
                  </time>
                </div>
                <div className="operation-item-detail muted small mono">
                  <span className="operation-id">{operation.operationId} v{operation.operationVersion}</span>
                  <span className="operation-params">params: {formatParams(operation.params)}</span>
                  {scopeLabel && <span className="operation-scope">scope: {scopeLabel}</span>}
                </div>
                {operation.warnings.length > 0 && (
                  <ul className="operation-warnings">
                    {operation.warnings.map((warning, warningIndex) => (
                      <li key={warningIndex} className="warn-line small">⚠ {warning}</li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>}
    </div>
  )
}
