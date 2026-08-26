// Live structured log console. Subscribes to the singleton logger, supports
// level filtering, text search, autoscroll, collapse, and export — built for
// engineers who want to see exactly what the pipeline did.
import { useEffect, useMemo, useRef, useState } from 'react'
import { logger, type LogEntry, type LogLevel } from '../core/logger'

const LEVELS: LogLevel[] = ['debug', 'info', 'success', 'warn', 'error']

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  success: 25,
  warn: 30,
  error: 40,
}

interface Props {
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function LogConsole({ collapsed, onToggleCollapsed }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [minLevel, setMinLevel] = useState<LogLevel>('debug')
  const [query, setQuery] = useState('')
  const [autoscroll, setAutoscroll] = useState(true)
  const streamRef = useRef<HTMLDivElement>(null)

  useEffect(() => logger.subscribe((next) => setEntries([...next])), [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (LEVEL_RANK[e.level] < LEVEL_RANK[minLevel]) return false
      if (q && !`${e.category} ${e.message}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [entries, minLevel, query])

  // Scroll the stream itself rather than calling scrollIntoView, which walks up
  // to the nearest scrollable ancestor — and while .log-stream could not scroll
  // that was the whole page, so autoscroll silently did nothing.
  useEffect(() => {
    if (!autoscroll || collapsed) return
    const stream = streamRef.current
    if (stream) stream.scrollTop = stream.scrollHeight
  }, [filtered, autoscroll, collapsed])

  const counts = useMemo(() => {
    const c: Record<LogLevel, number> = { debug: 0, info: 0, success: 0, warn: 0, error: 0 }
    for (const e of entries) c[e.level]++
    return c
  }, [entries])

  const download = () => {
    const blob = new Blob([logger.toText()], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `jddc-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const latest = filtered[filtered.length - 1]

  if (collapsed) {
    return (
      <div className="log-collapsed-bar">
        <button type="button" className="log-collapse" onClick={onToggleCollapsed} aria-expanded={false} title="Expand the log">▲ log</button>
        {latest
          ? <>
              <span className="log-time mono">{new Date(latest.ts).toLocaleTimeString()}</span>
              <span className={`log-level log-badge-${latest.level}`}>{latest.level}</span>
              <span className="log-cat mono">{latest.category}</span>
              <span className="log-msg mono" title={latest.message}>{latest.message}</span>
            </>
          : <span className="log-collapsed-empty small">No log entries match the filter.</span>}
        <span className="log-counts">
          <span className="lc-error">{counts.error} err</span>
          <span className="lc-warn">{counts.warn} warn</span>
          <span className="lc-info">{entries.length} total</span>
        </span>
      </div>
    )
  }

  return (
    <div className="log-console">
      <div className="log-toolbar">
        <button type="button" className="log-collapse" onClick={onToggleCollapsed} aria-expanded title="Collapse the log to a single line">▼ log</button>
        <label className="log-field">
          level
          <select value={minLevel} onChange={(e) => setMinLevel(e.target.value as LogLevel)}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <input
          className="log-search"
          placeholder="filter log…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="log-checkbox">
          <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} />
          autoscroll
        </label>
        <span className="log-counts">
          <span className="lc-error">{counts.error} err</span>
          <span className="lc-warn">{counts.warn} warn</span>
          <span className="lc-info">{entries.length} total</span>
        </span>
        <div className="log-actions">
          <button type="button" onClick={download}>Export</button>
          <button type="button" onClick={() => logger.clear()}>Clear</button>
        </div>
      </div>
      <div className="log-stream mono" ref={streamRef}>
        {filtered.length === 0 && <div className="log-empty">No log entries match the filter.</div>}
        {filtered.map((e) => (
          <div key={e.id} className={`log-row log-${e.level}`}>
            <span className="log-time">{new Date(e.ts).toLocaleTimeString()}</span>
            <span className={`log-level log-badge-${e.level}`}>{e.level}</span>
            <span className="log-cat">{e.category}</span>
            <span className="log-msg">{e.message}</span>
            {e.detail !== undefined && (
              <span className="log-detail">{safeDetail(e.detail)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function safeDetail(detail: unknown): string {
  try {
    const s = typeof detail === 'string' ? detail : JSON.stringify(detail)
    return s.length > 240 ? `${s.slice(0, 240)}…` : s
  } catch {
    return String(detail)
  }
}
