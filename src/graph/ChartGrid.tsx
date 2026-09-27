import { GraphChart, type GraphSeries } from './GraphChart'

export interface ChartSpec {
  title: string
  xLabel: string
  yLabel: string
  series: GraphSeries[]
}

/** Responsive 2-3-per-row layout for a set of independent charts. */
export function ChartGrid({ charts }: { charts: readonly ChartSpec[] }) {
  if (charts.length === 0) return <p className="muted">No channels available to chart.</p>
  return (
    <div className="chart-grid">
      {charts.map((chart) => (
        <GraphChart key={chart.title} title={chart.title} xLabel={chart.xLabel} yLabel={chart.yLabel} series={chart.series} />
      ))}
    </div>
  )
}
