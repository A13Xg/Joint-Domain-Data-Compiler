// Window-wide file drop. Not a component, so it lives beside the panels that
// use it without tripping `react-refresh/only-export-components`.
import { useEffect, useRef } from 'react'

/** Only a drag that carries files is ours; text, links and tab drags are left alone. */
export function dragCarriesFiles(types: readonly string[] | DOMStringList | null | undefined): boolean {
  if (!types) return false
  return Array.from(types as ArrayLike<string>).includes('Files')
}

/**
 * Accept files dropped anywhere in the window, not just on the Import tab's
 * drop zone.
 *
 * Without this, a file dropped on any other tab fell through to the browser,
 * which navigates to it — replacing the whole workbench, unsaved session
 * included. Every `dragover` and `drop` carrying files is therefore
 * preventDefault-ed here, and the whole FileList is handed over in ONE call so
 * the P5 .msnP5/.rpt/.teq pairing (grouped by basename across a batch) still works.
 *
 * `dragleave` fires every time the pointer crosses into a child element, so
 * the "a drag is over the window" state is an enter/leave counter, not a flag.
 */
export function useWindowFileDrop(onFiles: (files: FileList) => void, onDragActiveChange: (active: boolean) => void): void {
  const depth = useRef(0)
  const latest = useRef({ onFiles, onDragActiveChange })
  useEffect(() => { latest.current = { onFiles, onDragActiveChange } })

  useEffect(() => {
    const enter = (event: DragEvent) => {
      if (!dragCarriesFiles(event.dataTransfer?.types)) return
      event.preventDefault()
      depth.current += 1
      if (depth.current === 1) latest.current.onDragActiveChange(true)
    }
    const over = (event: DragEvent) => {
      if (!dragCarriesFiles(event.dataTransfer?.types)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const leave = (event: DragEvent) => {
      if (!dragCarriesFiles(event.dataTransfer?.types)) return
      depth.current = Math.max(0, depth.current - 1)
      // Leaving the window itself (no element to go to, pointer at or past an
      // edge) always ends the drag, however the enter/leave pairs got unbalanced.
      const leftWindow = event.relatedTarget === null && (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight)
      if (leftWindow) depth.current = 0
      if (depth.current === 0) latest.current.onDragActiveChange(false)
    }
    const drop = (event: DragEvent) => {
      if (!dragCarriesFiles(event.dataTransfer?.types)) return
      event.preventDefault()
      depth.current = 0
      latest.current.onDragActiveChange(false)
      const files = event.dataTransfer?.files
      if (files && files.length > 0) latest.current.onFiles(files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])
}
