// P5 CTS mission recording codec (.msnP5 / .rpt / .teq).
//
// Reverse-engineered; the authoritative write-up — including which byte ranges
// are confirmed, inferred, or still unknown — is docs/P5-MSN.md. Read it before
// changing anything here.
//
// The design constraint that shapes this module: most of an 88-byte slot record
// and every subframe header/trailer is still semantically unknown, so the only
// honest way to support "modify and export" is to keep the original bytes and
// patch them in place. A P5Document therefore owns the source buffer and edits
// mutate it directly; export re-emits that buffer plus a regenerated .rpt index.
// Nothing is ever synthesized from a rule we have not proven.

export const P5_BLOCK_HEADER_BYTES = 12
export const P5_SUBFRAME_BYTES = 4492
export const P5_SUBFRAME_HEADER_BYTES = 20
export const P5_SUBFRAME_TRAILER_BYTES = 72
export const P5_RECORD_BYTES = 88
export const P5_SLOT_COUNT = 50
export const P5_ROSTER_OFFSET = 0x110
export const P5_ROSTER_RECORD_BYTES = 80
export const P5_BLOCK0_CONFIG_BYTES = 16332
export const P5_BLOCK0_BYTES = 56772
export const P5_BLOCK_BYTES = 44932
/** Subframes are 10 Hz; every observed timestamp step is exactly 10 centiseconds. */
export const P5_SUBFRAME_INTERVAL_MS = 100
/** X and Y carry this value when a slot reports no data (see docs/P5-MSN.md §5.4). */
export const P5_NO_DATA_SENTINEL = 0x45f423f0

const RPT_INDEX_OFFSET = 0x0fc0
const RPT_HEADER_BYTES = RPT_INDEX_OFFSET
const SUBFRAME_SIGNATURE = [0x00, 0x00, 0x04, 0x52, 0x04, 0x01, 0x00, 0x03]

/** Slot record state word at offset 0. Non-zero means "no sample this epoch". */
export const P5_STATE_LIVE = 0x0000

export interface P5Block {
  /** Byte offset of the block in the .msnP5. */
  offset: number
  size: number
  /** Number of subframes carried by this block (9 for block 0, 10 otherwise). */
  subframeCount: number
  /** Byte offset of this block's first subframe. */
  subframeOffset: number
}

export interface P5Participant {
  /** 1-based roster slot; matches byte 7 of every slot record. */
  slot: number
  /** Byte 3 — aircraft type code. See docs/P5-MSN.md §5.6; only three values observed. */
  typeCode: number
  /** Bytes 12–19, ASCII. Tail/mod-3 style aircraft identifier. */
  aircraftId: string
  /** Bytes 20–27, ASCII. Owning squadron. */
  unit: string
  /** Bytes 28–47, ASCII. Flight callsign. */
  callsign: string
  /** Bytes 4–5. Unique per slot, meaning unknown; preserved on write. */
  reservedId: number
}

export interface P5Sample {
  slot: number
  /** Global subframe ordinal, 0-based. */
  subframe: number
  /** Epoch milliseconds (UTC), or undefined when the mission date could not be read. */
  time?: number
  /** Time of day in milliseconds, straight from the subframe clock. */
  timeOfDayMs: number
  /** Range-local frame components. Units unresolved — see docs/P5-MSN.md §6. */
  x: number
  y: number
  z: number
  /** Record offsets 20/24/28. Semantics unknown; surfaced as neutral channels. */
  fieldA: number
  fieldB: number
  fieldC: number
  /** Record offsets 32–47, eight big-endian int16. Semantics unknown. */
  ints: number[]
  /** Absolute byte offset of the record, so an edit can patch it. */
  recordOffset: number
}

export interface P5FileHeader {
  /** Bytes 0–3. 0x00000100 in every specimen. */
  magic: number
  /** Mission start, milliseconds into the day. */
  startTimeOfDayMs: number
  /** ASCII "MM/DD/YY" at offset 32. */
  dateShort: string
  /** ASCII "D MMM YY" at offset 48. */
  dateLong: string
  /** UTC midnight of the mission date, epoch ms, or undefined if unparseable. */
  missionDateMs?: number
}

