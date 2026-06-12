import type { DetectedColumn } from '../types/converter'

interface Props {
  column: DetectedColumn | undefined
}

/** Small "i" badge; on hover shows the column's estimated type and a few sample values.
 *  Renders nothing if no column is selected. */
export function InfoTooltip({ column }: Props) {
  if (!column) return null

  const samples = column.sampleValues.slice(0, 4)

  return (
    <span className="info-tooltip-wrap" tabIndex={0}>
      <span className="info-icon" aria-hidden="true">i</span>
      <span className="info-tooltip-box" role="tooltip">
        <strong>{column.name}</strong>
        <span className="info-tooltip-type">Type: {column.estimatedType}</span>
        {samples.length > 0 && (
          <span className="info-tooltip-samples">
            Examples: {samples.join(', ')}
          </span>
        )}
      </span>
    </span>
  )
}
