import type { Dataset, TrackPoint } from '../src/core/model.ts'
import {
  buildReportComparisonSummary,
  computeComparisonSamples,
  resolveComparisonDatasetIds,
  summarizeComparisonRanges,
  type ComparisonSettings,
} from '../src/core/analytics/comparisonSummary.ts'
import { buildHtmlAnalysisReport } from '../src/core/reports/htmlReport.ts'
import { DEFAULT_REPORT_OPTIONS } from '../src/core/reports/options.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

function dataset(id: string, name: string, points: TrackPoint[], altitudeReference: 'MSL' | 'HAE' = 'MSL'): Dataset {
  return {
    id,
    name,
    sourceFormat: 'gpx',
    points,
    warnings: [],
    channels: [],
    createdAt: 1,
    metadata: {
      coordinateSystem: 'EPSG:4326',
      altitudeReference,
      timeReference: 'UTC',
      channels: [],
      source: { filename: `${id}.gpx`, importedAt: 1, checksum: id, parserId: 'gpx', parserVersion: '1' },
    },
  }
}

// Target sits directly above the reference: horizontal range is ~0 and slant
// range is the altitude separation, so the expected statistics are known by
// construction rather than read back off the implementation under test.
const referencePoints: TrackPoint[] = [
  { lat: 40, lon: -105, ele: 100, time: 1_000 },
  { lat: 40, lon: -105, ele: 100, time: 2_000 },
  { lat: 40, lon: -105, ele: 100, time: 3_000 },
]
const targetPoints: TrackPoint[] = [
  { lat: 40, lon: -105, ele: 150, time: 1_000 },
  { lat: 40, lon: -105, ele: 200, time: 2_000 },
  { lat: 40, lon: -105, ele: 250, time: 3_000 },
]

const reference = dataset('ref', 'Reference track', referencePoints)
const target = dataset('tgt', 'Target track', targetPoints)
const datasets = [reference, target]

const settings: ComparisonSettings = {
  referenceDatasetId: null,
  targetDatasetId: null,
  toleranceMs: 1_000,
  targetOffsetMs: 0,
  interpolateTarget: false,
}

// --- resolveComparisonDatasetIds: report export must pick the same pair the tab shows ---
const activeResolved = resolveComparisonDatasetIds(datasets, settings, 'tgt')
check('Unset reference falls back to the active dataset', activeResolved.referenceId === 'tgt')
check('Target falls back to the first dataset that is not the reference', activeResolved.targetId === 'ref')

const noActiveResolved = resolveComparisonDatasetIds(datasets, settings, null)
check('With no active dataset the reference falls back to the first dataset', noActiveResolved.referenceId === 'ref')
check('With no active dataset the target is still the other dataset', noActiveResolved.targetId === 'tgt')

const explicitResolved = resolveComparisonDatasetIds(datasets, { ...settings, referenceDatasetId: 'ref', targetDatasetId: 'tgt' }, 'tgt')
check('Explicit ids win over the active-dataset fallback', explicitResolved.referenceId === 'ref' && explicitResolved.targetId === 'tgt')

const emptyResolved = resolveComparisonDatasetIds([], settings, null)
check('No datasets resolves to empty ids rather than throwing', emptyResolved.referenceId === '' && emptyResolved.targetId === '')

// --- computeComparisonSamples ---
const aligned = computeComparisonSamples(reference, target, settings)
check('Aligned comparison reports no error', aligned.error === null)
check('Every reference point aligns within tolerance', aligned.samples.length === 3)
check('Vertical-only separation yields ~0 horizontal range', aligned.samples.every((sample) => Math.abs(sample.horizontalRangeM) < 0.01))
check('Slant range equals the altitude separation', Math.abs(aligned.samples[0]!.slantRangeM - 50) < 0.01)

const blocked = computeComparisonSamples(reference, dataset('hae', 'HAE track', targetPoints, 'HAE'), settings)
check('Incompatible altitude references are blocked, not silently compared', blocked.error !== null && blocked.samples.length === 0)
check('The block reason names the differing references', blocked.error?.includes('Altitude references differ') === true)

const untimed = computeComparisonSamples(reference, dataset('untimed', 'Untimed track', [{ lat: 40, lon: -105, ele: 150 }]), settings)
check('A target with no timestamps aligns nothing rather than erroring', untimed.error === null && untimed.samples.length === 0)

// --- summarizeComparisonRanges ---
const stats = summarizeComparisonRanges(aligned.samples)
check('Minimum range is the closest separation', Math.abs(stats.minRangeMeters! - 50) < 0.01)
check('Maximum range is the widest separation', Math.abs(stats.maxRangeMeters! - 150) < 0.01)
check('Mean range averages the three separations', Math.abs(stats.meanRangeMeters! - 100) < 0.01)
check('Mean horizontal range is ~0 for a vertical-only separation', Math.abs(stats.meanHorizontalRangeMeters!) < 0.01)
check('Closure rate is derived when consecutive samples are timed', stats.meanClosureRateMps !== undefined)

const emptyStats = summarizeComparisonRanges([])
check('No samples produces no fabricated statistics', Object.keys(emptyStats).length === 0)

