// P5 CTS mission recording: container decode, lossless round-trip, and edit tests.
//
// The guarantee these tests defend is stated in docs/P5-MSN.md §8: most of a P5
// slot record is still undecoded, so export must patch the source bytes rather
// than regenerate them, and an export with no edits must be byte-identical to
// the file that was imported. Every check below exists to keep that true.
import { buildP5Fixture, DEFAULT_FIXTURE_SLOTS } from './helpers/p5Fixture.ts'
import {
  P5_BLOCK0_BYTES,
  P5_BLOCK_BYTES,
  P5_NO_DATA_SENTINEL,
  P5_RECORD_BYTES,
  P5_SLOT_COUNT,
  P5_SUBFRAME_BYTES,
  P5_SUBFRAME_HEADER_BYTES,
  P5_SUBFRAME_TRAILER_BYTES,
  decodeP5Clock,
  encodeP5Clock,
  iterateP5Samples,
  looksLikeP5,
  p5RecordOffset,
  readP5Document,
  resolveP5MissionDate,
  setP5Participant,
  setP5SamplePosition,
  validateP5Document,
  writeP5Document,
  P5FormatError,
} from '../src/core/p5/document.ts'
import { buildResultFromDocument, parseP5, parseP5GeoReference, P5_DEFAULT_GEOREFERENCE } from '../src/core/parsers/p5.ts'
import { buildP5Export, readDatasetGeoReference } from '../src/core/exporters/p5.ts'
import { importP5File, p5DatasetLabel } from '../src/core/p5/import.ts'
import { getP5Document, p5DocumentCount, registerP5Document, releaseP5Document, retainP5Documents } from '../src/core/p5/registry.ts'
import { geodeticToEnu } from '../src/core/geodesy.ts'
import { makeDataset } from '../src/core/parsers/index.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false
  return true
}
function diffOffsets(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = []
  for (let i = 0; i < Math.max(a.byteLength, b.byteLength); i++) if (a[i] !== b[i]) out.push(i)
  return out
}

console.log('\n--- clock encoding (plain binary HH MM SS CC, not BCD) ---')
{
  const buffer = new Uint8Array(4)
  // These bytes are a valid clock under both readings — 19:34:48.69 as plain
  // binary, 13:22:30.45 as BCD — so this is the case that tells them apart.
  const nineteenThirtyFour = ((19 * 60 + 34) * 60 + 48) * 1000 + 690
  encodeP5Clock(buffer, 0, nineteenThirtyFour)
  check('19:34:48.69 encodes to 13 22 30 45 (binary, not BCD)',
    buffer[0] === 0x13 && buffer[1] === 0x22 && buffer[2] === 0x30 && buffer[3] === 0x45,
    [...buffer].map((b) => b.toString(16).padStart(2, '0')).join(' '))
  check('round-trips back to the same milliseconds', decodeP5Clock(buffer, 0) === nineteenThirtyFour)
  check('midnight wraps to 00 00 00 00', (() => { const b = new Uint8Array(4); encodeP5Clock(b, 0, 0); return b.every((x) => x === 0) })())
}

console.log('\n--- mission date resolution ---')
{
  // "04/04/26" is ambiguous MM/DD vs DD/MM; the long form has to win.
  check('long form wins over ambiguous short form',
    resolveP5MissionDate('04/04/26', '4 APR 26') === Date.UTC(2026, 3, 4))
  check('disambiguates a day > 12 correctly',
    resolveP5MissionDate('04/13/26', '13 APR 26') === Date.UTC(2026, 3, 13))
  check('falls back to the short form when the long one is blank',
    resolveP5MissionDate('12/25/26', '') === Date.UTC(2026, 11, 25))
  check('returns undefined when neither parses', resolveP5MissionDate('', '') === undefined)
}

