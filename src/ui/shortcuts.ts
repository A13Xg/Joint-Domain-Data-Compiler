// Application keyboard shortcuts. Not a component, so it lives beside the
// panels without tripping `react-refresh/only-export-components`.
//
// The desktop build has no menu bar (Menu.setApplicationMenu(null)), so there
// were no accelerators at all: no Ctrl+S, no Ctrl+Z outside the Transform tab's
// buttons. These are the ones a desktop user reaches for without looking.

export type ShortcutAction = 'open' | 'save' | 'undo' | 'redo' | 'guide'

export interface ShortcutKey {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** Ctrl on Windows/Linux and ⌘ on macOS are both accepted, never both required. */
export function matchShortcut(event: ShortcutKey): ShortcutAction | null {
  if (event.key === 'F1' && !event.ctrlKey && !event.metaKey && !event.altKey) return 'guide'
  const command = event.ctrlKey || event.metaKey
  if (!command || event.altKey) return null
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (key === 'o' && !event.shiftKey) return 'open'
  if (key === 's' && !event.shiftKey) return 'save'
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && !event.shiftKey) return 'redo'
  return null
}

/**
 * Where a shortcut must NOT fire: while typing (a text field's own Ctrl+Z is
 * the user's undo, not the dataset's), and while a modal is open (an undo
 * landing behind a repair preview would change the track the preview is about).
 */
export function shortcutsSuppressed(target: EventTarget | null, doc: Pick<Document, 'querySelector'>): boolean {
  if (doc.querySelector('[aria-modal="true"]')) return true
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false
  const element = target as HTMLElement
  if (element.isContentEditable) return true
  if (element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') return true
  if (element.tagName === 'INPUT') {
    const type = (element as HTMLInputElement).type
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(type)
  }
  return false
}