export interface P5Document {
  /** The source .msnP5, owned and patched in place by the edit helpers. */
  bytes: Uint8Array
  view: DataView
  /**
   * Global subframe ordinal at which each block starts. Exists so addressing a
   * record by (subframe, slot) is a binary search rather than a walk over every
   * block — the exporter does that lookup once per point, and a linear walk over
   * ~10,000 blocks per point is several hundred million iterations on a
   * full-length recording.
   */
  blockSubframeStarts: Int32Array
  header: P5FileHeader
  blocks: P5Block[]
  roster: P5Participant[]
  /** Total subframes across all blocks. */
  subframeCount: number
  /** Roster slots that carry at least one live sample. */
  liveSlots: number[]
  /** Verbatim .rpt header bytes when one was supplied, so export can reuse them. */
  rptHeader?: Uint8Array
  /** Total length of the supplied .rpt, so a rewritten one keeps its footprint. */
  rptByteLength?: number
  /**
   * The companion .teq, carried verbatim. Every specimen seen so far is a
   * preallocated file with six non-zero bytes and no decoded record layout
   * (docs/P5-MSN.md §4), so it is transported, never interpreted — dropping it
   * would mean an exported set is no longer the set that was imported.
   */
  teq?: Uint8Array
  warnings: string[]
}

export class P5FormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'P5FormatError'
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset
  const limit = offset + length
  // Fields are NUL-padded, but a value may fill the field completely, so stop at
  // the first NUL rather than assuming one exists.
  while (end < limit && bytes[end] !== 0) end++
  let out = ''
  for (let i = offset; i < end; i++) out += String.fromCharCode(bytes[i]!)
  return out
}

/**
 * Write a fixed-width NUL-padded ASCII field, clearing the whole field first so
 * a shorter value cannot leave the tail of a longer one behind. Callers writing
 * user input validate it first (see `validateParticipantPatch`); anything
 * unrepresentable here becomes NUL rather than a mangled byte.
 */
function writeAscii(bytes: Uint8Array, offset: number, length: number, value: string): void {
  for (let i = 0; i < length; i++) {
    const code = i < value.length ? value.charCodeAt(i) : 0
    bytes[offset + i] = code > 0x1f && code < 0x7f ? code : 0
  }
}

/** Subframe clocks are plain binary HH MM SS CC bytes — explicitly not BCD. */
export function decodeP5Clock(bytes: Uint8Array, offset: number): number {
  const h = bytes[offset] ?? 0
  const m = bytes[offset + 1] ?? 0
  const s = bytes[offset + 2] ?? 0
  const cs = bytes[offset + 3] ?? 0
  return ((h * 60 + m) * 60 + s) * 1000 + cs * 10
}

