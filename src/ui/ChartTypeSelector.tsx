import type { Dataset } from '../core/model'
import { getValidChartTypes, type ChartTypeInfo } from '../visualization/charts/validator'

export interface ChartTypeSelectorProps {
  dataset: Dataset
  currentType: string
  onSelectType: (type: string) => void
}

/** Human-readable labels for the chart types defined in validator.ts. */
const CHART_TYPE_LABELS: Record<string, string> = {
  timeSeries: 'Time Series',
  scatter: 'Scatter',
  area: 'Area',
}

/**
 * Renders one button per chart type, enabling only the ones that are valid
 * for the current dataset's shape (per getValidChartTypes). Invalid types
 * stay visible but disabled, with the validator's reason surfaced as a
 * tooltip, so users understand why a chart type is unavailable instead of
 * it silently disappearing.
 */
export function ChartTypeSelector({ dataset, currentType, onSelectType }: ChartTypeSelectorProps) {
  const chartTypes = getValidChartTypes(dataset)

  return (
    <div className="chart-type-selector" role="group" aria-label="Chart type">
      {chartTypes.map((info) => (
        <ChartTypeButton
          key={info.type}
          info={info}
          isActive={info.type === currentType}
          onSelectType={onSelectType}
        />
      ))}
    </div>
  )
}

function ChartTypeButton({
  info,
  isActive,
  onSelectType,
}: {
  info: ChartTypeInfo
  isActive: boolean
  onSelectType: (type: string) => void
}) {
  const label = CHART_TYPE_LABELS[info.type] ?? info.type
  const className = [
    'chart-type-btn',
    isActive ? 'active' : '',
    !info.isValid ? 'chart-type-btn-disabled' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={className}
      disabled={!info.isValid}
      title={info.isValid ? undefined : info.reason}
      aria-label={info.isValid ? `${label} chart` : `${label} chart, unavailable: ${info.reason ?? 'not supported for this dataset'}`}
      aria-pressed={isActive}
      onClick={() => {
        if (info.isValid) onSelectType(info.type)
      }}
    >
      {label}
    </button>
  )
}
