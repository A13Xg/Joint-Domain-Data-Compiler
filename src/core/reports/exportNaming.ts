// Small pure helpers for the report export dialog (Task 3.2). Kept out of
// ReportExportDialog.tsx so that file exports only the component (Vite Fast
// Refresh requires component-only modules for hot reload to work).

/** Strips characters unsafe for filenames across platforms, collapsing runs to a single hyphen. */
export function sanitizeFilename(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'jddc-report'
}

/** Derives a default report title from a project/dataset name and the current date. */
export function deriveDefaultReportTitle(baseName: string, now: Date = new Date()): string {
  const trimmed = baseName.trim() || 'JDDC Analysis Report'
  return `${trimmed} — Analysis Report (${now.toISOString().slice(0, 10)})`
}
