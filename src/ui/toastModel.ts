// Toast types and timing.
//
// Split from Toast.tsx because component files may only export components
// (react-refresh/only-export-components), and both App and the toast itself
// need these values.

export type ToastTone = 'info' | 'success' | 'warn' | 'error'

export interface ToastMessage {
  id: number
  tone: ToastTone
  message: string
  /** Optional second line: counts, a filename, a warning tally. */
  detail?: string
}

/** Errors stay longer because they usually need reading, not glancing at. */
export const TOAST_DURATION_MS: Record<ToastTone, number> = {
  info: 3600,
  success: 3600,
  warn: 6000,
  error: 9000,
}

export const TOAST_ICON: Record<ToastTone, string> = {
  info: 'i',
  success: '✓',
  warn: '!',
  error: '×',
}
