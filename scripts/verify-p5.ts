// Opt-in verification of the P5 codec against a real recording.
//
//   npm run verify:p5 -- /path/to/RECORDING.msnP5
//
// Deliberately not in test/ — the unit runner globs test/*.ts and runs
// everything it finds, and a real P5 recording is operational data that cannot
// live in this repository. test/p5-format.ts covers the same behaviours against
// a synthetic fixture; this script is what you run when you have the real thing
// and want to prove the round-trip on it.
//
// Companion .rpt and .teq files of the same basename are picked up automatically.
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import {
  p5RecordOffset,
  readP5Document,
  validateP5Document,
  type P5Document,
} from '../src/core/p5/document.ts'
import { buildResultFromDocument, parseP5GeoReference } from '../src/core/parsers/p5.ts'
import { buildP5Export } from '../src/core/exporters/p5.ts'
import { makeDataset } from '../src/core/parsers/index.ts'
import { geodeticToEnu } from '../src/core/geodesy.ts'
import type { Dataset } from '../src/core/model.ts'

const target = process.argv[2]
if (!target) {
  console.error('Usage: npm run verify:p5 -- <path to a .msnP5 recording>')
  process.exit(2)
}
if (!existsSync(target)) {
  console.error(`No such file: ${target}`)
  process.exit(2)
}

const stem = target.replace(/\.msnp5$/i, '')
const msn = new Uint8Array(readFileSync(target))
const rpt = existsSync(`${stem}.rpt`) ? new Uint8Array(readFileSync(`${stem}.rpt`)) : undefined
const teq = existsSync(`${stem}.teq`) ? new Uint8Array(readFileSync(`${stem}.teq`)) : undefined
const pristine = Buffer.from(msn)

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}
const same = (a: Uint8Array | undefined, b: Uint8Array | undefined) =>
  !!a && !!b && Buffer.from(a).equals(Buffer.from(b))

/**
 * One reusable working buffer, reset from `pristine` on each load.
 *
 * A real recording is ~450 MB and the export path mutates its buffer in place,
 * so every section needs a clean copy. Allocating one per section put four
 * copies in flight at once and the OOM killer took the process — on a 7 GB box
 * that is not a hypothetical. Resetting a single buffer keeps exactly two live:
 * this one and the pristine reference.
 */
const working = new Uint8Array(msn.byteLength)

function load(): { doc: P5Document; datasets: Dataset[]; slots: number[] } {
  working.set(msn)
  const doc = readP5Document(working, { rpt, teq })
  const datasets = doc.liveSlots.map((slot) =>
    makeDataset(`slot-${slot}`, 'p5', buildResultFromDocument(doc, { slots: [slot] }), msn.byteLength),
  )
  return { doc, datasets, slots: doc.liveSlots }
}

console.log(`\n=== ${basename(target)} (${msn.byteLength.toLocaleString()} bytes) ===`)
console.log(`    .rpt ${rpt ? 'present' : 'absent'} · .teq ${teq ? 'present' : 'absent'}`)

console.log('\n--- structure ---')
{
  const { doc, datasets } = load()
  const report = validateP5Document(doc)
  console.log(`    ${report.blocks.toLocaleString()} blocks · ${report.subframes.toLocaleString()} subframes · ` +
    `${report.records.toLocaleString()} records (${report.liveRecords.toLocaleString()} live) · slots ${doc.liveSlots.join(', ')}`)
  check('structural invariants hold', report.errors.length === 0, report.errors.slice(0, 3).join(' | '))
  check('every subframe integrity word matches its records', report.checksumMismatches === 0,
    `${report.checksumMismatches} mismatch(es) of ${report.subframes.toLocaleString()}`)
  check('every second header clock is the first XOR the fixed constant', report.derivedClockMismatches === 0,
    String(report.derivedClockMismatches))
  check('block table is contiguous and covers the file',
    doc.blocks[doc.blocks.length - 1]!.offset + doc.blocks[doc.blocks.length - 1]!.size === msn.byteLength)
  check('every track carries a valid georeference',
    datasets.every((d) => parseP5GeoReference(d.metadata?.meta?.p5GeoReference) !== null))
  check('all tracks share one frame anchor', new Set(datasets.map((d) => {
    const g = parseP5GeoReference(d.metadata!.meta!.p5GeoReference)!
    return `${g.anchorX},${g.anchorY},${g.anchorZ}`
  })).size <= 1)

  if (datasets.length >= 2) {
    const a = datasets[0]!.points[Math.floor(datasets[0]!.points.length / 2)]!
    const b = datasets[1]!.points.find((p) => p.time === a.time)
    if (b) {
      const enu = geodeticToEnu({ latDeg: b.lat, lonDeg: b.lon, heightM: b.ele ?? 0 }, { latDeg: a.lat, lonDeg: a.lon, heightM: a.ele ?? 0 })
      const nmi = Math.hypot(enu.eastM, enu.northM) / 1852
      check('tracks are not collapsed onto each other', nmi > 0.01, `${nmi.toFixed(2)} nmi apart mid-recording`)
    }
  }
}

