// Saves a generated HTML report as a PDF. Not a component, so it lives beside
// the panels that call it without tripping `react-refresh/only-export-components`.
import { logger } from '../core/logger'

/**
 * Desktop: the main process renders the report to PDF and shows a save dialog
 * (resolves with the saved path, or null if the user cancelled).
 *
 * Browser: there is no PDF engine to call, so the report opens in its own tab
 * with the print dialog up — "Save as PDF" is one choice away there, and the
 * report's print stylesheet is what it prints with. Resolves with null.
 * Throws when a pop-up blocker stops the tab, so the caller can say so.
 */
export async function saveReportAsPdf(html: string, filename: string): Promise<string | null> {
  const desktop = window.jointDomainCompiler?.saveReportPdf
  if (desktop) {
    const saved = await desktop(html, filename)
    if (saved) logger.success('export', `Saved PDF report to ${saved}`)
    return saved
  }
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  const opened = window.open(url, '_blank')
  if (!opened) {
    URL.revokeObjectURL(url)
    throw new Error('The report tab was blocked by a pop-up blocker. Allow pop-ups for this page, or save as HTML and print it from the browser.')
  }
  // Same-origin blob URL, so the opener may drive its print dialog. The URL is
  // released only after the tab has loaded it.
  opened.addEventListener('load', () => {
    opened.focus()
    opened.print()
    URL.revokeObjectURL(url)
  }, { once: true })
  logger.info('export', 'Opened the report for printing — choose "Save as PDF" in the print dialog.')
  return null
}
