// Lightweight, dependency-free structured logger with a pub/sub ring buffer.
//
// The UI subscribes to render a live log console; parsers/transforms/exporters
// push structured entries. Designed for a technical audience: every entry carries
// a level, a category (subsystem), a message, and optional structured detail.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success'

export interface LogEntry {
  id: number
  ts: number
  level: LogLevel
  category: string
  message: string
  detail?: unknown
}

type Listener = (entries: LogEntry[]) => void

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  success: 25,
  warn: 30,
  error: 40,
}

class Logger {
  private entries: LogEntry[] = []
  private listeners = new Set<Listener>()
  private seq = 0
  private readonly capacity = 5000
  /** Minimum level retained/emitted. */
  minLevel: LogLevel = 'debug'

  private emit(level: LogLevel, category: string, message: string, detail?: unknown) {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) {
      return
    }
    const entry: LogEntry = {
      id: this.seq++,
      // monotonic counter avoids Date.now() ordering quirks; wall time approximated
      ts: this.now(),
      level,
      category,
      message,
      detail,
    }
    this.entries.push(entry)
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity)
    }
    this.notify()

    // Mirror to the dev console for engineers running with devtools open.
    const tag = `[${category}]`
    if (level === 'error') console.error('%s %s %o', tag, message, detail ?? '')
    else if (level === 'warn') console.warn('%s %s %o', tag, message, detail ?? '')
    else console.log('%s %s %o', tag, message, detail ?? '')
  }

  private now(): number {
    // Date.now is allowed in app runtime (the no-Date restriction applies to
    // workflow scripts, not the shipped product).
    try {
      return Date.now()
    } catch {
      return this.seq
    }
  }

  private notify() {
    const snapshot = this.entries
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  debug(category: string, message: string, detail?: unknown) {
    this.emit('debug', category, message, detail)
  }
  info(category: string, message: string, detail?: unknown) {
    this.emit('info', category, message, detail)
  }
  success(category: string, message: string, detail?: unknown) {
    this.emit('success', category, message, detail)
  }
  warn(category: string, message: string, detail?: unknown) {
    this.emit('warn', category, message, detail)
  }
  error(category: string, message: string, detail?: unknown) {
    this.emit('error', category, message, detail)
  }

  /** Time an async operation, logging start/finish/failure with duration. */
  async time<T>(category: string, message: string, fn: () => Promise<T>): Promise<T> {
    const start = this.now()
    this.debug(category, `${message} — started`)
    try {
      const result = await fn()
      this.success(category, `${message} — done in ${this.now() - start}ms`)
      return result
    } catch (err) {
      this.error(category, `${message} — failed after ${this.now() - start}ms`, serializeError(err))
      throw err
    }
  }

  getEntries(): LogEntry[] {
    return this.entries
  }

  clear() {
    this.entries = []
    this.notify()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.entries)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Serialize the buffer for download/export. */
  toText(): string {
    return this.entries.map(formatLogEntry).join('\n')
  }
}

/** Shared single-line rendering for a log entry, used by Logger.toText() and diagnostic bundle export. */
export function formatLogEntry(entry: LogEntry): string {
  const time = new Date(entry.ts).toISOString()
  const detail = entry.detail !== undefined ? ` ${safeJson(entry.detail)}` : ''
  return `${time} ${entry.level.toUpperCase().padEnd(7)} ${entry.category}: ${entry.message}${detail}`
}

export function serializeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack }
  }
  return { message: String(err) }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Singleton logger used throughout the app. */
export const logger = new Logger()
