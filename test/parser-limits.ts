// Task 2.1: per-format import budgets, source checksums, and content-signature
// mismatch warnings.
import { DOMParser } from 'linkedom'
;(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser

import {
  assertByteBudget,
  assertPointBudget,
  FormatBudgetExceededError,
  type FormatBudget,
} from '../src/core/parsers/limits.ts'
import {
  describeSignatureMismatch,
  sniffBinarySignature,
  sniffTextSignature,
} from '../src/core/parsers/contentSignature.ts'
import { sha256Hex } from '../src/core/checksum.ts'
import { detectFormat, parseFileToDataset } from '../src/core/parsers/index.ts'
import { buildGpb } from '../src/core/parsers/gpb.ts'
import type { SourceFormat } from '../src/core/model.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}
async function checkAsync(name: string, fn: () => Promise<boolean>): Promise<void> {
  try {
    check(name, await fn())
  } catch (err) {
    failures++
    console.log(`  [FAIL] ${name} — threw ${(err as Error).message}`)
  }
}

const tinyBudgets: Record<SourceFormat, FormatBudget> = {
  csv: { maxBytes: 100, maxPoints: 10 },
  gpx: { maxBytes: 100, maxPoints: 10 },
  geojson: { maxBytes: 100, maxPoints: 10 },
  kml: { maxBytes: 100, maxPoints: 10 },
  nmea: { maxBytes: 100, maxPoints: 10 },
  gpb: { maxBytes: 100, maxPoints: 10 },
  unknown: { maxBytes: 100, maxPoints: 10 },
}

// --- Budgets -----------------------------------------------------------
check('Byte budget passes under the limit', (() => {
  try { assertByteBudget('csv', 50, tinyBudgets); return true } catch { return false }
})())

let byteRejected = false
let byteMessage = ''
try {
  assertByteBudget('csv', 500, tinyBudgets)
} catch (err) {
  byteRejected = err instanceof FormatBudgetExceededError
  byteMessage = (err as Error).message
}
check('Byte budget rejects an oversized file', byteRejected, byteMessage)
check('Byte budget message is actionable', /CSV/.test(byteMessage) && /limit/i.test(byteMessage))

let pointRejected = false
try {
  assertPointBudget('gpx', 11, tinyBudgets)
} catch (err) {
  pointRejected = err instanceof FormatBudgetExceededError
}
check('Point budget rejects an oversized point count', pointRejected)
check('Point budget passes under the limit', (() => {
  try { assertPointBudget('gpx', 5, tinyBudgets); return true } catch { return false }
})())

// --- Checksums -----------------------------------------------------------
await checkAsync('SHA-256 matches known digest for "abc"', async () => {
  const digest = await sha256Hex(new TextEncoder().encode('abc'))
  return digest === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
})
await checkAsync('SHA-256 is deterministic across calls', async () => {
  const bytes = new TextEncoder().encode('joint domain data compiler')
  const a = await sha256Hex(bytes)
  const b = await sha256Hex(bytes)
  return a === b && /^[0-9a-f]{64}$/.test(a)
})

// --- Content signature sniffing ------------------------------------------
check('Sniffs GPX content', sniffTextSignature('<?xml version="1.0"?>\n<gpx version="1.1"><trk/></gpx>') === 'gpx')
check('Sniffs KML content', sniffTextSignature('<?xml version="1.0"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"></kml>') === 'kml')
check('Sniffs GeoJSON content', sniffTextSignature('{"type":"FeatureCollection","features":[]}') === 'geojson')
check('Sniffs NMEA content', sniffTextSignature('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47') === 'nmea')
check('Sniffs CSV content', sniffTextSignature('lat,lon,ele\n1,2,3\n') === 'csv')
check('Unknown text yields unknown signature', sniffTextSignature('just some plain notes') === 'unknown')
check('Sniffs GPB binary magic', sniffBinarySignature(new Uint8Array(buildGpb('t', [{ lat: 1, lon: 2 }], []))) === 'gpb')
check('Non-GPB bytes sniff as unknown', sniffBinarySignature(new Uint8Array([1, 2, 3, 4])) === 'unknown')

check('No mismatch when signature matches declared format', describeSignatureMismatch('gpx', 'gpx') === null)
check('No mismatch when signature is unknown', describeSignatureMismatch('gpx', 'unknown') === null)
const mismatch = describeSignatureMismatch('gpx', 'kml')
check('Mismatch reported when content disagrees with extension', mismatch !== null && /GPX/.test(mismatch!) && /KML/.test(mismatch!))

// --- Integration through parseFileToDataset -------------------------------
const gpxText = `<?xml version="1.0"?>\n<gpx version="1.1"><trk><trkseg>` +
  `<trkpt lat="47.6" lon="-122.3"><ele>10</ele><time>2024-01-01T00:00:00Z</time></trkpt>` +
  `<trkpt lat="47.601" lon="-122.301"><ele>11</ele><time>2024-01-01T00:00:01Z</time></trkpt>` +
  `</trkseg></trk></gpx>`
const gpxFile = new File([gpxText], 'track.gpx', { type: 'application/gpx+xml' })
const gpxFormat = detectFormat('track.gpx')!
const gpxDataset = await parseFileToDataset(gpxFile, gpxFormat)
check('Parsed GPX dataset carries a checksum', /^[0-9a-f]{64}$/.test(gpxDataset.metadata?.source.checksum ?? ''))
check('Parsed GPX dataset records byte length', gpxDataset.metadata?.source.byteLength === gpxFile.size)
check('Parsed GPX dataset has no false mismatch warning', !gpxDataset.warnings.some((w) => /looks like/i.test(w)))

const mislabeledKml = `<?xml version="1.0"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><Point><coordinates>-122.3,47.6,10</coordinates></Point></Placemark></kml>`
const mislabeledFile = new File([mislabeledKml], 'track.gpx', { type: 'application/gpx+xml' })
const mislabeledDataset = await parseFileToDataset(mislabeledFile, gpxFormat)
check(
  'Content sniffing flags a KML file mislabeled as .gpx',
  mislabeledDataset.warnings.some((w) => /looks like KML/i.test(w)),
  mislabeledDataset.warnings.join('; '),
)

let budgetErrorSurfaced = false
let budgetErrorMessage = ''
try {
  assertPointBudget('gpx', 5, { ...tinyBudgets, gpx: { maxBytes: 10_000, maxPoints: 2 } })
} catch (err) {
  budgetErrorSurfaced = err instanceof FormatBudgetExceededError
  budgetErrorMessage = (err as Error).message
}
check('Point budget assertion is reusable with a custom budget table', budgetErrorSurfaced, budgetErrorMessage)

console.log(`\n${failures === 0 ? 'ALL PARSER LIMIT/CHECKSUM/SIGNATURE CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
