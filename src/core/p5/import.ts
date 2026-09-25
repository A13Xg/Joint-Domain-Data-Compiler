// P5 import fan-out: one .msnP5 becomes one Dataset per live roster slot.
//
// The rest of the app already gives every Dataset its own colour, label,
// visibility and opacity (src/state/workspaceDisplay.ts), so splitting slots
// into separate datasets is what makes a P5 track individually stylable without
// inventing a parallel styling system. The shared source document is registered
// once and referenced by key, never copied per dataset.
import { makeDataset } from '../parsers'
import { sha256Hex } from '../checksum'
import type { Dataset } from '../model'
import { assertByteBudget, DEFAULT_FORMAT_BUDGETS } from '../parsers/limits'
import { buildResultFromDocument, type ParseP5Options } from '../parsers/p5'
import { readP5Document, type P5Document } from './document'
import { registerP5Document } from './registry'

/**
 * Display name for one P5 track. The slot number is part of the label, not
 * decoration: two roster slots can carry the same callsign and aircraft id (a
 * morning and afternoon go of the same jet), and the dataset id is derived from
 * this name — identical names would collide on import.
 */
export function p5DatasetLabel(filename: string, participant: { slot: number; callsign: string; aircraftId: string } | undefined): string {
  if (!participant) return filename
  const parts = [participant.callsign.trim(), participant.aircraftId.trim()].filter(Boolean).join(' ')
  return `${filename} — slot ${participant.slot}${parts ? ` ${parts}` : ''}`
}

export interface P5ImportResult {
  datasets: Dataset[]
  document: P5Document
  documentKey: string
}

export interface P5ImportOptions extends ParseP5Options {
  /** Emit one dataset per live slot (default) rather than a single merged track. */
  splitSlots?: boolean
  /** Companion .teq bytes, carried through export unchanged. */
  teq?: Uint8Array
}

/**
 * Read a .msnP5 (plus its optional .rpt) into datasets. The returned document is
 * registered under `documentKey`; export reaches it through the registry so the
 * source bytes stay out of the workspace state.
 */
export async function importP5File(file: File, options: P5ImportOptions = {}): Promise<P5ImportResult> {
  assertByteBudget('p5', file.size)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const checksum = await sha256Hex(bytes)
  const document = readP5Document(bytes, { rpt: options.rpt, teq: options.teq })
  const documentKey = `${checksum}:${file.name}`
  registerP5Document(documentKey, document)

  const slots = options.slots?.length
    ? options.slots.filter((slot) => document.liveSlots.includes(slot))
    : document.liveSlots

  // No live slots means no tracks — not one empty track. Returning [] here is
  // what lets the caller tell the user the recording carries only configuration.
  const groups = slots.length === 0 ? [] : options.splitSlots === false ? [slots] : slots.map((slot) => [slot])
  const datasets: Dataset[] = []
  // The point budget is a ceiling on the whole recording, not on each track: a
  // fully instrumented 50-slot file at 10 Hz is what it exists to stop, and that
  // only shows up once the per-slot totals are added together.
  //
  // Unlike the text formats, P5 truncates instead of throwing. A 450 MB
  // recording is this format's normal case rather than a sign of a runaway file,
  // so refusing the import outright would reject ordinary data; the parser warns
  // on every truncated track, and raising `maxPoints` or `decimation` reads the
  // rest.
  const pointBudget = options.maxPoints ?? DEFAULT_FORMAT_BUDGETS.p5.maxPoints
  let pointsSoFar = 0

  for (const group of groups) {
    const result = buildResultFromDocument(document, {
      ...options,
      slots: group,
      maxPoints: Math.max(0, pointBudget - pointsSoFar),
    })
    pointsSoFar += result.points.length
    const participant = group.length === 1 ? document.roster.find((p) => p.slot === group[0]) : undefined
    const dataset = makeDataset(p5DatasetLabel(file.name, participant), 'p5', result, file.size, checksum)
    dataset.metadata = {
      ...dataset.metadata!,
      meta: {
        ...(dataset.metadata?.meta ?? {}),
        p5DocumentKey: documentKey,
        p5Slots: group.join(','),
        p5SourceFilename: file.name,
      },
    }
    datasets.push(dataset)
  }

  return { datasets, document, documentKey }
}
