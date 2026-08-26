// At-a-glance application state for the header.
//
// The header previously showed either a spinner or a dataset count, so a run
// that had logged errors looked exactly like a clean one once it finished.
// This keeps a persistent indicator: what the app is doing now, and whether
// anything went wrong getting here.

export type StatusTone = 'idle' | 'busy' | 'ok' | 'warn' | 'error'

interface Props {
  tone: StatusTone
  label: string
  detail?: string
}

const TONE_TEXT: Record<StatusTone, string> = {
  idle: 'Idle',
  busy: 'Working',
  ok: 'Healthy',
  warn: 'Warnings',
  error: 'Errors',
}

export function StatusLight({ tone, label, detail }: Props) {
  return (
    <span className={`status-light status-${tone}`} role="status" aria-live="polite">
      <span className="status-dot" aria-hidden="true" />
      <span className="status-text">
        <span className="status-label">{label}</span>
        {detail && <span className="status-detail">{detail}</span>}
      </span>
      <span className="sr-only">{TONE_TEXT[tone]}</span>
    </span>
  )
}