console.log('\n--- container decode ---')
const { msn, rpt } = buildP5Fixture({ extraBlocks: 2 })
const pristine = msn.slice()
{
  check('fixture length is block0 + N full blocks', msn.byteLength === P5_BLOCK0_BYTES + 2 * P5_BLOCK_BYTES, String(msn.byteLength))
  check('looksLikeP5 accepts it', looksLikeP5(msn))
  check('looksLikeP5 rejects a short buffer', !looksLikeP5(new Uint8Array(64)))
  check('looksLikeP5 rejects a right-sized buffer with no magic', !looksLikeP5(new Uint8Array(msn.byteLength)))

  const doc = readP5Document(msn, { rpt })
  check('block count', doc.blocks.length === 3, String(doc.blocks.length))
  check('subframe count is 9 + 10N', doc.subframeCount === 29, String(doc.subframeCount))
  check('roster has 50 slots', doc.roster.length === 50)
  check('roster slot 1 decodes', doc.roster[0]?.aircraftId === '401' && doc.roster[0]?.unit === 'TESTSQA' && doc.roster[0]?.typeCode === 0x58,
    JSON.stringify(doc.roster[0]))
  check('roster keeps a callsign that ends in a space', doc.roster[2]?.callsign === 'BRAVOFLT ', JSON.stringify(doc.roster[2]?.callsign))
  check('live slots are exactly the instrumented ones', doc.liveSlots.join(',') === '1,2', doc.liveSlots.join(','))
  check('mission date resolved', doc.header.missionDateMs === Date.UTC(2026, 8, 17))
  check('no .rpt disagreement warning', doc.warnings.length === 0, doc.warnings.join(' | '))

  const report = validateP5Document(doc)
  check('validation is clean', report.errors.length === 0, report.errors.join(' | '))
  check('record count is subframes x 50', report.records === 29 * 50, String(report.records))
  check('live record count is subframes x live slots', report.liveRecords === 29 * 2, String(report.liveRecords))
  check('no clock anomalies in a synthetic recording', report.clockAnomalies === 0, String(report.clockAnomalies))
}

console.log('\n--- .rpt handling ---')
{
  const withoutIndex = readP5Document(msn.slice())
  check('block table derives from the .msnP5 alone', withoutIndex.blocks.length === 3)
  check('deriving without an index emits no warning', withoutIndex.warnings.length === 0, withoutIndex.warnings.join(' | '))

  const corrupted = rpt.slice()
  new DataView(corrupted.buffer).setUint32(0, 5, false) // claim two blocks that do not exist
  const doc = readP5Document(msn.slice(), { rpt: corrupted })
  check('a disagreeing .rpt is reported, not trusted', doc.blocks.length === 3 && doc.warnings.some((w) => w.includes('disagrees')),
    doc.warnings.join(' | '))

  const rebuilt = writeP5Document(readP5Document(msn.slice(), { rpt })).rpt
  check('rebuilt .rpt matches the source index byte for byte', equalBytes(rebuilt, rpt), `${rebuilt.byteLength} vs ${rpt.byteLength}`)
}

console.log('\n--- truncation and malformed input ---')
{
  let threw = false
  try { readP5Document(msn.slice(0, msn.byteLength - 10)) } catch (error) { threw = error instanceof P5FormatError }
  check('a truncated recording throws P5FormatError', threw)

  threw = false
  try { readP5Document(new Uint8Array(1024)) } catch (error) { threw = error instanceof P5FormatError }
  check('a buffer with no magic throws P5FormatError', threw)
}

console.log('\n--- sample iteration ---')
{
  const doc = readP5Document(msn.slice(), { rpt })
  const samples = [...iterateP5Samples(doc)]
  check('one sample per live slot per subframe', samples.length === 29 * 2, String(samples.length))
  check('samples carry their slot', samples[0]?.slot === 1 && samples[1]?.slot === 2)
  check('timestamps step by 100 ms', (samples[2]?.time ?? 0) - (samples[0]?.time ?? 0) === 100)
  check('no-data slots are never emitted', samples.every((s) => s.slot === 1 || s.slot === 2))
  check('record offsets are addressable by (subframe, slot)',
    samples.every((s) => p5RecordOffset(doc, s.subframe, s.slot) === s.recordOffset))
  check('p5RecordOffset rejects an out-of-range subframe', p5RecordOffset(doc, 29, 1) === -1)
  check('p5RecordOffset rejects an out-of-range slot', p5RecordOffset(doc, 0, 51) === -1)

  const decimated = [...iterateP5Samples(doc, { decimation: 10 })]
  check('decimation keeps one subframe in N', decimated.length === 3 * 2, String(decimated.length))
  const capped = [...iterateP5Samples(doc, { maxSamples: 7 })]
  check('maxSamples caps the walk', capped.length === 7, String(capped.length))
  const oneSlot = [...iterateP5Samples(doc, { slots: [2] })]
  check('slot filter works', oneSlot.length === 29 && oneSlot.every((s) => s.slot === 2))

  const view = new DataView(doc.bytes.buffer, doc.bytes.byteOffset, doc.bytes.byteLength)
  const deadOffset = p5RecordOffset(doc, 0, 3)
  check('a no-data record carries the 7812.4922 sentinel', view.getUint32(deadOffset + 8, false) === P5_NO_DATA_SENTINEL)
}