export function encodeP5Clock(bytes: Uint8Array, offset: number, timeOfDayMs: number): void {
  const total = Math.round(timeOfDayMs / 10)
  const cs = total % 100
  const totalSeconds = (total - cs) / 100
  bytes[offset] = Math.floor(totalSeconds / 3600) % 24
  bytes[offset + 1] = Math.floor(totalSeconds / 60) % 60
  bytes[offset + 2] = totalSeconds % 60
  bytes[offset + 3] = cs
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/**
 * Resolve the mission date from the header's two ASCII renderings. The long form
 * ("4 APR 26") is preferred because the short form is ambiguous between
 * MM/DD/YY and DD/MM/YY on any day-of-month ≤ 12, which is a third of the year.
 */
export function resolveP5MissionDate(dateShort: string, dateLong: string): number | undefined {
  const long = /^\s*(\d{1,2})\s+([A-Z]{3})\s+(\d{2})\s*$/i.exec(dateLong.trim())
  if (long) {
    const month = MONTHS.indexOf(long[2]!.toUpperCase())
    if (month >= 0) return Date.UTC(2000 + Number(long[3]), month, Number(long[1]))
  }
  const short = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(dateShort.trim())
  if (short) return Date.UTC(2000 + Number(short[3]), Number(short[1]) - 1, Number(short[2]))
  return undefined
}

function readRptIndex(rpt: Uint8Array): { entries: { size: number; offset: number }[]; header: Uint8Array } {
  if (rpt.byteLength < RPT_HEADER_BYTES + 8) {
    throw new P5FormatError('.rpt index is too small to contain a header and one entry.')
  }
  const view = new DataView(rpt.buffer, rpt.byteOffset, rpt.byteLength)
  const count = view.getUint32(0, false)
  const needed = RPT_INDEX_OFFSET + count * 8
  if (count === 0 || needed > rpt.byteLength) {
    throw new P5FormatError(`.rpt declares ${count} blocks, which does not fit in ${rpt.byteLength} bytes.`)
  }
  const entries: { size: number; offset: number }[] = []
  for (let i = 0; i < count; i++) {
    const base = RPT_INDEX_OFFSET + i * 8
    entries.push({ size: view.getUint32(base, false), offset: view.getUint32(base + 4, false) })
  }
  return { entries, header: rpt.slice(0, RPT_HEADER_BYTES) }
}

/**
 * Derive the block table from the .msnP5 alone. The .rpt is redundant with the
 * fixed block sizes, so an import works without it; when one is supplied it is
 * cross-checked instead of trusted.
 */
function deriveBlocks(byteLength: number): { size: number; offset: number }[] {
  if (byteLength < P5_BLOCK0_BYTES) {
    throw new P5FormatError(`.msnP5 is ${byteLength} bytes, smaller than a single ${P5_BLOCK0_BYTES}-byte first block.`)
  }
  const remainder = byteLength - P5_BLOCK0_BYTES
  if (remainder % P5_BLOCK_BYTES !== 0) {
    throw new P5FormatError(
      `.msnP5 length ${byteLength} is not ${P5_BLOCK0_BYTES} + a whole number of ${P5_BLOCK_BYTES}-byte blocks ` +
        `(${remainder % P5_BLOCK_BYTES} bytes left over). The file is truncated or is not a P5 recording.`,
    )
  }
  const entries = [{ size: P5_BLOCK0_BYTES, offset: 0 }]
  let offset = P5_BLOCK0_BYTES
  for (let i = 0; i < remainder / P5_BLOCK_BYTES; i++) {
    entries.push({ size: P5_BLOCK_BYTES, offset })
    offset += P5_BLOCK_BYTES
  }
  return entries
}

export function looksLikeP5(bytes: Uint8Array): boolean {
  if (bytes.byteLength < P5_BLOCK0_BYTES) return false
  // Magic, then the first real subframe's signature at its fixed offset.
  if (!(bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00)) return false
  const sigOffset = P5_BLOCK_HEADER_BYTES + P5_BLOCK0_CONFIG_BYTES
  return SUBFRAME_SIGNATURE.every((b, i) => bytes[sigOffset + i] === b)
}

export interface ReadP5Options {
  /** Companion .rpt bytes. Optional: the block table is derivable without it. */
  rpt?: Uint8Array
  /** Companion .teq bytes, carried through export unchanged. */
  teq?: Uint8Array
}

export function readP5Document(buffer: ArrayBuffer | Uint8Array, options: ReadP5Options = {}): P5Document {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const warnings: string[] = []

  if (!looksLikeP5(bytes)) {
    throw new P5FormatError(
      'Not a P5 mission recording: expected magic 0x00000100 and a subframe signature at offset 16344. ' +
        'See docs/P5-MSN.md for the layout this parser accepts.',
    )
  }

  const derived = deriveBlocks(bytes.byteLength)
  let entries = derived
  let rptHeader: Uint8Array | undefined
  let rptByteLength: number | undefined
  if (options.rpt) {
    rptByteLength = options.rpt.byteLength
    const parsed = readRptIndex(options.rpt)
    rptHeader = parsed.header
    const mismatch =
      parsed.entries.length !== derived.length ||
      parsed.entries.some((e, i) => e.size !== derived[i]!.size || e.offset !== derived[i]!.offset)
    if (mismatch) {
      warnings.push(
        `.rpt index (${parsed.entries.length} blocks) disagrees with the .msnP5 layout (${derived.length} blocks); ` +
          'using the layout derived from the recording itself.',
      )
    } else {
      entries = parsed.entries
    }
  }

  const blocks: P5Block[] = entries.map((entry, i) => {
    const configBytes = i === 0 ? P5_BLOCK0_CONFIG_BYTES : 0
    const subframeOffset = entry.offset + P5_BLOCK_HEADER_BYTES + configBytes
    const payload = entry.size - P5_BLOCK_HEADER_BYTES - configBytes
    if (payload < 0 || payload % P5_SUBFRAME_BYTES !== 0) {
      throw new P5FormatError(`Block ${i} has a ${entry.size}-byte size that is not a whole number of subframes.`)
    }
    return { offset: entry.offset, size: entry.size, subframeCount: payload / P5_SUBFRAME_BYTES, subframeOffset }
  })

  const dateShort = ascii(bytes, 32, 8)
  const dateLong = ascii(bytes, 48, 16)
  const header: P5FileHeader = {
    magic: view.getUint32(0, false),
    startTimeOfDayMs: decodeP5Clock(bytes, 8),
    dateShort,
    dateLong,
    missionDateMs: resolveP5MissionDate(dateShort, dateLong),
  }
  if (header.missionDateMs === undefined) {
    warnings.push(`Mission date could not be read from the header ("${dateShort}" / "${dateLong}"); timestamps omitted.`)
  }

  // The .teq's only decoded field is the mission start clock it shares with the
  // .msnP5 header; a mismatch means the two files are from different missions.
  // Compared at whole-second resolution because the .teq carries no centiseconds
  // while the recording's header does.
  if (options.teq && options.teq.byteLength >= 8) {
    const teqStartSeconds = Math.floor(decodeP5Clock(options.teq, 4) / 1000)
    const headerStartSeconds = Math.floor(header.startTimeOfDayMs / 1000)
    if (teqStartSeconds !== headerStartSeconds) {
      warnings.push(
        'The .teq companion carries a different mission start time than the recording ' +
          `(${teqStartSeconds} s vs ${headerStartSeconds} s of day); it may belong to another mission.`,
      )
    }
  }

  const roster = readRoster(bytes)
  const blockSubframeStarts = new Int32Array(blocks.length)
  let runningSubframes = 0
  for (let i = 0; i < blocks.length; i++) {
    blockSubframeStarts[i] = runningSubframes
    runningSubframes += blocks[i]!.subframeCount
  }
  const subframeCount = runningSubframes

  return {
    bytes,
    view,
    blockSubframeStarts,
    header,
    blocks,
    roster,
    subframeCount,
    liveSlots: findLiveSlots({ bytes, view, blocks }),
    rptHeader,
    rptByteLength,
    teq: options.teq,
    warnings,
  }
}

function readRoster(bytes: Uint8Array): P5Participant[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const roster: P5Participant[] = []
  for (let i = 0; i < P5_SLOT_COUNT; i++) {
    const base = P5_ROSTER_OFFSET + i * P5_ROSTER_RECORD_BYTES
    roster.push({
      slot: bytes[base + 2] ?? i + 1,
      typeCode: bytes[base + 3] ?? 0,
      reservedId: view.getUint16(base + 4, false),
      aircraftId: ascii(bytes, base + 12, 8),
      unit: ascii(bytes, base + 20, 8),
      callsign: ascii(bytes, base + 28, 20),
    })
  }
  return roster
}

/**
 * Which roster slots ever report. This is a full scan on purpose: a slot can go
 * live at any point in a sortie, so a partial scan would under-report it, and
 * `iterateP5Samples` defaults its selection to this list — an incomplete answer
 * here would silently drop a whole aircraft from the import.
 */
function findLiveSlots(doc: Pick<P5Document, 'bytes' | 'view' | 'blocks'>): number[] {
  const live = new Set<number>()
  for (const block of doc.blocks) {
    for (let s = 0; s < block.subframeCount; s++) {
      const base = block.subframeOffset + s * P5_SUBFRAME_BYTES + P5_SUBFRAME_HEADER_BYTES
      for (let k = 0; k < P5_SLOT_COUNT; k++) {
        const rec = base + k * P5_RECORD_BYTES
        if (doc.view.getUint16(rec, false) === P5_STATE_LIVE) live.add(doc.bytes[rec + 7] ?? k + 1)
      }
    }
  }
  return [...live].sort((a, b) => a - b)
}

export interface IterateOptions {
  /** Restrict to these roster slots. Defaults to every live slot. */
  slots?: number[]
  /** Emit one sample every N subframes (1 = full 10 Hz). */
  decimation?: number
  /** Stop after this many samples. */
  maxSamples?: number
}

/** Walk live slot samples in mission-time order. */
export function* iterateP5Samples(doc: P5Document, options: IterateOptions = {}): Generator<P5Sample> {
  // An explicitly supplied slot list is honoured even when empty; only an absent
  // one falls back to "every slot that reports". The difference matters: asking
  // for a slot that never reports must yield nothing, not silently yield all of
  // them.
  const wanted = options.slots === undefined ? new Set(doc.liveSlots) : new Set(options.slots)
  const decimation = Math.max(1, Math.floor(options.decimation ?? 1))
  const maxSamples = options.maxSamples ?? Number.MAX_SAFE_INTEGER
  const { bytes, view } = doc
  let subframe = 0
  let emitted = 0
  let dayOffsetMs = 0
  let previousTimeOfDay = -1

  for (const block of doc.blocks) {
    for (let s = 0; s < block.subframeCount; s++, subframe++) {
      const subOffset = block.subframeOffset + s * P5_SUBFRAME_BYTES
      const timeOfDayMs = decodeP5Clock(bytes, subOffset + 8)
      // A recording that crosses midnight wraps the clock; keep timestamps monotonic.
      if (previousTimeOfDay >= 0 && timeOfDayMs < previousTimeOfDay - 12 * 3600_000) dayOffsetMs += 86_400_000
      previousTimeOfDay = timeOfDayMs
      if (subframe % decimation !== 0) continue

      const recordsBase = subOffset + P5_SUBFRAME_HEADER_BYTES
      for (let k = 0; k < P5_SLOT_COUNT; k++) {
        const rec = recordsBase + k * P5_RECORD_BYTES
        if (view.getUint16(rec, false) !== P5_STATE_LIVE) continue
        const slot = bytes[rec + 7] ?? k + 1
        if (!wanted.has(slot)) continue
        if (emitted >= maxSamples) return
        emitted++
        const ints: number[] = []
        for (let j = 0; j < 8; j++) ints.push(view.getInt16(rec + 32 + j * 2, false))
        yield {
          slot,
          subframe,
          timeOfDayMs,
          time:
            doc.header.missionDateMs === undefined
              ? undefined
              : doc.header.missionDateMs + dayOffsetMs + timeOfDayMs,
          x: view.getFloat32(rec + 8, false),
          y: view.getFloat32(rec + 12, false),
          z: view.getFloat32(rec + 16, false),
          fieldA: view.getFloat32(rec + 20, false),
          fieldB: view.getFloat32(rec + 24, false),
          fieldC: view.getFloat32(rec + 28, false),
          ints,
          recordOffset: rec,
        }
      }
    }
  }
}

/**
 * Byte offset of one slot record, addressed the way a Dataset point remembers
 * it: by global subframe ordinal and roster slot. Returns -1 when the address
 * does not exist in this recording.
 */
export function p5RecordOffset(doc: P5Document, subframe: number, slot: number): number {
  if (!Number.isInteger(subframe) || subframe < 0 || subframe >= doc.subframeCount) return -1
  if (!Number.isInteger(slot) || slot < 1 || slot > P5_SLOT_COUNT) return -1

  // Binary search for the last block whose first subframe is <= `subframe`.
  const starts = doc.blockSubframeStarts
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (starts[mid]! <= subframe) low = mid
    else high = mid - 1
  }
  const block = doc.blocks[low]
  if (!block) return -1
  const withinBlock = subframe - starts[low]!
  if (withinBlock >= block.subframeCount) return -1
  return (
    block.subframeOffset +
    withinBlock * P5_SUBFRAME_BYTES +
    P5_SUBFRAME_HEADER_BYTES +
    (slot - 1) * P5_RECORD_BYTES
  )
}

