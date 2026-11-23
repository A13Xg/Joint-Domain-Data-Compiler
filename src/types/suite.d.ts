/** Payload shape main.cjs sends over `suite:load` — the gzip bytes of a `.jddc-playback` archive. */
export interface SuiteLoadMessage {
  format: 'jddc-playback'
  payload: Uint8Array
}

export interface JddcSuiteApi {
  isDesktop: boolean
  /** Tells the main process this window's renderer has mounted and can receive a payload. */
  ready: (appType: 'playback' | 'graph') => void
  /** Registers the callback that runs on every `suite:load` this window receives (may fire more than once). */
  onLoad: (callback: (message: SuiteLoadMessage) => void) => void
}

declare global {
  interface Window {
    jddcSuite?: JddcSuiteApi
  }
}

export {}
