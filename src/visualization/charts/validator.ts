// Chart type validation: given a Dataset's actual shape (timestamps present?
// which numeric channels exist?), determines which chart types can render it
// meaningfully. Consumed by the Charts tab to disable/flag incompatible chart
// type selections instead of letting users land on a broken visualization.

import type { Dataset, TrackPoint } from '../../core/model.ts'

export type ChartType = 'timeSeries' | 'scatter' | 'area'

export interface ChartTypeInfo {
  type: ChartType
  isValid: boolean
  reason?: string
  minChannels?: number
  requiredChannelType?: string
}

const MIN_SCATTER_CHANNELS = 2
const MIN_AREA_CHANNELS = 1

function hasTimestamps(points: readonly TrackPoint[]): boolean {
  return points.some((point) => typeof point.time === 'number' && Number.isFinite(point.time))
}

/**
 * Counts the distinct numeric channels a chart could plot. Mirrors the
 * channel resolution used by extractChartSeries in ./series.ts: `elevation`
 * is a virtual channel backed by `point.ele`, everything else is an
 * extension channel backed by `point.ext[channelId]`. lat/lon are excluded
 * since they belong to the map view, not the Charts tab.
 */
function countNumericChannels(dataset: Dataset): number {
  const numericIds = new Set<string>()

  if (dataset.points.some((point) => typeof point.ele === 'number' && Number.isFinite(point.ele))) {
    numericIds.add('elevation')
  }

  for (const channelId of dataset.channels) {
    const isNumeric = dataset.points.some((point) => typeof point.ext?.[channelId] === 'number')
    if (isNumeric) numericIds.add(channelId)
  }

  return numericIds.size
}

export function getValidChartTypes(dataset: Dataset): ChartTypeInfo[] {
  const timestamped = hasTimestamps(dataset.points)
  const numericChannelCount = countNumericChannels(dataset)

  return [
    {
      type: 'timeSeries',
      isValid: timestamped,
      reason: timestamped
        ? undefined
        : 'Dataset has no timestamp data; time-series charts require a time value on each point.',
      requiredChannelType: 'timestamp',
    },
    {
      type: 'scatter',
      isValid: numericChannelCount >= MIN_SCATTER_CHANNELS,
      reason:
        numericChannelCount >= MIN_SCATTER_CHANNELS
          ? undefined
          : `Scatter charts require ${MIN_SCATTER_CHANNELS}+ numeric channels (found ${numericChannelCount}).`,
      minChannels: MIN_SCATTER_CHANNELS,
    },
    {
      type: 'area',
      isValid: timestamped && numericChannelCount >= MIN_AREA_CHANNELS,
      reason: !timestamped
        ? 'Dataset has no timestamp data; area charts require a time value on each point.'
        : numericChannelCount < MIN_AREA_CHANNELS
          ? `Area charts require ${MIN_AREA_CHANNELS}+ numeric channel (found ${numericChannelCount}).`
          : undefined,
      minChannels: MIN_AREA_CHANNELS,
      requiredChannelType: 'timestamp',
    },
  ]
}

/** True when `chartType` is unknown, or known but not valid for this dataset. */
export function isMismatch(dataset: Dataset, chartType: string): boolean {
  const match = getValidChartTypes(dataset).find((info) => info.type === chartType)
  return match ? !match.isValid : true
}

/** Picks the most useful valid chart type for a dataset, preferring timeSeries > area > scatter. */
export function getBestChartType(dataset: Dataset): ChartType {
  const valid = getValidChartTypes(dataset).filter((info) => info.isValid)
  return (
    valid.find((info) => info.type === 'timeSeries')?.type ??
    valid.find((info) => info.type === 'area')?.type ??
    valid.find((info) => info.type === 'scatter')?.type ??
    'timeSeries'
  )
}