export interface ParticipantPatch {
  aircraftId?: string
  unit?: string
  callsign?: string
  typeCode?: number
}

/** Fixed byte width of each writable roster field, used to validate before writing. */
const ROSTER_FIELD_WIDTHS = { aircraftId: 8, unit: 8, callsign: 20 } as const

/**
 * Check a patch without applying it, so a batch of roster edits can be validated
 * up front and either applied whole or rejected whole. A half-applied batch would
 * leave the in-memory document in a state the UI never showed the user.
 */
export function validateParticipantPatch(slot: number, patch: ParticipantPatch): void {
  if (!Number.isInteger(slot) || slot < 1 || slot > P5_SLOT_COUNT) {
    throw new P5FormatError(`Roster slot must be 1–${P5_SLOT_COUNT}, received ${slot}.`)
  }
  for (const [field, width] of Object.entries(ROSTER_FIELD_WIDTHS) as [keyof typeof ROSTER_FIELD_WIDTHS, number][]) {
    const value = patch[field]
    if (value === undefined) continue
    if (value.length > width) {
      throw new P5FormatError(`${field} is ${value.length} characters; the field holds ${width}.`)
    }
    // The field is a fixed-width ASCII buffer NUL-padded to its width. A
    // non-ASCII character cannot be stored, and silently writing NUL in its
    // place would truncate the value on the next read.
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i)
      if (code < 0x20 || code > 0x7e) {
        throw new P5FormatError(`${field} contains a character this format cannot store (U+${code.toString(16).toUpperCase().padStart(4, '0')}); P5 roster fields are printable ASCII.`)
      }
    }
  }
  if (patch.typeCode !== undefined && (!Number.isInteger(patch.typeCode) || patch.typeCode < 0 || patch.typeCode > 255)) {
    throw new P5FormatError(`Aircraft type code must be a byte (0–255), received ${patch.typeCode}.`)
  }
}

