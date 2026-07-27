import type { KmlLibraryEntry, KmlTextResult } from '../types/desktop'

export function isDesktopKmlLibraryAvailable(): boolean {
  return Boolean(window.jointDomainCompiler?.kmlLibrary)
}

export async function listKmlLibrary(): Promise<KmlLibraryEntry[]> {
  const api = requireKmlLibrary()
  return api.list()
}

export async function saveKmlLibraryFile(file: File): Promise<KmlLibraryEntry> {
  const api = requireKmlLibrary()
  return api.save(file.name, await file.arrayBuffer())
}

export async function readKmlLibraryText(name: string): Promise<KmlTextResult> {
  const api = requireKmlLibrary()
  return api.readText(name)
}

export async function removeKmlLibraryFile(name: string): Promise<boolean> {
  const api = requireKmlLibrary()
  return api.remove(name)
}

export async function revealKmlLibrary(): Promise<string> {
  const api = requireKmlLibrary()
  return api.reveal()
}

function requireKmlLibrary(): NonNullable<NonNullable<typeof window.jointDomainCompiler>['kmlLibrary']> {
  const api = window.jointDomainCompiler?.kmlLibrary
  if (!api) throw new Error('Persistent KML/KMZ library is available only in the Electron desktop app')
  return api
}
