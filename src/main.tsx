import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './index.css'
import './analysis.css'
import App from './App.tsx'
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
