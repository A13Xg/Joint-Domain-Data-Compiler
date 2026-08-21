// Best-effort duplicate of every file a user imports or exports, written
// outside the OS Downloads folder (see electron/main.cjs's fileArchiveBaseDir)
// so a moved or overwritten download doesn't lose the original data. Purely
// a safety net: a failed archive copy must never block the real
// import/export it is shadowing, so failures are logged, not thrown.
import { logger } from '../core/logger'
import { errorMessage } from '../core/errors'

export type ArchiveDirection = 'inputs' | 'outputs'

export function isDesktopArchiveAvailable(): boolean {
  return Boolean(window.jointDomainCompiler?.fileArchive)
}

export async function archiveFile(direction: ArchiveDirection, name: string, data: Blob | ArrayBuffer): Promise<void> {
  const api = window.jointDomainCompiler?.fileArchive
  if (!api) return
  try {
    const bytes = data instanceof Blob ? await data.arrayBuffer() : data
    await api.save(direction, name, bytes)
  } catch (error) {
    logger.warn('archive', `Could not save a duplicate copy of ${name}: ${errorMessage(error)}`)
  }
}

export async function revealFileArchive(): Promise<string> {
  const api = window.jointDomainCompiler?.fileArchive
  if (!api) throw new Error('The file archive is available only in the Electron desktop app')
  return api.reveal()
}
