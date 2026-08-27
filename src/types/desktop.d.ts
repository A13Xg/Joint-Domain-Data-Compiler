export interface KmlLibraryEntry {
  name: string
  bytes: number
  modifiedAt: number
  kind: 'kml' | 'kmz'
}

export interface KmlTextResult {
  text: string
  entryName: string
  modifiedAt: number
}

export interface JointDomainCompilerDesktopApi {
  platform: string
  isDesktop: boolean
  kmlLibrary?: {
    list: () => Promise<KmlLibraryEntry[]>
    save: (name: string, bytes: ArrayBuffer) => Promise<KmlLibraryEntry>
    readText: (name: string) => Promise<KmlTextResult>
    remove: (name: string) => Promise<boolean>
    reseed: () => Promise<string[]>
    reveal: () => Promise<string>
  }
  diagnostics?: {
    save: (text: string) => Promise<string | null>
  }
  fileArchive?: {
    save: (direction: 'inputs' | 'outputs', name: string, bytes: ArrayBuffer) => Promise<{ path: string; bytes: number }>
    reveal: () => Promise<string>
  }
  /** Hands the unsaved-changes flag to the main process, which owns the close prompt. */
  setUnsavedChanges?: (dirty: boolean) => void
}

declare global {
  interface Window {
    jointDomainCompiler?: JointDomainCompilerDesktopApi
  }
}

export {}
