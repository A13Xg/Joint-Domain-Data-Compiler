import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './analysis.css'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { ConfirmProvider } from './ui/ConfirmProvider'
import { logger } from './core/logger'

window.addEventListener('error', (event) => {
  logger.error('window', `Uncaught error: ${event.message}`, { filename: event.filename, line: event.lineno })
})
window.addEventListener('unhandledrejection', (event) => {
  logger.error('window', `Unhandled promise rejection: ${String(event.reason)}`)
})

logger.info('app', 'Joint Domain Data Compiler initialized')

const root = document.getElementById('root')
if (!root) throw new Error('Application root element was not found')

// index.html renders a static skeleton into #root so the window shows
// something the instant the HTML parses, well before this module graph
// finishes downloading. Its label element survives until the render()
// call below replaces #root's children wholesale.
const loadingLabel = document.getElementById('app-loading-label')
const setLoadingLabel = (text: string) => { if (loadingLabel) loadingLabel.textContent = text }

// App.tsx is loaded dynamically rather than statically imported here. That
// makes this entry chunk small (React + the skeleton wiring above, no map,
// chart, table, or 3D code), and it turns "app is starting" into two real,
// separately-timed stages instead of one: this module already executed by
// the time the line below runs, so the label genuinely advances between a
// network+parse step that already happened and one that is about to.
setLoadingLabel('Loading workbench…')
import('./App.tsx')
  .then(({ default: App }) => {
    createRoot(root).render(
      <StrictMode>
        <ErrorBoundary>
          {/* Above App so App itself can useConfirm(); a provider rendered inside
              App would hand App's own calls the window.confirm fallback. */}
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ErrorBoundary>
      </StrictMode>,
    )
  })
  .catch((error: unknown) => {
    // ErrorBoundary can't help here -- it only catches failures from a
    // component already handed to React, and a failed dynamic import never
    // gets that far. The skeleton is still on screen, so it's what has to
    // carry the failure instead of leaving the window looking merely stuck.
    const message = error instanceof Error ? error.message : String(error)
    logger.error('app', `Failed to load the workbench: ${message}`)
    setLoadingLabel('Failed to load. Please restart the app.')
  })