console.log('\n--- parse to the JDDC model ---')
{
  const result = parseP5(msn.slice(), { rpt })
  check('points cover every live sample', result.points.length === 29 * 2, String(result.points.length))
  check('raw frame values survive as channels',
    typeof result.points[0]?.ext?.p5_x === 'number' && typeof result.points[0]?.ext?.p5_z === 'number')
  check('slot is recorded on each point', result.points[0]?.ext?.p5_slot === 1)
  check('points are flagged as resting on an assumed georeference',
    result.points.every((p) => p.provenance?.qualityFlags?.includes('p5_assumed_georeference') === true))
  check('the assumption is stated as a warning', result.warnings.some((w) => w.startsWith('Coordinates are ASSUMED')))
  check('roster is carried in metadata', typeof result.meta?.p5Roster === 'string' && result.meta.p5Roster.includes('BRAVOFLT'))
  check('slot 1 and slot 2 land in different segments',
    result.points[0]?.provenance?.sourceFeatureIndex !== result.points[1]?.provenance?.sourceFeatureIndex)

  // The anchor sample must land exactly on the anchor coordinate.
  const first = result.points[0]!
  check('first sample sits on the georeference anchor',
    Math.abs(first.lat - P5_DEFAULT_GEOREFERENCE.anchorLatDeg) < 1e-9 &&
      Math.abs(first.lon - P5_DEFAULT_GEOREFERENCE.anchorLonDeg) < 1e-9,
    `${first.lat}, ${first.lon}`)

  const decimated = parseP5(msn.slice(), { rpt, decimation: 10 })
  check('decimation is surfaced as a warning', decimated.warnings.some((w) => w.includes('Decimated')))
  const capped = parseP5(msn.slice(), { rpt, maxPoints: 5 })
  check('a point cap is surfaced as a warning', capped.points.length === 5 && capped.warnings.some((w) => w.includes('Import stopped')))
}

console.log('\n--- lossless round-trip ---')
{
  const doc = readP5Document(msn.slice(), { rpt })
  const written = writeP5Document(doc)
  check('read then write with no edits is byte-identical', equalBytes(written.msn, pristine))

  const result = buildResultFromDocument(doc, { slots: [1] })
  const dataset = makeDataset('fixture', 'p5', result, msn.byteLength)
  const exported = buildP5Export(doc, { datasets: [dataset] })
  check('export of an unedited dataset writes no positions', exported.positionsWritten === 0, String(exported.positionsWritten))
  check('export of an unedited dataset is byte-identical', equalBytes(exported.msn, pristine))
  check('export reports no warnings for a clean dataset', exported.warnings.length === 0, exported.warnings.join(' | '))
}

console.log('\n--- editing roster identity ---')
{
  const doc = readP5Document(msn.slice(), { rpt })
  setP5Participant(doc, 1, { callsign: 'VENOM11', aircraftId: '001', unit: 'TESTSQ', typeCode: 0x60 })
  const reread = readP5Document(writeP5Document(doc).msn)
  check('callsign round-trips', reread.roster[0]?.callsign === 'VENOM11', reread.roster[0]?.callsign)
  check('aircraft id round-trips', reread.roster[0]?.aircraftId === '001')
  check('unit round-trips', reread.roster[0]?.unit === 'TESTSQ')
  check('type code round-trips', reread.roster[0]?.typeCode === 0x60)
  check('the undecoded per-slot id is left alone', reread.roster[0]?.reservedId === 743, String(reread.roster[0]?.reservedId))
  check('other roster slots are untouched', reread.roster[2]?.callsign === 'BRAVOFLT ')

  // A shorter value must clear the tail of the fixed-width field, not leave debris.
  setP5Participant(doc, 1, { callsign: 'A' })
  check('a shorter callsign clears the rest of the field', readP5Document(writeP5Document(doc).msn).roster[0]?.callsign === 'A')

  let threw = false
  try { setP5Participant(doc, 99, { callsign: 'X' }) } catch (error) { threw = error instanceof P5FormatError }
  check('editing a slot that does not exist throws', threw)

  threw = false
  try { setP5Participant(doc, 1, { typeCode: 512 }) } catch (error) { threw = error instanceof P5FormatError }
  check('a type code outside one byte throws', threw)
}

