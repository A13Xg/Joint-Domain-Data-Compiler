import { buildHtmlAnalysisReport } from '../src/core/reports/htmlReport.ts'
import type { Dataset } from '../src/core/model.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const dataset: Dataset = {
  id: 'dataset-1',
  name: '<script>alert("dataset")</script>',
  sourceFormat: 'gpx',
  points: [
    { lat: 40, lon: -105, ele: 100, time: 1_000 },
    { lat: 40.001, lon: -105, ele: 101, time: 10_000 },
  ],
  warnings: ['warning <unsafe>'],
  channels: [],
  createdAt: 1,
  metadata: {
    coordinateSystem: 'EPSG:4326',
    altitudeReference: 'MSL',
    timeReference: 'UTC',
    channels: [],
    source: {
      filename: 'track.gpx',
      importedAt: 1,
      checksum: 'abc123',
      parserId: 'gpx',
      parserVersion: '1',
    },
  },
}

const html = buildHtmlAnalysisReport({
  title: 'Flight <Review>',
  generatedAt: 2_000,
  applicationVersion: '0.1.0',
  datasets: [dataset],
  bookmarks: [{ id: 'b1', label: 'Interesting point', datasetId: dataset.id, pointIndex: 1 }],
  operationRecords: {
    [dataset.id]: [{
      id: 'op1',
      operationId: 'derive',
      operationVersion: 1,
      params: {},
      inputDatasetHash: 'in',
      outputDatasetHash: 'out',
      createdAt: 1_500,
      summary: 'Derived kinematics',
      warnings: [],
    }],
  },
})

check('Produces a complete HTML document', html.startsWith('<!doctype html>') && html.endsWith('</html>'))
check('Includes exact point statistics', html.includes('<strong class="metric-value">2</strong>'))
check('Includes source metadata', html.includes('SHA-256 abc123') && html.includes('EPSG:4326'))
check('Includes quality-event evidence', html.includes('gap: 1'))
check('Includes operation history', html.includes('Derived kinematics'))
check('Includes bookmarks', html.includes('Interesting point'))
check('Includes print styling', html.includes('@media print'))
check('Uses a light, low-ink report canvas', html.includes('background:#f5f4ed') && !html.includes('color-scheme:dark'))
check('Escapes report and dataset titles', html.includes('Flight &lt;Review&gt;') && html.includes('&lt;script&gt;'))
check('Does not emit executable script markup', !html.includes('<script>'))
check('Escapes warning content', html.includes('warning &lt;unsafe&gt;'))
check('Contains no classification-related wording', !/\b(?:classification|classified)\b/i.test(html))

const minimalHtml = buildHtmlAnalysisReport({
  title: 'Minimal', generatedAt: 2_000, applicationVersion: '0.1.0', datasets: [dataset], bookmarks: [], operationRecords: {},
  options: { includeQualityEvents: false, includeWarnings: false, includeOperations: false, includeBookmarks: false },
})
check('Omits disabled evidence sections', !minimalHtml.includes('Quality events</h3>') && !minimalHtml.includes('Import warnings</h3>') && !minimalHtml.includes('Transform history</h3>') && !minimalHtml.includes('Bookmarks</h3>'))
check('Discloses omitted evidence categories', (() => {
  const notIncludedBlock = minimalHtml.split('Not included')[1] ?? ''
  return notIncludedBlock.includes('Automated quality-event detection') && notIncludedBlock.includes('Import/parser warnings')
    && notIncludedBlock.includes('Recorded transform/operation history') && notIncludedBlock.includes('Bookmarks')
})())

// --- Task 3.1: mandatory scope block --------------------------------------

check('Mandatory scope block is always present', html.includes('Report scope') && html.includes('Included evidence') && html.includes('Not included'))
check('Scope block lists enabled sections as included', html.includes('Import/parser warnings') && html.includes('Bookmarks'))

const scopeDefaultHtml = buildHtmlAnalysisReport({
  title: 'Scope defaults', generatedAt: 2_000, applicationVersion: '0.1.0', datasets: [dataset], bookmarks: [], operationRecords: {},
})
check('Comparison/fusion/overlay sections default to Not included', (() => {
  const notIncludedBlock = scopeDefaultHtml.split('Not included')[1] ?? ''
  return notIncludedBlock.includes('Cross-dataset comparison analytics')
    && notIncludedBlock.includes('Multi-source fusion decisions')
    && notIncludedBlock.includes('Map overlay inventory')
})())
check('Comparison/fusion/overlay sections are not rendered by default', !scopeDefaultHtml.includes('Cross-dataset comparison</h2>') && !scopeDefaultHtml.includes('Fusion decisions</h2>') && !scopeDefaultHtml.includes('Map overlay inventory</h2>'))
check('Notional disclosure section renders by default', scopeDefaultHtml.includes('Notional / derived-data disclosure</h2>'))

