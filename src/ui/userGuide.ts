// Opens the bundled user guide. Not a component, so it lives beside the panels
// that call it without tripping `react-refresh/only-export-components`.
import { logger } from '../core/logger'
import { errorMessage } from '../core/errors'

/** Where the guide sits relative to the app in both builds: `dist/user-guide.html`. */
const GUIDE_PATH = 'user-guide.html'

/**
 * Electron opens the packaged copy through the main process, which resolves the
 * path itself — the renderer never names a file to open. The browser build
 * opens the same document in a named tab, so repeated presses reuse one tab
 * rather than accumulating them.
 *
 * A failure here is never worth interrupting the session for: it is logged, and
 * the caller carries on.
 */
export function openUserGuide(): void {
  const desktop = window.jointDomainCompiler?.openUserGuide
  if (desktop) {
    void desktop().catch((error: unknown) => {
      logger.warn('app', `Could not open the user guide: ${errorMessage(error)}`)
    })
    return
  }
  const opened = window.open(GUIDE_PATH, 'jddc-user-guide')
  if (!opened) logger.warn('app', 'The user guide could not be opened — a pop-up blocker may have stopped it.')
}