console.log('\n--- editing sample positions ---')
{
  const doc = readP5Document(msn.slice(), { rpt })
  const result = buildResultFromDocument(doc, { slots: [1] })
  const dataset = makeDataset('fixture', 'p5', result, msn.byteLength)

  const target = dataset.points[5]!
  target.lat += 0.01
  target.lon += 0.01
  target.ele = (target.ele ?? 0) + 500

  const exported = buildP5Export(doc, { datasets: [dataset] })
  check('exactly one record was rewritten', exported.positionsWritten === 1, String(exported.positionsWritten))
  // Only the 12 position bytes of that one record may move. Some of the twelve
  // can legitimately keep their old value, so assert the *range*, not the count.
  const editedRecord = p5RecordOffset(doc, dataset.points[5]!.provenance!.sourceRecord! - 1, 1)
  const changed = diffOffsets(exported.msn, pristine)
  check('every changed byte is inside the edited record position triple',
    changed.length > 0 && changed.every((o) => o >= editedRecord + 8 && o < editedRecord + 20),
    `${changed.length} bytes at ${changed[0]}..${changed[changed.length - 1]}, record at ${editedRecord}`)

  const reread = readP5Document(exported.msn, { rpt: exported.rpt })
  check('the edited file still validates', validateP5Document(reread).errors.length === 0)
  const rereadResult = buildResultFromDocument(reread, { slots: [1] })
  const moved = rereadResult.points[5]!
  check('the edit survives a round-trip to within float32 precision',
    Math.abs(moved.lat - target.lat) < 1e-6 && Math.abs(moved.lon - target.lon) < 1e-6 && Math.abs((moved.ele ?? 0) - (target.ele ?? 0)) < 0.05,
    `${moved.lat - target.lat}, ${moved.lon - target.lon}, ${(moved.ele ?? 0) - (target.ele ?? 0)}`)
  check('neighbouring samples are untouched',
    rereadResult.points[4]!.lat === result.points[4]!.lat && rereadResult.points[6]!.lon === result.points[6]!.lon)

  // A zero metres-per-unit scale divides to Infinity on the way back into frame
  // units; that must never reach the file.
  const liveOffset = p5RecordOffset(reread, 0, 1)
  for (const bad of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
    let rejected = false
    try { setP5SamplePosition(reread, liveOffset, { x: bad }) } catch (error) { rejected = error instanceof P5FormatError }
    check(`writing ${bad} into a slot record is refused`, rejected)
  }
  check('the record survived the refused writes',
    Number.isFinite(new DataView(reread.bytes.buffer, reread.bytes.byteOffset, reread.bytes.byteLength).getFloat32(liveOffset + 8, false)))

  // Promoting a no-data record to live would mean inventing 72 undecoded bytes.
  let threw = false
  try { setP5SamplePosition(reread, p5RecordOffset(reread, 0, 3), { x: 1 }) } catch (error) { threw = error instanceof P5FormatError }
  check('writing into a no-data record is refused', threw)
}

