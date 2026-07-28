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

console.log(`\n${failures === 0 ? 'ALL HTML REPORT CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
