import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { logger } from './core/logger'

// Global safety nets so nothing fails silently for a technical audience.
window.addEventListener('error', (e) => {
  logger.error('window', `Uncaught error: ${e.message}`, { filename: e.filename, line: e.lineno })
})
window.addEventListener('unhandledrejection', (e) => {
  logger.error('window', `Unhandled promise rejection: ${String(e.reason)}`)
})

logger.info('app', 'Joint Domain Data Compiler initialized')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
