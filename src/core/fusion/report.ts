// Tranche 6 Task 6.3 (audit report half). Pure summarization + export of an
// autoCombine result — never recomputes or second-guesses the decisions,
// only reports them, so the report can never disagree with the actual
// fused output.
import type { FusedPointDecision, SourceRegistration } from './model'
import type { SelectedIntervalOverride, SelectedPointOverride } from './model'

export interface FusionReportSourceSummary {
  sourceId: string
  label: string
  chosenCount: number
  skippedCount: number
}

export interface FusionReport {
  generatedAt: number
  totalGroups: number
  meanConfidence: number
  sourceSummaries: FusionReportSourceSummary[]
}

export function buildFusionReport(
  decisions: readonly FusedPointDecision[],
  sources: readonly SourceRegistration[],
  generatedAt: number = Date.now(),
): FusionReport {
  const summaryBySource = new Map<string, FusionReportSourceSummary>()
  for (const source of sources) summaryBySource.set(source.id, { sourceId: source.id, label: source.label, chosenCount: 0, skippedCount: 0 })

  for (const decision of decisions) {
    const chosenSummary = summaryBySource.get(decision.chosenSourceId)
    if (chosenSummary) chosenSummary.chosenCount++
    for (const skippedId of decision.skippedSourceIds) {
      const skippedSummary = summaryBySource.get(skippedId)
      if (skippedSummary) skippedSummary.skippedCount++
    }
  }

  return {
    generatedAt,
    totalGroups: decisions.length,
    meanConfidence: decisions.length > 0 ? decisions.reduce((sum, d) => sum + d.confidence, 0) / decisions.length : 0,
    sourceSummaries: [...summaryBySource.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
  }
}

export function serializeFusionReportJson(report: FusionReport): string {
  return JSON.stringify(report, null, 2)
}

export function fusionReportToMarkdown(report: FusionReport, overrides?: { pointOverrides?: readonly SelectedPointOverride[]; intervalOverrides?: readonly SelectedIntervalOverride[] }): string {
  const lines = [
    '# Fusion Report',
    '',
    `Generated: ${new Date(report.generatedAt).toISOString()}`,
    `Total groups: ${report.totalGroups}`,
    `Mean confidence: ${report.meanConfidence.toFixed(3)}`,
    ...(overrides ? [`Manual overrides: ${(overrides.pointOverrides?.length ?? 0)} point, ${(overrides.intervalOverrides?.length ?? 0)} interval`] : []),
    '',
    '| Source | Chosen | Skipped |',
    '| --- | --- | --- |',
    ...report.sourceSummaries.map((summary) => `| ${summary.label} (${summary.sourceId}) | ${summary.chosenCount} | ${summary.skippedCount} |`),
  ]
  return lines.join('\n')
}

export function fusionDecisionsToCsv(decisions: readonly FusedPointDecision[]): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
  const header = 'groupId,chosenSourceId,chosenSourceIndex,skippedSourceIds,reason,confidence'
  const rows = decisions.map((decision) => [
    decision.groupId,
    decision.chosenSourceId,
    String(decision.chosenSourceIndex),
    escape(decision.skippedSourceIds.join(';')),
    escape(decision.reason),
    String(decision.confidence),
  ].join(','))
  return [header, ...rows].join('\n')
}
