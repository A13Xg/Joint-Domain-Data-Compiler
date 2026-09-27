import { matchShortcut, shortcutBlocksBrowserDefault, shortcutSuppressed, type ShortcutKey } from '../src/ui/shortcuts.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const key = (k: string, mods: Partial<ShortcutKey> = {}): ShortcutKey => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods })

check('Ctrl+S saves', matchShortcut(key('s', { ctrlKey: true })) === 'save')
check('⌘S saves too', matchShortcut(key('s', { metaKey: true })) === 'save')
check('Ctrl+O opens', matchShortcut(key('o', { ctrlKey: true })) === 'open')
check('Ctrl+Z undoes', matchShortcut(key('z', { ctrlKey: true })) === 'undo')
check('Ctrl+Shift+Z redoes (key reported upper-case with Shift)', matchShortcut(key('Z', { ctrlKey: true, shiftKey: true })) === 'redo')
check('Ctrl+Y redoes', matchShortcut(key('y', { ctrlKey: true })) === 'redo')
check('Caps Lock does not change Ctrl+S', matchShortcut(key('S', { ctrlKey: true })) === 'save')
check('F1 opens the guide', matchShortcut(key('F1')) === 'guide')
check('a plain letter is not a shortcut', matchShortcut(key('s')) === null)
check('Alt combinations are left to the system', matchShortcut(key('s', { ctrlKey: true, altKey: true })) === null)
check('Ctrl+Shift+S is not claimed', matchShortcut(key('S', { ctrlKey: true, shiftKey: true })) === null)
check('? alone is never a shortcut (it is typed)', matchShortcut(key('?', { shiftKey: true })) === null)

const noModal = { querySelector: () => null }
const withModal = { querySelector: (selector: string) => (selector === '[aria-modal="true"]' ? ({} as Element) : null) }
const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, ...extra }) as unknown as EventTarget
check('a text field keeps its own undo', shortcutSuppressed('undo', el('INPUT', { type: 'text' }), noModal))
check('a number field keeps its own redo', shortcutSuppressed('redo', el('INPUT', { type: 'number' }), noModal))
check('a textarea keeps its own undo', shortcutSuppressed('undo', el('TEXTAREA'), noModal))
check('save still works while typing in a field (notes, then Ctrl+S)', !shortcutSuppressed('save', el('TEXTAREA'), noModal))
check('open and help still work while typing in a field', !shortcutSuppressed('open', el('INPUT', { type: 'text' }), noModal) && !shortcutSuppressed('guide', el('INPUT', { type: 'text' }), noModal))
check('a checkbox with focus does not block undo', !shortcutSuppressed('undo', el('INPUT', { type: 'checkbox' }), noModal))
check('a focused button does not block undo', !shortcutSuppressed('undo', el('BUTTON'), noModal))
check('an open modal blocks every action', (['save', 'open', 'undo', 'redo', 'guide'] as const).every((action) => shortcutSuppressed(action, el('BUTTON'), withModal)))
check('no target is fine', !shortcutSuppressed('undo', null, noModal))
check("the browser's Save Page / Open File / Help never run", shortcutBlocksBrowserDefault('save') && shortcutBlocksBrowserDefault('open') && shortcutBlocksBrowserDefault('guide'))
check("the browser's own undo in a field is left alone", !shortcutBlocksBrowserDefault('undo') && !shortcutBlocksBrowserDefault('redo'))

console.log(`\n${failures === 0 ? 'ALL SHORTCUT CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