console.log('\n--- every modification the format cannot represent is reported ---')
{
  // The failure mode this guards against is a modification that neither reaches
  // the file nor produces a warning: the user believes it was saved, and it was
  // not. Each case below must warn.
  const warnFor = (mutate: (dataset: ReturnType<typeof makeDataset>) => void) => {
    const doc = readP5Document(msn.slice(), { rpt })
    const dataset = makeDataset('fixture', 'p5', buildResultFromDocument(doc, { slots: [1] }), msn.byteLength)
    mutate(dataset)
    return buildP5Export(doc, { datasets: [dataset] })
  }

  const deleted = warnFor((d) => { d.points.splice(3, 4) })
  check('deleted points are reported, not silently kept',
    deleted.warnings.some((w) => w.includes('no longer in this dataset')), deleted.warnings.join(' | '))
  check('deleting points writes nothing', deleted.positionsWritten === 0)

  const retimed = warnFor((d) => { d.points[2]!.time = (d.points[2]!.time ?? 0) + 5_000 })
  check('an edited timestamp is reported as unwritable',
    retimed.warnings.some((w) => w.includes('timestamp that differs')), retimed.warnings.join(' | '))

  const rawEdited = warnFor((d) => { d.points[4]!.ext!.p5_x = 12345 })
  check('a directly edited raw frame channel is reported',
    rawEdited.warnings.some((w) => w.includes('p5_x/p5_y/p5_z')), rawEdited.warnings.join(' | '))

  const duplicated = warnFor((d) => { d.points.push({ ...d.points[1]! }) })
  check('two points claiming one record are reported',
    duplicated.warnings.some((w) => w.includes('another point already claimed')), duplicated.warnings.join(' | '))

  // The false-positive trap: a decimated import legitimately covers fewer
  // records, and that must not read as a deletion.
  const doc = readP5Document(msn.slice(), { rpt })
  const decimated = makeDataset('decimated', 'p5', buildResultFromDocument(doc, { slots: [1], decimation: 5 }), msn.byteLength)
  const decimatedExport = buildP5Export(doc, { datasets: [decimated] })
  check('a decimated import is not mistaken for deleted points',
    !decimatedExport.warnings.some((w) => w.includes('no longer in this dataset')), decimatedExport.warnings.join(' | '))

  // An untouched dataset must produce no warnings at all, or the signal is noise.
  const clean = makeDataset('clean', 'p5', buildResultFromDocument(doc, { slots: [1] }), msn.byteLength)
  check('an untouched dataset warns about nothing',
    buildP5Export(doc, { datasets: [clean] }).warnings.length === 0)
}

console.log('\n--- a georeference from outside this process is validated ---')
{
  // ARCHITECTURE.md §10.6: boundary input arrives as unknown and is rejected
  // loudly. A restored project manifest is exactly that.
  const valid = { anchorLatDeg: 39.4, anchorLonDeg: -118.7, anchorHeightM: 1199, horizontalUnitMeters: 30.48, verticalUnitMeters: 1, axisOrder: 'x-east' }
  check('a well-formed georeference is accepted', parseP5GeoReference(valid) !== null)
  check('it is accepted as a JSON string too', parseP5GeoReference(JSON.stringify(valid)) !== null)
  for (const [name, bad] of [
    ['a zero horizontal scale', { ...valid, horizontalUnitMeters: 0 }],
    ['a negative vertical scale', { ...valid, verticalUnitMeters: -1 }],
    ['a NaN scale', { ...valid, horizontalUnitMeters: Number.NaN }],
    ['an out-of-range latitude', { ...valid, anchorLatDeg: 91 }],
    ['an out-of-range longitude', { ...valid, anchorLonDeg: -181 }],
    ['a string where a number belongs', { ...valid, anchorHeightM: '1199' }],
    ['an unknown axis order', { ...valid, axisOrder: 'z-east' }],
    ['a partial anchor triple', { ...valid, anchorX: 1, anchorY: 2 }],
  ] as [string, unknown][]) {
    check(`${name} is rejected`, parseP5GeoReference(bad) === null)
  }
  check('malformed JSON is rejected', parseP5GeoReference('{not json') === null)
  check('null is rejected', parseP5GeoReference(null) === null)
  check('a complete anchor triple survives', parseP5GeoReference({ ...valid, anchorX: 1, anchorY: 2, anchorZ: 3 })?.anchorZ === 3)
}

console.log('\n--- reference metadata is not fabricated ---')
{
  const result = parseP5(msn.slice(), { rpt })
  check('time reference is UNKNOWN, not assumed UTC', result.timeReference === 'UNKNOWN')
  check('altitude reference is UNKNOWN, not assumed HAE', result.altitudeReference === 'UNKNOWN')
  check('and the reason is stated', result.warnings.some((w) => w.includes('Time base is UNKNOWN')))
}

