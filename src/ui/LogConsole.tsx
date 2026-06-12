// Live structured log console. Subscribes to the singleton logger, supports
// level filtering, text search, autoscroll, and export — built for engineers who
// want to see exactly what the pipeline did.
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

export function LogConsole() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [minLevel, setMinLevel] = useState<LogLevel>('debug')
  const [query, setQuery] = useState('')
  const [autoscroll, setAutoscroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => logger.subscribe((next) => setEntries([...next])), [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (LEVEL_RANK[e.level] < LEVEL_RANK[minLevel]) return false
      if (q && !`${e.category} ${e.message}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [entries, minLevel, query])

  useEffect(() => {
    if (autoscroll) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [filtered, autoscroll])

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

  return (
    <div className="log-console">
      <div className="log-toolbar">
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
      <div className="log-stream mono">
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
        <div ref={bottomRef} />
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