/**
 * Patch a roster entry in place. Only the four fields whose meaning is
 * established are writable; bytes 0–11 and 48–79 are left exactly as found
 * because docs/P5-MSN.md still lists them as unknown.
 */
export function setP5Participant(doc: P5Document, slot: number, patch: ParticipantPatch): void {
  validateParticipantPatch(slot, patch)
  const index = doc.roster.findIndex((p) => p.slot === slot)
  if (index < 0) throw new P5FormatError(`Roster slot ${slot} does not exist in this recording.`)
  const base = P5_ROSTER_OFFSET + index * P5_ROSTER_RECORD_BYTES
  const entry = doc.roster[index]!

  if (patch.aircraftId !== undefined) {
    writeAscii(doc.bytes, base + 12, 8, patch.aircraftId)
    entry.aircraftId = ascii(doc.bytes, base + 12, 8)
  }
  if (patch.unit !== undefined) {
    writeAscii(doc.bytes, base + 20, 8, patch.unit)
    entry.unit = ascii(doc.bytes, base + 20, 8)
  }
  if (patch.callsign !== undefined) {
    writeAscii(doc.bytes, base + 28, 20, patch.callsign)
    entry.callsign = ascii(doc.bytes, base + 28, 20)
  }
  if (patch.typeCode !== undefined) {
    doc.bytes[base + 3] = patch.typeCode
    entry.typeCode = patch.typeCode
  }
}

