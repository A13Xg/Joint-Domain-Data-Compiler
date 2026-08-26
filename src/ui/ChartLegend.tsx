import type { Dataset } from '../core/model'

export interface ChartLegendProps {
  dataset: Dataset
  visibleChannels?: string[]
  onToggleChannel?: (channelKey: string) => void
}

/**
 * Color rotation for legend swatches. Deliberately overlaps with
 * TimeSeriesChart's own series PALETTE (red/teal/blue/amber/purple/pink) so a
 * future wiring of this legend into that chart (Task 4) can share the same
 * index-based color assignment and have swatches match plotted lines
 * one-to-one, with green and indigo added to round the rotation out to 8.
 */
const LEGEND_PALETTE = [
  '#ea4f2f', // red
  '#3b82f6', // blue
  '#22c55e', // green
  '#eab308', // amber
  '#a855f7', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#6366f1', // indigo
]

/**
 * Channels that describe the x-axis / time domain rather than a plottable
 * series. Currently just 'timestamp' — some upstream producers could in
 * principle list it in `dataset.channels` even though the canonical time
 * value lives on `TrackPoint.time`, not `TrackPoint.ext`.
 */
const NON_SERIES_CHANNELS = new Set(['timestamp'])

/** Human-readable label for a channel: prefers the dataset's own semantic metadata (displayName + unit) when present, falling back to the raw channel key. */
function channelLabel(dataset: Dataset, channelKey: string): string {
  const definition = dataset.metadata?.channels.find((candidate) => candidate.id === channelKey)
  if (!definition) return channelKey
  return definition.unit ? `${definition.displayName} (${definition.unit})` : definition.displayName
}

/**
 * Renders a legend of a dataset's plottable channels (skipping the
 * 'timestamp' pseudo-channel), each with a color swatch drawn from
 * LEGEND_PALETTE by index. When `visibleChannels` is supplied, matching items
 * get a `.visible` class so callers can style shown vs. hidden series
 * differently. When `onToggleChannel` is supplied, each item gets a toggle
 * button that reports its channel key back to the caller on click.
 */
export function ChartLegend({ dataset, visibleChannels, onToggleChannel }: ChartLegendProps) {
  const channels = dataset.channels.filter((channel) => !NON_SERIES_CHANNELS.has(channel))

  return (
    <div className="chart-legend">
      <ul className="legend-items">
        {channels.map((channel, index) => {
          const isVisible = visibleChannels?.includes(channel) ?? false
          const label = channelLabel(dataset, channel)
          const className = ['legend-item', isVisible ? 'visible' : ''].filter(Boolean).join(' ')
          const color = LEGEND_PALETTE[index % LEGEND_PALETTE.length]

          return (
            <li key={channel} className={className}>
              <span className="legend-color" style={{ backgroundColor: color }} aria-hidden="true" />
              <span className="legend-label">{label}</span>
              {onToggleChannel && (
                <button
                  type="button"
                  className="legend-toggle"
                  aria-label={`${isVisible ? 'Hide' : 'Show'} ${label}`}
                  aria-pressed={isVisible}
                  onClick={() => onToggleChannel(channel)}
                >
                  {isVisible ? 'Hide' : 'Show'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
