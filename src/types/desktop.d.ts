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
  /** Opens the packaged user guide in an app window; resolves with the URL loaded. */
  openUserGuide?: () => Promise<string>
  /** Renders a generated HTML report to PDF and asks where to save it; null when cancelled. */
  saveReportPdf?: (html: string, suggestedName: string) => Promise<string | null>
  /** Hands the unsaved-changes flag to the main process, which owns the close prompt. */
  setUnsavedChanges?: (dirty: boolean) => void
  /** Reports that the workbench has mounted, retiring the launch splash. */
  notifyRendererReady?: () => void
  /** Opens (or focuses) the Playback/Graph window and delivers a gzip .jddc-playback archive to it. */
  launchSuiteApp?: (appType: 'playback' | 'graph', bytes: ArrayBuffer) => Promise<void>
}

declare global {
  interface Window {
    jointDomainCompiler?: JointDomainCompilerDesktopApi
  }
}

export {}