/**
 * Overwrite the position triple of one already-live slot record. Writing to a
 * record whose state word says "no data" is refused: the record's other 72 bytes
 * are unknown, so a synthesized live sample would not be trustworthy.
 */
export function setP5SamplePosition(
  doc: P5Document,
  recordOffset: number,
  position: { x?: number; y?: number; z?: number },
): void {
  if (doc.view.getUint16(recordOffset, false) !== P5_STATE_LIVE) {
    throw new P5FormatError(
      `Slot record at ${recordOffset} carries no data (state ${doc.view.getUint16(recordOffset, false)}); ` +
        'P5 records cannot be promoted to live because most of the record is undocumented.',
    )
  }
  // A NaN or Infinity here would be written straight into the recording and
  // corrupt it silently — and the easiest way to produce one is a georeference
  // whose metres-per-unit scale is zero. Refuse at the point of writing, so no
  // caller can get it wrong.
  for (const [axis, value] of Object.entries(position)) {
    if (value !== undefined && !Number.isFinite(value)) {
      throw new P5FormatError(`Refusing to write a non-finite ${axis} (${value}) into a P5 slot record.`)
    }
  }
  if (position.x !== undefined) doc.view.setFloat32(recordOffset + 8, position.x, false)
  if (position.y !== undefined) doc.view.setFloat32(recordOffset + 12, position.y, false)
  if (position.z !== undefined) doc.view.setFloat32(recordOffset + 16, position.z, false)
}