// --- Task 3.1: new option-gated section builders ---------------------------

const comparisonHtml = buildHtmlAnalysisReport({
  title: 'Comparison', generatedAt: 2_000, applicationVersion: '0.1.0', datasets: [dataset], bookmarks: [], operationRecords: {},
  comparison: {
    referenceDatasetName: 'Track A',
    targetDatasetName: 'Track B',
    sampleCount: 42,
    minRangeMeters: 10,
    maxRangeMeters: 500,
    meanRangeMeters: 120,
    meanHorizontalRangeMeters: 100,
    meanClosureRateMps: -2.5,
  },
  options: { includeComparison: true },
})
check('Renders comparison section when enabled and data supplied', comparisonHtml.includes('Cross-dataset comparison</h2>') && comparisonHtml.includes('Track A') && comparisonHtml.includes('Track B') && comparisonHtml.includes('42'))

const comparisonMissingDataHtml = buildHtmlAnalysisReport({
  title: 'Comparison missing data', generatedAt: 2_000, applicationVersion: '0.1.0', datasets: [dataset], bookmarks: [], operationRecords: {},
  options: { includeComparison: true },
})
check('Comparison section reports missing data truthfully when enabled without data', comparisonMissingDataHtml.includes('no comparison data was supplied'))

const fusionHtml = buildHtmlAnalysisReport({
  title: 'Fusion', generatedAt: 2_000, applicationVersion: '0.1.0', datasets: [dataset], bookmarks: [], operationRecords: {},
  fusion: {
    generatedAt: 2_000,
    totalGroups: 10,
    meanConfidence: 0.87,
    sourceSummaries: [{ sourceId: 'src-1', label: 'Radar', chosenCount: 8, skippedCount: 2 }],
  },
  options: { includeFusion: true },
})
check('Renders fusion section when enabled and data supplied', fusionHtml.includes('Fusion decisions</h2>') && fusionHtml.includes('Radar') && fusionHtml.includes('0.870'))

const overlayHtml = buildHtmlAnalysisReport({
  title: 'Overlay', generatedAt: 2_000, applicationVersion: '0.1.0', datasets: [dataset], bookmarks: [], operationRecords: {},
  overlays: [{ id: 'ov1', name: 'Range rings', sourceKind: 'bundled', visible: true }],
  options: { includeOverlayInventory: true },
})
check('Renders overlay inventory when enabled and data supplied', overlayHtml.includes('Map overlay inventory</h2>') && overlayHtml.includes('Range rings') && overlayHtml.includes('visible'))

const notionalDataset: Dataset = {
  ...dataset,
  id: 'dataset-notional',
  points: [
    ...dataset.points,
    { lat: 40.0005, lon: -105, time: 5_000, ext: { notional: true }, provenance: { qualityFlags: ['notional'] } },
  ],
}
const notionalHtml = buildHtmlAnalysisReport({
  title: 'Notional', generatedAt: 2_000, applicationVersion: '0.1.0', datasets: [notionalDataset], bookmarks: [], operationRecords: {},
})
check('Notional disclosure reports synthetic point counts when present', notionalHtml.includes('1 notional/derived point'))

const noNotionalHtml = buildHtmlAnalysisReport({
  title: 'No notional', generatedAt: 2_000, applicationVersion: '0.1.0', datasets: [dataset], bookmarks: [], operationRecords: {},
})
check('Notional disclosure states none were present otherwise', noNotionalHtml.includes('No notional/derived points were present'))

const notionalDisabledHtml = buildHtmlAnalysisReport({
  title: 'Notional disabled', generatedAt: 2_000, applicationVersion: '0.1.0', datasets: [notionalDataset], bookmarks: [], operationRecords: {},
  options: { includeNotionalDisclosure: false },
})
check('Notional disclosure section can be disabled', !notionalDisabledHtml.includes('Notional / derived-data disclosure</h2>'))

const sourceMetadataDisabledHtml = buildHtmlAnalysisReport({
  title: 'No source metadata', generatedAt: 2_000, applicationVersion: '0.1.0', datasets: [dataset], bookmarks: [], operationRecords: {},
  options: { includeSourceMetadata: false },
})
check('Source metadata table can be disabled independently', !sourceMetadataDisabledHtml.includes('Source and references</h3>') && !sourceMetadataDisabledHtml.includes('SHA-256 abc123'))

console.log(`\n${failures === 0 ? 'ALL HTML REPORT CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