console.log('\n--- points that cannot be addressed ---')
{
  const doc = readP5Document(msn.slice(), { rpt })
  const result = buildResultFromDocument(doc, { slots: [1] })
  const dataset = makeDataset('fixture', 'p5', result, msn.byteLength)
  dataset.points.push({ lat: 39.5, lon: -118.6, ele: 2000 })
  const exported = buildP5Export(doc, { datasets: [dataset] })
  check('a point with no P5 provenance is skipped, not guessed',
    exported.warnings.some((w) => w.includes('could not be matched')), exported.warnings.join(' | '))
  check('the recording is still byte-identical', equalBytes(exported.msn, pristine))
}

console.log('\n--- a recording with no live slots ---')
{
  const empty = buildP5Fixture({ extraBlocks: 1, slots: DEFAULT_FIXTURE_SLOTS.map((s) => ({ ...s, live: false })) })
  const result = parseP5(empty.msn, { rpt: empty.rpt })
  check('produces no points', result.points.length === 0)
  check('says so in a warning', result.warnings.some((w) => w.includes('only configuration')), result.warnings.join(' | '))
}

console.log('\n--- one frame anchor per recording, not per track ---')
{
  // Each live slot becomes its own Dataset, but they all describe positions in
  // ONE range frame. If each track anchored on its own first sample, every track
  // would be dragged onto the same starting coordinate and the formation
  // geometry between them would be destroyed — and, because the panel exports
  // every track under the first one's georeference, an export with no edits
  // would rewrite every sample of every other track.
  const doc = readP5Document(msn.slice(), { rpt })
  const slot1 = buildResultFromDocument(doc, { slots: [1] })
  const slot2 = buildResultFromDocument(doc, { slots: [2] })
  const geo1 = JSON.parse(slot1.meta!.p5GeoReference!) as Record<string, number>
  const geo2 = JSON.parse(slot2.meta!.p5GeoReference!) as Record<string, number>
  check('both tracks record the same frame anchor',
    geo1.anchorX === geo2.anchorX && geo1.anchorY === geo2.anchorY && geo1.anchorZ === geo2.anchorZ,
    `slot1 ${geo1.anchorX},${geo1.anchorY},${geo1.anchorZ} vs slot2 ${geo2.anchorX},${geo2.anchorY},${geo2.anchorZ}`)

  // The fixture puts slot 2 ten frame units east of slot 1; at the default
  // 30.48 m/unit that is 304.8 m and it has to survive into the output.
  const a = slot1.points[0]!
  const b = slot2.points[0]!
  const separation = geodeticToEnu(
    { latDeg: b.lat, lonDeg: b.lon, heightM: b.ele ?? 0 },
    { latDeg: a.lat, lonDeg: a.lon, heightM: a.ele ?? 0 },
  )
  check('the offset between two tracks survives georeferencing',
    Math.abs(Math.hypot(separation.eastM, separation.northM) - 10 * 30.48) < 0.5,
    `${Math.hypot(separation.eastM, separation.northM).toFixed(2)} m, expected 304.80 m`)

  // The shape the UI actually calls: every track of the recording exported
  // together, nothing edited.
  const datasets = [makeDataset('slot1', 'p5', slot1, msn.byteLength), makeDataset('slot2', 'p5', slot2, msn.byteLength)]
  const exported = buildP5Export(doc, { datasets })
  check('exporting every track of a recording unedited writes nothing',
    exported.positionsWritten === 0, String(exported.positionsWritten))
  check('exporting every track of a recording unedited is byte-identical', equalBytes(exported.msn, pristine))
}

console.log('\n--- .teq companion ---')
{
  // A real .teq is a preallocated 220,000-byte file with a header and nothing else.
  const teq = new Uint8Array(220_000)
  teq.set([0x05, 0x01, 0x03, 0x00, 0x09, 0x0f, 0x1e, 0x00], 0)
  const doc = readP5Document(msn.slice(), { rpt, teq })
  check('a matching .teq is accepted without warnings', doc.warnings.length === 0, doc.warnings.join(' | '))
  const written = writeP5Document(doc)
  check('the .teq is carried through write unchanged', !!written.teq && equalBytes(written.teq, teq))
  const exported = buildP5Export(doc, {})
  check('the .teq is emitted by export', !!exported.teq && equalBytes(exported.teq, teq))
  check('export with no .teq reports none', buildP5Export(readP5Document(msn.slice(), { rpt }), {}).teq === undefined)

  const mismatched = teq.slice()
  mismatched[4] = 0x0b // 11:15:30 instead of the recording's 09:15:30
  check('a .teq from another mission is flagged',
    readP5Document(msn.slice(), { rpt, teq: mismatched }).warnings.some((w) => w.includes('different mission start time')))
}

