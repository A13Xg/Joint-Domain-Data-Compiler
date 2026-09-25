// Live P5Document store.
//
// A .msnP5 is hundreds of megabytes and the only way to export it losslessly is
// to keep the original bytes and patch them (docs/P5-MSN.md §8). Putting that
// buffer in the workspace state would drag it through every render, snapshot and
// structural clone, so the document lives here, keyed by dataset id, and the
// datasets carry only the key. Entries are dropped when their datasets are.
import type { P5Document } from './document'

const documents = new Map<string, P5Document>()

export function registerP5Document(key: string, document: P5Document): void {
  documents.set(key, document)
}

export function getP5Document(key: string): P5Document | undefined {
  return documents.get(key)
}

export function releaseP5Document(key: string): void {
  documents.delete(key)
}

/** Drop every document whose key is not in `keep`. Called when datasets are removed. */
export function retainP5Documents(keep: Iterable<string>): void {
  const keepSet = new Set(keep)
  for (const key of [...documents.keys()]) {
    if (!keepSet.has(key)) documents.delete(key)
  }
}

export function p5DocumentCount(): number {
  return documents.size
}