// A long comparison must not be summarized with Math.min(...samples): the
// report path applies no sample cap, and the spread would overflow the
// argument limit long before the data became unreasonable.
const longSamples = Array.from({ length: 200_000 }, (_, index) => ({
  referenceIndex: index,
  targetIndex: index,
  referenceTimeMs: index * 1_000,
  targetTimeMs: index * 1_000,
  deltaTimeMs: 0,
  relativeEastM: 0,
  relativeNorthM: 0,
  relativeUpM: index,
  horizontalRangeM: 0,
  slantRangeM: index,
  bearingDeg: 0,
}))
let longSummarized = true
let longStats: ReturnType<typeof summarizeComparisonRanges> | null = null
try {
  longStats = summarizeComparisonRanges(longSamples)
} catch {
  longSummarized = false
}
check('A 200k-sample comparison summarizes without a call-stack overflow', longSummarized)
check('The long-comparison minimum is still correct', longStats?.minRangeMeters === 0)
check('The long-comparison maximum is still correct', longStats?.maxRangeMeters === 199_999)

// --- buildReportComparisonSummary ---
const summary = buildReportComparisonSummary(datasets, { ...settings, referenceDatasetId: 'ref', targetDatasetId: 'tgt' }, null)
check('A configured comparison produces a report summary', summary !== undefined)
check('The summary names the reference dataset', summary?.referenceDatasetName === 'Reference track')
check('The summary names the target dataset', summary?.targetDatasetName === 'Target track')
check('The summary carries the aligned sample count', summary?.sampleCount === 3)
check('The summary carries the mean range', Math.abs(summary!.meanRangeMeters! - 100) < 0.01)
check('A successful summary carries no error', summary?.error === undefined)

check('Fewer than two datasets produces no summary at all', buildReportComparisonSummary([reference], settings, null) === undefined)
check('Reference and target resolving to the same dataset produces no summary', buildReportComparisonSummary(datasets, { ...settings, referenceDatasetId: 'ref', targetDatasetId: 'ref' }, null) === undefined)

const blockedSummary = buildReportComparisonSummary([reference, dataset('hae', 'HAE track', targetPoints, 'HAE')], { ...settings, referenceDatasetId: 'ref', targetDatasetId: 'hae' }, null)
check('A blocked comparison still produces a summary rather than vanishing', blockedSummary !== undefined)
check('The blocked summary carries the error', blockedSummary?.error !== undefined)
// buildComparisonSection renders the failure as "{reference} vs {target}: {error}",
// so both names have to survive the error path or the report reads "vs : ...".
check('The blocked summary still names both datasets', blockedSummary?.referenceDatasetName === 'Reference track' && blockedSummary?.targetDatasetName === 'HAE track')

// A configured comparison that aligned nothing is reported as zero samples, not
// as "no comparison" -- the latter would render the report's "not yet captured
// in report export" placeholder, which is now untrue.
const noOverlap = dataset('late', 'Late track', [{ lat: 40, lon: -105, ele: 150, time: 9_000_000 }])
const emptySummary = buildReportComparisonSummary([reference, noOverlap], { ...settings, referenceDatasetId: 'ref', targetDatasetId: 'late' }, null)
check('A comparison that aligns nothing still produces a summary', emptySummary !== undefined)
check('An unaligned comparison reports zero samples', emptySummary?.sampleCount === 0)
check('An unaligned comparison reports no range statistics', emptySummary?.minRangeMeters === undefined && emptySummary?.meanRangeMeters === undefined)
check('An unaligned comparison is not reported as an error', emptySummary?.error === undefined)

// --- end to end: the section is no longer dead code from the caller's side ---
const reportInput = {
  title: 'Comparison report',
  generatedAt: 2_000,
  applicationVersion: '0.0.0',
  datasets,
  bookmarks: [],
  operationRecords: {},
  options: { ...DEFAULT_REPORT_OPTIONS, includeComparison: true, title: 'Comparison report' },
}
const withComparison = buildHtmlAnalysisReport({ ...reportInput, comparison: summary })
check('A wired report renders the reference dataset name', withComparison.includes('Reference track'))
check('A wired report renders the aligned sample count', withComparison.includes('Aligned samples'))
check('A wired report no longer shows the not-captured placeholder', !withComparison.includes('not yet captured in report export'))

const withoutComparison = buildHtmlAnalysisReport({ ...reportInput, comparison: undefined })
check('An unconfigured comparison still shows the placeholder', withoutComparison.includes('not yet captured in report export'))

const optionOff = buildHtmlAnalysisReport({ ...reportInput, options: { ...DEFAULT_REPORT_OPTIONS, includeComparison: false, title: 'Comparison report' }, comparison: summary })
// Matched on the section heading, not the bare phrase: the report also lists
// "Cross-dataset comparison analytics" in its included-options summary, so a
// substring check would pass for the wrong reason.
check('The comparison section stays absent when the option is off', !optionOff.includes('<h2>Cross-dataset comparison</h2>'))
check('The comparison section is present when the option is on', withComparison.includes('<h2>Cross-dataset comparison</h2>'))

console.log(`\n${failures === 0 ? 'ALL COMPARISON SUMMARY CHECKS PASSED' : `${failures} COMPARISON SUMMARY CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
