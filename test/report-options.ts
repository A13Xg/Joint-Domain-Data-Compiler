import {
  createReportOptions,
  DEFAULT_REPORT_OPTIONS,
  DEFAULT_REPORT_TITLE,
  normalizeReportOptions,
  REPORT_SECTIONS,
} from '../src/core/reports/options.ts'
import { buildHtmlAnalysisReport } from '../src/core/reports/htmlReport.ts'
import type { Dataset } from '../src/core/model.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

// --- Default options ---------------------------------------------------

check('Default options use the default title', DEFAULT_REPORT_OPTIONS.title === DEFAULT_REPORT_TITLE)
check('Default options enable core evidence sections', DEFAULT_REPORT_OPTIONS.includeSourceMetadata && DEFAULT_REPORT_OPTIONS.includeWarnings && DEFAULT_REPORT_OPTIONS.includeQualityEvents && DEFAULT_REPORT_OPTIONS.includeBookmarks && DEFAULT_REPORT_OPTIONS.includeOperationHistory)
check('Default options enable the notional disclosure', DEFAULT_REPORT_OPTIONS.includeNotionalDisclosure === true)
check('Default options disable data-dependent sections until data is supplied', DEFAULT_REPORT_OPTIONS.includeComparison === false && DEFAULT_REPORT_OPTIONS.includeFusion === false && DEFAULT_REPORT_OPTIONS.includeOverlayInventory === false)
check('REPORT_SECTIONS enumerates exactly the boolean options', REPORT_SECTIONS.length === Object.keys(DEFAULT_REPORT_OPTIONS).length - 1)

check('createReportOptions() with no args returns the defaults', JSON.stringify(createReportOptions()) === JSON.stringify(DEFAULT_REPORT_OPTIONS))
check('createReportOptions() applies overrides', createReportOptions({ includeBookmarks: false, title: 'Custom' }).includeBookmarks === false)

// --- normalizeReportOptions: undefined/null input --------------------------

{
  const result = normalizeReportOptions(undefined)
  check('normalizeReportOptions(undefined) is valid and returns defaults', result.valid === true && result.reasons.length === 0 && result.options.title === DEFAULT_REPORT_TITLE)
}
{
  const result = normalizeReportOptions(null)
  check('normalizeReportOptions(null) is valid and returns defaults', result.valid === true && result.options.title === DEFAULT_REPORT_TITLE)
}
{
  const result = normalizeReportOptions(undefined, 'Project Alpha — Analysis')
  check('normalizeReportOptions(undefined, fallbackTitle) uses the fallback title', result.options.title === 'Project Alpha — Analysis')
}

// --- Individually toggling every section on/off -----------------------

for (const section of REPORT_SECTIONS) {
  const enabled = normalizeReportOptions({ [section.key]: true })
  const disabled = normalizeReportOptions({ [section.key]: false })
  check(`normalizeReportOptions can enable ${section.key}`, enabled.options[section.key] === true && enabled.valid === true)
  check(`normalizeReportOptions can disable ${section.key}`, disabled.options[section.key] === false && disabled.valid === true)
}

// --- Invalid/malformed persisted option restoration ------------------------

{
  const result = normalizeReportOptions('not-an-object')
  check('Non-object input is rejected and normalizes to safe defaults', result.valid === false && JSON.stringify(result.options) === JSON.stringify(DEFAULT_REPORT_OPTIONS) && result.reasons.length > 0)
}
{
  const result = normalizeReportOptions(['array', 'input'])
  check('Array input is rejected and normalizes to safe defaults', result.valid === false && result.options.includeWarnings === DEFAULT_REPORT_OPTIONS.includeWarnings)
}
{
  const result = normalizeReportOptions(42)
  check('Number input is rejected and normalizes to safe defaults', result.valid === false)
}
{
  const result = normalizeReportOptions({ includeWarnings: 'yes', includeFusion: 1, includeBookmarks: null })
  check('Wrong-typed boolean fields fall back to defaults with reasons', result.valid === false && result.options.includeWarnings === DEFAULT_REPORT_OPTIONS.includeWarnings && result.options.includeFusion === DEFAULT_REPORT_OPTIONS.includeFusion && result.options.includeBookmarks === DEFAULT_REPORT_OPTIONS.includeBookmarks && result.reasons.length >= 3)
}
{
  const result = normalizeReportOptions({ includeWarnings: false, includeBookmarks: true })
  check('Well-formed fields are preserved alongside defaults for absent fields', result.valid === true && result.options.includeWarnings === false && result.options.includeBookmarks === true && result.options.includeQualityEvents === DEFAULT_REPORT_OPTIONS.includeQualityEvents)
}
{
  const result = normalizeReportOptions({ unknownField: 'ignored', includeWarnings: true })
  check('Unknown extra fields are ignored without affecting validity', result.valid === true && result.options.includeWarnings === true)
}

// --- Hostile values ------------------------------------------------------

{
  const hostileTitle = '<img src=x onerror=alert(1)>'
  const result = normalizeReportOptions({ title: hostileTitle })
  check('normalizeReportOptions preserves hostile title text untouched at the data layer (escaping happens at render)', result.options.title === hostileTitle)
}
{
  const longTitle = 'A'.repeat(10_000)
  const result = normalizeReportOptions({ title: longTitle })
  check('Very long titles are truncated to a bounded length', result.options.title.length < 10_000 && result.options.title.length > 0 && result.valid === false)
}
{
  const result = normalizeReportOptions({ title: '   ' })
  check('Whitespace-only titles fall back to the default title', result.options.title === DEFAULT_REPORT_TITLE && result.valid === false)
}
{
  const result = normalizeReportOptions({ title: 12345 })
  check('Non-string titles fall back to the default title', result.options.title === DEFAULT_REPORT_TITLE && result.valid === false)
}

// --- HTML injection in a title must be escaped in rendered output ----------

const dataset: Dataset = {
  id: 'dataset-hostile',
  name: 'Track',
  sourceFormat: 'gpx',
  points: [{ lat: 1, lon: 1, time: 0 }],
  warnings: [],
  channels: [],
  createdAt: 0,
}

{
  const hostileTitle = '<script>alert(document.cookie)</script>'
  const html = buildHtmlAnalysisReport({
    title: hostileTitle,
    generatedAt: 0,
    applicationVersion: '0.1.0',
    datasets: [dataset],
    bookmarks: [],
    operationRecords: {},
  })
  check('HTML injection in a title is escaped in rendered report output', !html.includes('<script>alert(document.cookie)</script>') && html.includes('&lt;script&gt;'))
}

{
  const veryLongTitle = 'X'.repeat(5_000)
  const html = buildHtmlAnalysisReport({
    title: veryLongTitle,
    generatedAt: 0,
    applicationVersion: '0.1.0',
    datasets: [dataset],
    bookmarks: [],
    operationRecords: {},
  })
  check('Very long report titles do not appear unbounded in rendered output', !html.includes(veryLongTitle))
}

console.log(`\n${failures === 0 ? 'ALL REPORT OPTIONS CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