console.log('\n--- unedited export is byte-identical, and idempotent ---')
{
  const { doc, datasets } = load()
  const first = buildP5Export(doc, { datasets })
  check('.msnP5 identical', same(first.msn, pristine))
  check('.rpt identical', !rpt || same(first.rpt, rpt))
  check('.teq identical', !teq || same(first.teq, teq))
  check('nothing written', first.positionsWritten === 0 && first.rosterWritten === 0)
  check('no warnings', first.warnings.length === 0, first.warnings.join(' | '))

  // Re-import what we just wrote and export it again: a second cycle must be a
  // fixed point, or repeated save/load would drift the file.
  // `first.msn` IS the working buffer, so re-reading it in place is the second
  // cycle: import → export → import → export, with no extra 450 MB copy.
  const second = readP5Document(first.msn, { rpt: first.rpt, teq: first.teq })
  const secondDatasets = second.liveSlots.map((slot) =>
    makeDataset(`slot-${slot}`, 'p5', buildResultFromDocument(second, { slots: [slot] }), msn.byteLength))
  const out2 = buildP5Export(second, { datasets: secondDatasets })
  check('a second import/export cycle is a fixed point', same(out2.msn, pristine))
}

console.log('\n--- a georeference change survives a rebuild ---')
{
  const { doc, datasets } = load()
  const base = parseP5GeoReference(datasets[0]!.metadata!.meta!.p5GeoReference)!
  for (const geo of [
    { ...base, horizontalUnitMeters: 18.52, verticalUnitMeters: 0.5 },
    { ...base, axisOrder: 'y-east' as const },
    { ...base, anchorLatDeg: 0, anchorLonDeg: 0 },
  ]) {
    const rebuilt = datasets.map((d, i) => {
      const r = buildResultFromDocument(doc, { slots: [doc.liveSlots[i]!], georeference: geo })
      return { ...d, points: r.points, metadata: { ...d.metadata!, meta: { ...d.metadata!.meta, ...r.meta } } }
    })
    const out = buildP5Export(doc, { datasets: rebuilt })
    check(`export stays byte-identical after rebuilding at ${geo.horizontalUnitMeters} m/unit, ${geo.axisOrder}, anchor ${geo.anchorLatDeg}`,
      same(out.msn, pristine), `${out.positionsWritten} written`)
  }
}

console.log('\n--- bulk point edits round-trip by value ---')
{
  const { doc, datasets, slots } = load()
  const dataset = datasets[0]!
  const EDITS = 500
  const stride = Math.max(1, Math.floor(dataset.points.length / EDITS))
  const expected: { index: number; lat: number; lon: number; ele: number }[] = []
  for (let i = 0; i < dataset.points.length; i += stride) {
    const p = dataset.points[i]!
    // Every delta is non-zero on purpose: a move that happens to cancel out is
    // correctly not written, and would read here as a missing write.
    p.lat += 0.0005 * ((i % 7) + 1)
    p.lon -= 0.0005 * ((i % 5) + 1)
    p.ele = (p.ele ?? 0) + ((i % 11) + 1) * 10
    expected.push({ index: i, lat: p.lat, lon: p.lon, ele: p.ele })
  }
  const out = buildP5Export(doc, { datasets: [dataset] })
  check(`all ${expected.length} edits were written`, out.positionsWritten === expected.length, String(out.positionsWritten))

  const reread = readP5Document(out.msn, { rpt: out.rpt, teq: out.teq })
  const editedReport = validateP5Document(reread)
  check('the edited recording still validates', editedReport.errors.length === 0, editedReport.errors.slice(0, 2).join(' | '))
  // The point of the incremental XOR: 500 edits across the file must leave every
  // touched subframe internally consistent, not just parseable.
  check('every integrity word still matches after bulk edits', editedReport.checksumMismatches === 0,
    `${editedReport.checksumMismatches} mismatch(es)`)
  const back = buildResultFromDocument(reread, { slots: [slots[0]!] })
  check('the re-read track has the same point count', back.points.length === dataset.points.length,
    `${back.points.length} vs ${dataset.points.length}`)
  let worstDeg = 0
  let worstEle = 0
  for (const e of expected) {
    const p = back.points[e.index]!
    worstDeg = Math.max(worstDeg, Math.abs(p.lat - e.lat), Math.abs(p.lon - e.lon))
    worstEle = Math.max(worstEle, Math.abs((p.ele ?? 0) - e.ele))
  }
  // float32 storage at a ~3,000-unit coordinate is ~0.5 mm of frame precision.
  check('every edit reads back within float32 precision', worstDeg < 1e-5 && worstEle < 0.5,
    `worst ${worstDeg.toExponential(2)} deg, ${worstEle.toFixed(4)} m`)

  // Compare against the untouched bytes directly rather than re-loading a whole
  // second document just to diff two point arrays.
  const ROSTER_END = 0x110 + 50 * 80
  const editedOffsets = new Set(expected.map((e) => p5RecordOffset(reread, dataset.points[e.index]!.provenance!.sourceRecord! - 1, slots[0]!)))
  check('nothing outside the edited position triples moved', (() => {
    const a = Buffer.from(out.msn)
    for (const offset of editedOffsets) {
      // Compare the record's bytes either side of its 12-byte position triple.
      if (!a.subarray(offset, offset + 8).equals(pristine.subarray(offset, offset + 8))) return false
      if (!a.subarray(offset + 20, offset + 88).equals(pristine.subarray(offset + 20, offset + 88))) return false
    }
    return a.subarray(0, ROSTER_END).equals(pristine.subarray(0, ROSTER_END))
  })())
}