console.log('\n--- track labels are unique per slot ---')
{
  // Two roster slots can legitimately carry the same callsign and aircraft id;
  // the label feeds the dataset id, so it has to stay distinct.
  check('label includes the slot number', p5DatasetLabel('m.msnP5', { slot: 7, callsign: 'ALPHA', aircraftId: '401' }) === 'm.msnP5 — slot 7 ALPHA 401')
  check('identical identity in two slots yields different labels',
    p5DatasetLabel('m.msnP5', { slot: 1, callsign: 'ALPHA', aircraftId: '401' }) !==
      p5DatasetLabel('m.msnP5', { slot: 7, callsign: 'ALPHA', aircraftId: '401' }))
  check('a blank identity still labels by slot', p5DatasetLabel('m.msnP5', { slot: 3, callsign: '', aircraftId: '' }) === 'm.msnP5 — slot 3')
  check('no participant falls back to the filename', p5DatasetLabel('m.msnP5', undefined) === 'm.msnP5')
}

console.log('\n--- an explicit slot selection is honoured even when empty ---')
{
  // Asking for a slot that never reports must yield nothing. Falling back to
  // "every live slot" here would hand the caller another aircraft's track under
  // the label of the one they asked for.
  const doc = readP5Document(msn.slice(), { rpt })
  check('asking for a slot that never reports yields no samples',
    [...iterateP5Samples(doc, { slots: [3] })].length === 0)
  check('an explicitly empty selection yields no samples',
    [...iterateP5Samples(doc, { slots: [] })].length === 0)
  check('an absent selection still means every live slot',
    [...iterateP5Samples(doc, {})].length === 29 * 2)
  check('the parser agrees', buildResultFromDocument(doc, { slots: [3] }).points.length === 0)
}

console.log('\n--- roster edits are validated and applied all-or-nothing ---')
{
  const doc = readP5Document(msn.slice(), { rpt })
  const before = doc.roster.map((p) => ({ ...p }))

  let threw = false
  try { setP5Participant(doc, 1, { callsign: 'CALLSIGN\u00e9' }) } catch (error) { threw = error instanceof P5FormatError }
  check('a non-ASCII character is refused rather than silently truncated', threw)
  check('the refused edit changed nothing', doc.roster[0]?.callsign === before[0]?.callsign)

  threw = false
  try { setP5Participant(doc, 1, { aircraftId: 'TOO-LONG-FOR-EIGHT' }) } catch (error) { threw = error instanceof P5FormatError }
  check('an over-long value is refused rather than truncated', threw)

  // A batch where the second edit is invalid must leave the first unapplied.
  threw = false
  try {
    buildP5Export(doc, { roster: [{ slot: 1, callsign: 'GOOD' }, { slot: 2, typeCode: 999 }] })
  } catch (error) {
    threw = error instanceof P5FormatError
  }
  check('an invalid batch is rejected whole', threw)
  check('no slot of the rejected batch was written',
    doc.roster[0]?.callsign === before[0]?.callsign && doc.roster[1]?.callsign === before[1]?.callsign)
  check('a valid batch still applies', (() => {
    buildP5Export(doc, { roster: [{ slot: 1, callsign: 'GOOD' }, { slot: 2, typeCode: 0x61 }] })
    return doc.roster[0]?.callsign === 'GOOD' && doc.roster[1]?.typeCode === 0x61
  })())
}

console.log('\n--- a dataset with no recorded georeference is skipped, not guessed ---')
{
  const doc = readP5Document(msn.slice(), { rpt })
  const dataset = makeDataset('stripped', 'p5', buildResultFromDocument(doc, { slots: [1] }), msn.byteLength)
  check('a dataset built by the parser carries one', readDatasetGeoReference(dataset) !== null)
  delete dataset.metadata!.meta!.p5GeoReference
  check('a dataset without one reads as null', readDatasetGeoReference(dataset) === null)
  const exported = buildP5Export(doc, { datasets: [dataset] })
  check('its points are not written', exported.positionsWritten === 0)
  check('and the recording is untouched', equalBytes(exported.msn, pristine))
  check('and the reason is reported',
    exported.warnings.some((w) => w.includes('no usable P5 georeference')), exported.warnings.join(' | '))
}

