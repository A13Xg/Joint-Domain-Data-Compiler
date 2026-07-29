import type { Dataset } from '../model'
import type { OperationRecord } from '../recipes/model'
import type { ProjectBookmark } from '../../persistence/project/manifest'
import type { FusionReport } from '../fusion/report'
import { detectQualityEvents } from '../quality/events'
import { computeStats, formatDuration } from '../stats'
import {
  normalizeReportOptions,
  REPORT_SECTIONS,
  type ReportComparisonSummary,
  type ReportOptions,
  type ReportOverlayEntry,
} from './options'

export type { ReportOptions, ReportComparisonSummary, ReportOverlayEntry } from './options'
export { DEFAULT_REPORT_OPTIONS, normalizeReportOptions } from './options'

/**
 * @deprecated retained for source-compat with older callers; use `Partial<ReportOptions>` going forward.
 * Every field maps 1:1 onto the new `include*` option so passing this shape into `options` still works.
 */
export interface HtmlAnalysisReportOptions {
  includeQualityEvents?: boolean
  includeWarnings?: boolean
  includeOperations?: boolean
  includeBookmarks?: boolean
}

export interface HtmlAnalysisReportInput {
  title: string
  generatedAt: number
  applicationVersion: string
  datasets: readonly Dataset[]
  bookmarks: readonly ProjectBookmark[]
  operationRecords: Readonly<Record<string, readonly OperationRecord[]>>
  /** Cross-dataset comparison summary. Only rendered when `options.includeComparison` is enabled AND this is supplied. */
  comparison?: ReportComparisonSummary
  /** Multi-source fusion decision summary. Only rendered when `options.includeFusion` is enabled AND this is supplied. */
  fusion?: FusionReport
  /** Map overlay inventory. Only rendered when `options.includeOverlayInventory` is enabled AND this is supplied. */
  overlays?: readonly ReportOverlayEntry[]
  options?: Partial<ReportOptions> | HtmlAnalysisReportOptions
}

function resolveOptions(input: HtmlAnalysisReportInput): ReportOptions {
  const raw = input.options as Record<string, unknown> | undefined
  // Translate the legacy flat 4-flag shape (includeOperations, no title) onto the new contract before normalizing,
  // so old call sites (and the old test suite) keep working unchanged.
  const translated = raw
    ? {
        ...raw,
        includeOperationHistory: raw.includeOperationHistory ?? raw.includeOperations,
      }
    : undefined
  return normalizeReportOptions(translated, input.title).options
}