/** Rebuild the .rpt block index for the current block table. */
export function buildP5Rpt(doc: P5Document): Uint8Array {
  const payloadEnd = RPT_INDEX_OFFSET + doc.blocks.length * 8
  // A real .rpt is preallocated well past its payload (the specimen writes 83,560
  // bytes into a 234,432-byte file). Keep that footprint so a rewritten index is
  // the same size as the one we read, and the trailing fill stays zero.
  const size = Math.max(doc.rptByteLength ?? 0, payloadEnd)
  const out = new Uint8Array(size)
  if (doc.rptHeader) out.set(doc.rptHeader.subarray(0, Math.min(doc.rptHeader.byteLength, size)), 0)
  const view = new DataView(out.buffer)
  view.setUint32(0, doc.blocks.length, false)
  if (!doc.rptHeader) {
    view.setUint32(4, 2, false) // constant observed in every specimen
    writeAscii(out, 8, 8, doc.header.dateShort)
    writeAscii(out, 16, 16, doc.header.dateLong)
  }
  for (let i = 0; i < doc.blocks.length; i++) {
    const base = RPT_INDEX_OFFSET + i * 8
    view.setUint32(base, doc.blocks[i]!.size, false)
    view.setUint32(base + 4, doc.blocks[i]!.offset, false)
  }
  return out
}

export interface P5WriteResult {
  msn: Uint8Array
  rpt: Uint8Array
  /** Present only when a .teq came in with the recording. */
  teq?: Uint8Array
}

/** Emit the (possibly edited) recording plus a matching .rpt index and the .teq as read. */
export function writeP5Document(doc: P5Document): P5WriteResult {
  return { msn: doc.bytes, rpt: buildP5Rpt(doc), teq: doc.teq }
}

export interface P5ValidationReport {
  blocks: number
  subframes: number
  records: number
  liveRecords: number
  errors: string[]
  /** Subframe pairs whose clocks do not differ by exactly 100 ms. */
  clockAnomalies: number
}

/**
 * Walk the structural invariants of docs/P5-MSN.md §7 that a reader can check
 * without asserting single-specimen constants: framing, the subframe signature,
 * the clock cadence, the trailer marker, slot indices and state words. The two
 * §7 items left out (the fixed header word at offset 16 and the trailer's
 * constant 64-byte tail) held one value across one recording, which is not
 * enough to reject a file over. Exposed because this is the cheapest way to tell
 * a genuine P5 recording from a file that merely has the right length.
 */
export function validateP5Document(doc: P5Document): P5ValidationReport {
  const errors: string[] = []
  const { bytes, view } = doc
  let subframes = 0
  let records = 0
  let liveRecords = 0
  let clockAnomalies = 0
  let previousClock = -1
  const note = (message: string) => {
    if (errors.length < 20) errors.push(message)
  }

  for (let b = 0; b < doc.blocks.length; b++) {
    const block = doc.blocks[b]!
    for (let s = 0; s < block.subframeCount; s++) {
      const sub = block.subframeOffset + s * P5_SUBFRAME_BYTES
      subframes++
      for (let i = 0; i < SUBFRAME_SIGNATURE.length; i++) {
        if (bytes[sub + i] !== SUBFRAME_SIGNATURE[i]) {
          note(`Block ${b} subframe ${s}: bad subframe signature.`)
          break
        }
      }
      const clock = decodeP5Clock(bytes, sub + 8)
      if (previousClock >= 0) {
        const step = (clock - previousClock + 86_400_000) % 86_400_000
        if (step !== P5_SUBFRAME_INTERVAL_MS) clockAnomalies++
      }
      previousClock = clock

      const trailer = sub + P5_SUBFRAME_HEADER_BYTES + P5_SLOT_COUNT * P5_RECORD_BYTES
      if (bytes[trailer + 4] !== 0xff || bytes[trailer + 5] !== 0 || bytes[trailer + 6] !== 0 || bytes[trailer + 7] !== 0) {
        note(`Block ${b} subframe ${s}: trailer marker is not FF000000.`)
      }

      const recordsBase = sub + P5_SUBFRAME_HEADER_BYTES
      for (let k = 0; k < P5_SLOT_COUNT; k++) {
        const rec = recordsBase + k * P5_RECORD_BYTES
        records++
        if (bytes[rec + 7] !== k + 1) note(`Block ${b} subframe ${s} slot ${k + 1}: record index byte is ${bytes[rec + 7]}.`)
        const state = view.getUint16(rec, false)
        if (state === P5_STATE_LIVE) liveRecords++
        else if (state > 2) note(`Block ${b} subframe ${s} slot ${k + 1}: unexpected state word 0x${state.toString(16)}.`)
      }
    }
  }

  return { blocks: doc.blocks.length, subframes, records, liveRecords, errors, clockAnomalies }
}