console.log('\n--- importP5File: the path the app actually takes ---')
{
  // Everything above exercises the codec directly. This is the entry point the
  // UI calls, and it owns the fan-out, the document registration and the point
  // budget — logic nothing else covers.
  const asFile = (bytes: Uint8Array, name = 'recording.msnP5') => new File([bytes as unknown as BlobPart], name)

  const imported = await importP5File(asFile(msn.slice()), { rpt, teq: undefined })
  check('one dataset per live slot', imported.datasets.length === 2, String(imported.datasets.length))
  check('every dataset is tagged as P5', imported.datasets.every((d) => d.sourceFormat === 'p5'))
  check('each dataset names its own slot',
    imported.datasets.map((d) => d.metadata?.meta?.p5Slots).join('|') === '1|2',
    imported.datasets.map((d) => d.metadata?.meta?.p5Slots).join('|'))
  check('datasets share one document key',
    new Set(imported.datasets.map((d) => d.metadata?.meta?.p5DocumentKey)).size === 1)
  check('the document is registered under that key',
    getP5Document(imported.documentKey) === imported.document)
  check('dataset ids are distinct', imported.datasets[0]!.id !== imported.datasets[1]!.id)
  check('the source filename is recorded for later relabelling',
    imported.datasets.every((d) => d.metadata?.meta?.p5SourceFilename === 'recording.msnP5'))

  const merged = await importP5File(asFile(msn.slice()), { rpt, splitSlots: false })
  check('splitSlots:false yields a single combined track', merged.datasets.length === 1)
  check('the combined track holds both slots', merged.datasets[0]!.points.length === 29 * 2)

  // The budget is a ceiling on the recording, not on each track, and it
  // truncates rather than throwing — a 450 MB file is this format's normal case.
  const capped = await importP5File(asFile(msn.slice()), { rpt, maxPoints: 40 })
  check('the point budget spans the whole recording, not each track',
    capped.datasets.reduce((total, d) => total + d.points.length, 0) === 40,
    String(capped.datasets.reduce((total, d) => total + d.points.length, 0)))
  check('a truncated track says so', capped.datasets.some((d) => d.warnings.some((w) => w.includes('Import stopped'))))

  // A recording with nothing instrumented must produce no tracks at all, so the
  // caller can say "configuration only" instead of showing an empty track.
  const empty = buildP5Fixture({ extraBlocks: 1, slots: DEFAULT_FIXTURE_SLOTS.map((slot) => ({ ...slot, live: false })) })
  const none = await importP5File(asFile(empty.msn, 'empty.msnP5'), { rpt: empty.rpt })
  check('a recording with no live slots yields no datasets', none.datasets.length === 0, String(none.datasets.length))

  retainP5Documents([])
}

console.log('\n--- the document registry ---')
{
  const doc = readP5Document(msn.slice(), { rpt })
  const before = p5DocumentCount()
  registerP5Document('audit-a', doc)
  registerP5Document('audit-b', doc)
  check('registered documents are retrievable', getP5Document('audit-a') === doc)
  check('count reflects registrations', p5DocumentCount() === before + 2)
  releaseP5Document('audit-a')
  check('release drops one', getP5Document('audit-a') === undefined && p5DocumentCount() === before + 1)
  retainP5Documents([])
  check('retain([]) drops everything', p5DocumentCount() === 0 && getP5Document('audit-b') === undefined)
}

console.log('\n--- subframe geometry constants ---')
{
  check('a subframe is header + 50 records + trailer',
    P5_SUBFRAME_BYTES === P5_SUBFRAME_HEADER_BYTES + P5_SLOT_COUNT * P5_RECORD_BYTES + P5_SUBFRAME_TRAILER_BYTES)
  check('a block is 12 + 10 subframes', P5_BLOCK_BYTES === 12 + 10 * P5_SUBFRAME_BYTES)
  check('block 0 is 12 + config + 9 subframes', P5_BLOCK0_BYTES === 12 + 16332 + 9 * P5_SUBFRAME_BYTES)
}

console.log(`\n${failures === 0 ? 'ALL P5 FORMAT CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