export function buildHtmlAnalysisReport(input: HtmlAnalysisReportInput): string {
  const options = resolveOptions(input)
  const title = options.title
  const totalPoints = input.datasets.reduce((sum, dataset) => sum + dataset.points.length, 0)
  const totalEvents = input.datasets.reduce((sum, dataset) => sum + detectQualityEvents(dataset.points).length, 0)
  const totalDistanceMeters = input.datasets.reduce((sum, dataset) => sum + computeStats(dataset).distanceMeters, 0)

  const datasetSections = input.datasets.map((dataset, index) => buildDatasetSection(
    dataset,
    input.bookmarks.filter((bookmark) => bookmark.datasetId === dataset.id),
    input.operationRecords[dataset.id] ?? [],
    index,
    options,
  )).join('\n')

  const body = [
    buildHeaderSection(title, input.generatedAt, input.applicationVersion, input.datasets.length),
    buildScopeSection(options),
    buildOverviewSection(input.datasets.length, totalPoints, totalDistanceMeters, totalEvents),
    datasetSections || '<p>No datasets were loaded when this report was generated.</p>',
    buildComparisonSection(options, input.comparison),
    buildFusionSection(options, input.fusion),
    buildNotionalDisclosureSection(options, input.datasets),
    buildOverlayInventorySection(options, input.overlays),
    buildFooterSection(),
  ].filter((section) => section !== '').join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17231f;background:#f5f4ed;color-scheme:light;--ink:#17231f;--muted:#63726b;--line:#9aaca4;--line-soft:#d7dfda;--paper:#fffef8;--panel:#f8faf7;--signal:#238f61;--vector:#157c88;--pulse:#b43678;--alert:#a86f15}
*{box-sizing:border-box}
html{min-height:100%;background:#e9ede8}
body{max-width:1180px;margin:0 auto;padding:42px 34px 72px;background-color:#f5f4ed;background-image:linear-gradient(rgba(21,124,136,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(21,124,136,.055) 1px,transparent 1px),radial-gradient(circle at 12% 8%,rgba(35,143,97,.07),transparent 24%);background-size:32px 32px,32px 32px,100% 100%}
.report-header{position:relative;overflow:hidden;min-height:300px;padding:38px 42px;border:1px solid #607a70;background:rgba(255,254,248,.92);box-shadow:8px 8px 0 rgba(21,124,136,.08)}
.report-header:before,.report-header:after{content:"";position:absolute;border:1px solid rgba(21,124,136,.28);border-radius:50%;pointer-events:none}
.report-header:before{width:430px;height:430px;right:-105px;top:-175px;box-shadow:0 0 0 58px rgba(21,124,136,.035),0 0 0 116px rgba(180,54,120,.025)}
.report-header:after{width:9px;height:9px;right:174px;top:83px;background:var(--signal);border-color:var(--signal);box-shadow:0 0 0 5px rgba(35,143,97,.12)}
.vector-mark{position:absolute;right:28px;bottom:20px;width:330px;height:150px;opacity:.62}
.eyebrow,.section-code,.metric-label,.status-label{font:600 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase}
.eyebrow{display:flex;align-items:center;gap:12px;color:#126b48}
.eyebrow:before{content:"";width:28px;height:1px;background:var(--signal);box-shadow:8px 0 var(--signal)}
h1{position:relative;max-width:760px;margin:28px 0 16px;font-size:clamp(36px,6vw,70px);font-weight:620;line-height:.98;letter-spacing:-.045em;color:#12201a}
.lede{position:relative;max-width:680px;margin:0;color:#51635a;font-size:15px}
.status-rail{position:relative;display:flex;flex-wrap:wrap;gap:28px;margin-top:36px;padding-top:18px;border-top:1px solid rgba(134,232,178,.24)}
.status-item{min-width:150px}.status-label{display:block;margin-bottom:5px;color:#687a71}.status-value{font:600 13px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;color:#1d3329}
.overview-grid,.metric-grid{display:grid;gap:1px;margin:18px 0;background:var(--line);border:1px solid var(--line)}
.overview-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
.metric-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
.overview-card,.metric-card{position:relative;min-height:118px;padding:22px;background:rgba(255,254,248,.96)}
.overview-card:nth-child(2n),.metric-card:nth-child(2n){background:#f1f6f2}
.overview-card:after,.metric-card:after{content:"";position:absolute;right:12px;top:12px;width:8px;height:8px;border-top:1px solid var(--pulse);border-right:1px solid var(--pulse)}
.metric-label{display:block;margin-bottom:16px;color:#5f7369}
.metric-value{display:block;font:600 25px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#18271f;letter-spacing:-.04em}
.overview-card:first-child .metric-value{color:var(--signal)}
.dataset{position:relative;margin:54px 0 0;padding:30px;border:1px solid #758c82;background:rgba(255,254,248,.95);box-shadow:6px 6px 0 rgba(35,143,97,.065)}
.dataset:before{content:"";position:absolute;left:-1px;top:34px;width:3px;height:74px;background:linear-gradient(var(--signal),var(--vector))}
.dataset-heading{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:18px;margin-bottom:24px}
.dataset-index{display:grid;place-items:center;width:42px;height:42px;border:1px solid #36715a;color:#176f4b;background:#edf8f1;font:700 13px ui-monospace,SFMono-Regular,Menlo,monospace;clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)}
h2{margin:0;color:#16251e;font-size:27px;line-height:1.15;letter-spacing:-.025em}
.dataset-format{padding:7px 10px;border:1px solid #6d8980;color:#3c5b4e;background:#f4f8f5;font:700 10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em}
h3{display:flex;align-items:center;gap:10px;margin:30px 0 11px;color:#405d50;font-size:12px;letter-spacing:.15em;text-transform:uppercase;break-after:avoid}
h3:after{content:"";height:1px;flex:1;background:linear-gradient(90deg,var(--line),transparent)}
table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid var(--line);font-size:13px}
th,td{padding:12px 14px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line-soft)}
tr:last-child th,tr:last-child td{border-bottom:0}
th{width:190px;color:#53685e;background:#eef3ef;font:600 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase}
td{color:#26372f;background:#fffef8;overflow-wrap:anywhere}
.evidence-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;margin:0;padding:0;list-style:none}
.evidence-list li{position:relative;padding:11px 12px 11px 31px;border:1px solid #c2cec8;background:#fafbf7;color:#33483e;font-size:13px}
.evidence-list li:before{content:"";position:absolute;left:13px;top:17px;width:7px;height:7px;border:1px solid var(--vector);transform:rotate(45deg)}
.empty{margin:0;padding:12px 14px;border-left:2px solid #6f9684;background:#f1f5f1;color:#63746b;font-size:13px}
.dataset-heading,.metric-grid,table,.evidence-list li{break-inside:avoid}
.scope-block{margin:26px 0 0;padding:22px 26px;border:1px solid #6d8980;background:#f4f8f5}
.scope-block h2{font-size:16px;letter-spacing:.02em}
.scope-lede{margin:8px 0 16px;color:#405c50;font-size:13px}
.scope-columns{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.scope-columns h3{margin:0 0 8px}
.report-footer{display:flex;justify-content:space-between;gap:24px;margin-top:50px;padding:18px 0;border-top:1px solid var(--line);color:#62776c;font:500 10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase}
@media(max-width:760px){body{padding:18px 14px 44px}.report-header{min-height:0;padding:28px 24px}.vector-mark{display:none}.overview-grid,.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dataset{padding:22px 18px}.dataset-heading{grid-template-columns:auto 1fr}.dataset-format{grid-column:2}.scope-columns{grid-template-columns:1fr}.report-footer{display:block}}
@page{margin:14mm}
@media print{html,body{background:#fff;color:#17231d}body{max-width:none;margin:0;padding:0;background-image:none}.report-header{min-height:240px;background:#fff;box-shadow:none}.report-header:before{border-color:#b5cbc0;box-shadow:none}.report-header:after{box-shadow:none}.overview-card,.metric-card,.overview-card:nth-child(2n),.metric-card:nth-child(2n),.dataset,.scope-block{background:#fff;box-shadow:none}.dataset{break-before:auto}.vector-mark{opacity:.28}}
</style>
</head>
<body>
${body}
</body>
</html>`
}

// --- Section builders ---------------------------------------------------
// Each builder is a pure function of its inputs. Sections that are option-
// gated return '' when disabled instead of being rendered and stripped —
// there is no post-processing of the assembled HTML anywhere in this file.

function buildHeaderSection(title: string, generatedAt: number, applicationVersion: string, datasetCount: number): string {
  return `<header class="report-header">
  <div class="eyebrow">Joint Domain Data Compiler / Analysis Report</div>
  <h1>${escapeHtml(title)}</h1>
  <p class="lede">A local, evidence-based snapshot of loaded trajectory data, source references, quality signals, bookmarks, and recorded transformations. See the report scope below for exactly what is included. Verify conclusions against source data and metadata.</p>
  <div class="status-rail">
    <div class="status-item"><span class="status-label">Generated</span><span class="status-value">${escapeHtml(formatDate(generatedAt))}</span></div>
    <div class="status-item"><span class="status-label">Application</span><span class="status-value">JDDC ${escapeHtml(applicationVersion)}</span></div>
    <div class="status-item"><span class="status-label">Datasets</span><span class="status-value">${datasetCount.toLocaleString('en-US')}</span></div>
  </div>
  <svg class="vector-mark" viewBox="0 0 330 150" aria-hidden="true">
    <g fill="none" stroke="currentColor" color="#68cbd0" stroke-width="1">
      <path opacity=".35" d="M8 128L77 83l48 17 51-70 58 46 88-62"/>
      <path opacity=".16" d="M8 141h314M35 10v132M105 10v132M175 10v132M245 10v132M315 10v132"/>
      <circle cx="176" cy="30" r="14"/><path d="M176 8v44M154 30h44"/>
      <circle cx="77" cy="83" r="4" fill="#86e8b2" stroke="#86e8b2"/>
      <circle cx="234" cy="76" r="4" fill="#86e8b2" stroke="#86e8b2"/>
    </g>
  </svg>
</header>`
}

/**
 * Mandatory "Included evidence" / "Not included" scope block. Always
 * rendered (it is not itself an optional section) and driven entirely by
 * which options are enabled, so a reader never has to infer what was left
 * out from absence alone.
 */
function buildScopeSection(options: ReportOptions): string {
  const included = REPORT_SECTIONS.filter((section) => options[section.key])
  const excluded = REPORT_SECTIONS.filter((section) => !options[section.key])
  return `<section class="scope-block" aria-label="Report scope">
<h2>Report scope</h2>
<p class="scope-lede">This report includes only the evidence explicitly enabled below. Nothing outside this list was calculated, checked, or implied — verify all figures against source data.</p>
<div class="scope-columns">
<div><h3>Included evidence</h3>${included.length > 0 ? bareList(included.map((section) => section.label)) : `<p class="empty">No optional evidence sections were enabled.</p>`}</div>
<div><h3>Not included</h3>${excluded.length > 0 ? bareList(excluded.map((section) => section.label)) : `<p class="empty">All optional evidence sections were enabled.</p>`}</div>
</div>
</section>`
}

function buildOverviewSection(datasetCount: number, totalPoints: number, totalDistanceMeters: number, totalEvents: number): string {
  return `<div class="overview-grid" aria-label="Report summary">
  ${metric('Datasets', datasetCount.toLocaleString('en-US'), 'overview-card')}
  ${metric('Total points', totalPoints.toLocaleString('en-US'), 'overview-card')}
  ${metric('Track distance', `${formatNumber(totalDistanceMeters / 1000)} km`, 'overview-card')}
  ${metric('Quality events', totalEvents.toLocaleString('en-US'), 'overview-card')}
</div>`
}

function buildDatasetSection(dataset: Dataset, bookmarks: readonly ProjectBookmark[], operations: readonly OperationRecord[], index: number, options: ReportOptions): string {
  const stats = computeStats(dataset)
  const events = detectQualityEvents(dataset.points)
  const eventCounts = new Map<string, number>()
  for (const event of events) eventCounts.set(event.kind, (eventCounts.get(event.kind) ?? 0) + 1)

  return `<section class="dataset">
<div class="dataset-heading"><span class="dataset-index">${String(index + 1).padStart(2, '0')}</span><h2>${escapeHtml(dataset.name)}</h2><span class="dataset-format">${escapeHtml(dataset.sourceFormat.toUpperCase())}</span></div>
<div class="metric-grid">
${metric('Format', dataset.sourceFormat.toUpperCase())}
${metric('Points', stats.pointCount.toLocaleString('en-US'))}
${metric('Valid coordinates', stats.validCoordCount.toLocaleString('en-US'))}
${metric('Distance', `${formatNumber(stats.distanceMeters / 1000)} km`)}
${metric('Duration', formatDuration(stats.durationMs))}
${metric('Quality events', events.length.toLocaleString('en-US'))}
</div>
${options.includeSourceMetadata ? buildSourceMetadataTable(dataset, stats.bounds) : ''}
${options.includeQualityEvents ? listSection('Quality events', [...eventCounts].map(([kind, count]) => `${kind}: ${count}`), 'No quality events detected with the default thresholds.') : ''}
${options.includeWarnings ? listSection('Import warnings', dataset.warnings, 'No parser warnings.') : ''}
${options.includeOperationHistory ? listSection('Transform history', operations.map((operation) => `${formatDate(operation.createdAt)} — ${operation.summary}`), 'No transforms recorded in this session.') : ''}
${options.includeBookmarks ? listSection('Bookmarks', bookmarks.map((bookmark) => `${bookmark.label} — point ${bookmark.pointIndex ?? 'n/a'}${bookmark.note ? ` — ${bookmark.note}` : ''}`), 'No bookmarks.') : ''}
</section>`
}

function buildSourceMetadataTable(dataset: Dataset, bounds: ReturnType<typeof computeStats>['bounds']): string {
  const metadata = dataset.metadata
  const boundsText = bounds
    ? `${formatNumber(bounds.minLat)}, ${formatNumber(bounds.minLon)} to ${formatNumber(bounds.maxLat)}, ${formatNumber(bounds.maxLon)}`
    : 'Unavailable'
  return `<h3>Source and references</h3>
<table><tbody>
${row('Source file', metadata?.source.filename ?? 'Unavailable')}
${row('Source checksum', metadata?.source.checksum ? `SHA-256 ${metadata.source.checksum}` : 'Unavailable')}
${row('Parser', metadata ? `${metadata.source.parserId} ${metadata.source.parserVersion}` : 'Unavailable')}
${row('Coordinate system', metadata?.coordinateSystem ?? 'Unknown')}
${row('Altitude reference', metadata?.altitudeReference ?? 'UNKNOWN')}
${row('Time reference', metadata?.timeReference ?? 'UNKNOWN')}
${row('Bounds', boundsText)}
</tbody></table>`
}

function buildComparisonSection(options: ReportOptions, comparison: ReportComparisonSummary | undefined): string {
  if (!options.includeComparison) return ''
  if (!comparison) {
    return sectionWrapper('Cross-dataset comparison', `<p class="empty">Comparison was enabled, but no comparison data was supplied for this report.</p>`)
  }
  if (comparison.error) {
    return sectionWrapper('Cross-dataset comparison', `<p class="empty">${escapeHtml(comparison.referenceDatasetName)} vs ${escapeHtml(comparison.targetDatasetName)}: ${escapeHtml(comparison.error)}</p>`)
  }
  return sectionWrapper('Cross-dataset comparison', `<table><tbody>
${row('Reference dataset', comparison.referenceDatasetName)}
${row('Target dataset', comparison.targetDatasetName)}
${row('Aligned samples', comparison.sampleCount.toLocaleString('en-US'))}
${row('Minimum range', comparison.minRangeMeters !== undefined ? `${formatNumber(comparison.minRangeMeters)} m` : 'Unavailable')}
${row('Maximum range', comparison.maxRangeMeters !== undefined ? `${formatNumber(comparison.maxRangeMeters)} m` : 'Unavailable')}
${row('Mean range', comparison.meanRangeMeters !== undefined ? `${formatNumber(comparison.meanRangeMeters)} m` : 'Unavailable')}
${row('Mean horizontal range', comparison.meanHorizontalRangeMeters !== undefined ? `${formatNumber(comparison.meanHorizontalRangeMeters)} m` : 'Unavailable')}
${row('Mean closure rate', comparison.meanClosureRateMps !== undefined ? `${formatNumber(comparison.meanClosureRateMps)} m/s` : 'Unavailable')}
</tbody></table>`)
}

function buildFusionSection(options: ReportOptions, fusion: FusionReport | undefined): string {
  if (!options.includeFusion) return ''
  if (!fusion || fusion.sourceSummaries.length === 0) {
    return sectionWrapper('Fusion decisions', `<p class="empty">Fusion evidence was enabled, but no fusion report was supplied for this report.</p>`)
  }
  const rows = fusion.sourceSummaries.map((summary) => row(`${summary.label} (${summary.sourceId})`, `${summary.chosenCount.toLocaleString('en-US')} chosen, ${summary.skippedCount.toLocaleString('en-US')} skipped`)).join('')
  return sectionWrapper('Fusion decisions', `<table><tbody>
${row('Total candidate groups', fusion.totalGroups.toLocaleString('en-US'))}
${row('Mean confidence', fusion.meanConfidence.toFixed(3))}
${rows}
</tbody></table>`)
}

function buildNotionalDisclosureSection(options: ReportOptions, datasets: readonly Dataset[]): string {
  if (!options.includeNotionalDisclosure) return ''
  const perDataset = datasets.map((dataset) => {
    const notionalCount = dataset.points.filter((point) => point.ext?.notional === true || point.provenance?.qualityFlags?.includes('notional')).length
    return `${dataset.name}: ${notionalCount.toLocaleString('en-US')} of ${dataset.points.length.toLocaleString('en-US')} point(s)`
  })
  const totalNotional = datasets.reduce((sum, dataset) => sum + dataset.points.filter((point) => point.ext?.notional === true || point.provenance?.qualityFlags?.includes('notional')).length, 0)
  const notice = totalNotional > 0
    ? `<p class="empty">This report contains ${totalNotional.toLocaleString('en-US')} notional/derived point(s) — synthetic samples interpolated to fill time gaps. They are not observed telemetry and are flagged in provenance; do not treat them as source measurements.</p>`
    : `<p class="empty">No notional/derived points were present in the datasets included in this report. All plotted points are as-observed from source.</p>`
  return sectionWrapper('Notional / derived-data disclosure', `${notice}${perDataset.length > 0 ? bareList(perDataset) : ''}`)
}

function buildOverlayInventorySection(options: ReportOptions, overlays: readonly ReportOverlayEntry[] | undefined): string {
  if (!options.includeOverlayInventory) return ''
  if (!overlays || overlays.length === 0) {
    return sectionWrapper('Map overlay inventory', `<p class="empty">No map overlays were active in this session.</p>`)
  }
  return sectionWrapper('Map overlay inventory', bareList(overlays.map((overlay) => `${overlay.name} (${overlay.sourceKind}) — ${overlay.visible ? 'visible' : 'hidden'}`)))
}

function buildFooterSection(): string {
  return `<footer class="report-footer"><span>Generated locally by Joint Domain Data Compiler</span><span>Source-aware / User-verifiable</span></footer>`
}

// --- Shared render helpers ------------------------------------------------

function sectionWrapper(title: string, bodyHtml: string): string {
  return `<section class="dataset"><h2>${escapeHtml(title)}</h2>${bodyHtml}</section>`
}

function metric(label: string, value: string, className = 'metric-card'): string {
  return `<div class="${className}"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong></div>`
}

function row(label: string, value: string): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
}

function listSection(title: string, items: readonly string[], empty: string): string {
  const body = items.length > 0
    ? `<ul class="evidence-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : `<p class="empty">${escapeHtml(empty)}</p>`
  return `<h3>${escapeHtml(title)}</h3>${body}`
}

function bareList(items: readonly string[]): string {
  return `<ul class="evidence-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
}

function formatDate(value: number): string {
  return Number.isFinite(value) ? new Date(value).toISOString() : 'Unknown'
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '—'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
