// Windowed data grid over the active track's points. Renders only the visible
// row slice so it stays smooth at hundreds of thousands of points. Supports
// column sorting and full-text filtering.
import { useMemo, useRef, useState } from 'react'
import type { TrackPoint } from '../core/model'
import { epochMsToIso } from '../core/format'

const ROW_HEIGHT = 26
const OVERSCAN = 8

type SortDir = 'asc' | 'desc' | null

interface Column {
  key: string
  label: string
  get: (p: TrackPoint) => number | string | boolean | undefined
}

export function DataTable({ points, channels }: { points: TrackPoint[]; channels: string[] }) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewportHeight = 460

  const columns = useMemo<Column[]>(() => {
    const base: Column[] = [
      { key: 'lat', label: 'latitude', get: (p) => p.lat },
      { key: 'lon', label: 'longitude', get: (p) => p.lon },
      { key: 'ele', label: 'ele (m)', get: (p) => p.ele },
      { key: 'time', label: 'time (UTC)', get: (p) => (p.time !== undefined ? epochMsToIso(p.time) : undefined) },
      { key: 'name', label: 'name', get: (p) => p.name },
    ]
    const ch: Column[] = channels.map((c) => ({ key: `ext:${c}`, label: c, get: (p) => p.ext?.[c] }))
    return [...base, ...ch]
  }, [channels])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const indexed = points.map((p, i) => ({ p, i }))
    if (!q) return indexed
    return indexed.filter(({ p }) => {
      return columns.some((c) => {
        const v = c.get(p)
        return v !== undefined && String(v).toLowerCase().includes(q)
      })
    })
  }, [points, query, columns])

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered
    const col = columns.find((c) => c.key === sortKey)
    if (!col) return filtered
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const va = col.get(a.p)
      const vb = col.get(b.p)
      if (va === undefined && vb === undefined) return 0
      if (va === undefined) return 1
      if (vb === undefined) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb)) * dir
    })
  }, [filtered, sortKey, sortDir, columns])

  const total = sorted.length
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2
  const endIndex = Math.min(total, startIndex + visibleCount)
  const slice = sorted.slice(startIndex, endIndex)

  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else {
      setSortKey(null)
      setSortDir(null)
    }
  }

  return (
    <div className="data-table">
      <div className="data-table-toolbar">
        <input
          className="data-search"
          placeholder="filter rows…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="data-meta">
          {total.toLocaleString()} / {points.length.toLocaleString()} rows
        </span>
      </div>
      <div className="grid-header" style={{ gridTemplateColumns: `60px repeat(${columns.length}, minmax(110px, 1fr))` }}>
        <div className="grid-cell grid-idx">#</div>
        {columns.map((c) => (
          <button key={c.key} type="button" className="grid-cell grid-th" onClick={() => toggleSort(c.key)}>
            {c.label}
            {sortKey === c.key && <span className="sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>}
          </button>
        ))}
      </div>
      <div
        ref={viewportRef}
        className="grid-viewport mono"
        style={{ height: viewportHeight }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div style={{ height: total * ROW_HEIGHT, position: 'relative' }}>
          {slice.map(({ p, i }, k) => (
            <div
              key={startIndex + k}
              className="grid-row"
              style={{
                position: 'absolute',
                top: (startIndex + k) * ROW_HEIGHT,
                height: ROW_HEIGHT,
                gridTemplateColumns: `60px repeat(${columns.length}, minmax(110px, 1fr))`,
              }}
            >
              <div className="grid-cell grid-idx">{i}</div>
              {columns.map((c) => (
                <div key={c.key} className="grid-cell" title={fmtCell(c.get(p))}>
                  {fmtCell(c.get(p))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function fmtCell(value: number | string | undefined): string {
  if (value === undefined) return ''
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(Math.abs(value) < 1 ? 6 : 5)
  }
  return value
}