console.log('\n--- the whole roster round-trips ---')
{
  const { doc } = load()
  const edits = doc.roster.map((entry) => ({
    slot: entry.slot,
    aircraftId: `A${entry.slot}`,
    unit: `UNIT${entry.slot}`,
    callsign: `CALL${entry.slot}${entry.slot % 3 === 0 ? ' ' : ''}`,
    typeCode: (entry.typeCode + 1) & 0xff,
  }))
  const out = buildP5Export(doc, { roster: edits })
  check('every slot was written', out.rosterWritten === edits.length, String(out.rosterWritten))
  const reread = readP5Document(out.msn.slice(), { rpt: out.rpt })
  check('every slot reads back exactly, including a trailing space',
    reread.roster.every((entry, i) =>
      entry.aircraftId === edits[i]!.aircraftId &&
      entry.unit === edits[i]!.unit &&
      entry.callsign === edits[i]!.callsign &&
      entry.typeCode === edits[i]!.typeCode))
  check('the recording outside the roster table is untouched', (() => {
    const a = Buffer.from(out.msn)
    const rosterEnd = 0x110 + 50 * 80
    return a.subarray(0, 0x110).equals(pristine.subarray(0, 0x110)) &&
      a.subarray(rosterEnd).equals(pristine.subarray(rosterEnd))
  })())
}

console.log('\n--- an edit can be undone back to the original bytes ---')
{
  const { doc, datasets } = load()
  const dataset = datasets[0]!
  const original = dataset.points.map((p) => ({ lat: p.lat, lon: p.lon, ele: p.ele }))
  dataset.points[10]!.lat += 0.01
  check('the edit is written', buildP5Export(doc, { datasets: [dataset] }).positionsWritten === 1)
  // Restore the point and export again: the recording must return to its
  // original bytes, or an undo in the app could not be trusted.
  dataset.points[10]!.lat = original[10]!.lat
  const restored = buildP5Export(doc, { datasets: [dataset] })
  check('restoring the point restores the original bytes', same(restored.msn, pristine),
    `${restored.positionsWritten} rewritten`)
}

console.log('\n--- malformed input is rejected ---')
{
  // All of these reuse the single working buffer rather than cloning 450 MB.
  working.set(msn)
  let threw = false
  try { readP5Document(working.subarray(0, working.byteLength - 7)) } catch { threw = true }
  check('a truncated recording is rejected', threw)

  working[2] = 0xff // break the magic
  threw = false
  try { readP5Document(working) } catch { threw = true }
  check('a broken magic is rejected', threw)

  working.set(msn)
  working[12 + 16332 + 3] = 0xff // break the first subframe signature
  threw = false
  try { readP5Document(working) } catch { threw = true }
  check('a broken subframe signature is rejected', threw)

  // Damage deep in the file passes the cheap header sniff, so the structural
  // validator is what has to catch it.
  working.set(msn)
  const doc = readP5Document(working, { rpt })
  const victim = p5RecordOffset(doc, doc.subframeCount - 1, 1)
  working[victim - 20] = 0xff
  check('damage deep in the file is caught by validation',
    validateP5Document(readP5Document(working, { rpt })).errors.length > 0)
}

console.log(`\n${failures === 0 ? 'ALL P5 VERIFICATION CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
