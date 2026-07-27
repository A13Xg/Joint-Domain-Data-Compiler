import { useEffect, useMemo, useRef, useState } from 'react'
import type { TrackPoint } from '../core/model'
import { epochMsToIso } from '../core/format'
import { usePointSelection } from '../state/pointSelection'

const ROW_HEIGHT = 26
const OVERSCAN = 8

type SortDir = 'asc' | 'desc' | null

interface Column {
  key: string
  label: string
  get: (point: TrackPoint) => number | string | boolean | undefined
}

export function DataTable({ points, channels }: { points: TrackPoint[]; channels: string[] }) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [rangeOnly, setRangeOnly] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewportHeight = 460
  const { pointIndex, hoverIndex, indexRange, selectPoint, setHoverIndex, clearSelection, clearRange, clearHover } = usePointSelection(points)
  const activeRangeOnly = rangeOnly && indexRange !== null

  const columns = useMemo<Column[]>(() => {
    const base: Column[] = [
      { key: 'lat', label: 'latitude', get: (point) => point.lat },
      { key: 'lon', label: 'longitude', get: (point) => point.lon },
      { key: 'ele', label: 'ele (m)', get: (point) => point.ele },
      { key: 'time', label: 'time (UTC)', get: (point) => point.time !== undefined ? epochMsToIso(point.time) : undefined },
      { key: 'name', label: 'name', get: (point) => point.name },
    ]
    return [...base, ...channels.map((channel): Column => ({ key: `ext:${channel}`, label: channel, get: (point) => point.ext?.[channel] }))]
  }, [channels])

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    let indexed = points.map((point, index) => ({ point, index }))
    if (activeRangeOnly && indexRange) indexed = indexed.filter(({ index }) => index >= indexRange.start && index <= indexRange.end)
    if (!normalizedQuery) return indexed
    return indexed.filter(({ point }) => columns.some((column) => {
      const value = column.get(point)
      return value !== undefined && String(value).toLowerCase().includes(normalizedQuery)
    }))
  }, [points, query, columns, activeRangeOnly, indexRange])

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered
    const column = columns.find((item) => item.key === sortKey)
    if (!column) return filtered
    const direction = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((left, right) => {
      const a = column.get(left.point)
      const b = column.get(right.point)
      if (a === undefined && b === undefined) return 0
      if (a === undefined) return 1
      if (b === undefined) return -1
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction
      return String(a).localeCompare(String(b)) * direction
    })
  }, [filtered, sortKey, sortDir, columns])

  useEffect(() => {
    const targetIndex = pointIndex ?? hoverIndex
    if (targetIndex === null || sortKey || query || activeRangeOnly) return
    viewportRef.current?.scrollTo({ top: Math.max(0, targetIndex * ROW_HEIGHT - viewportHeight / 2), behavior: pointIndex !== null ? 'smooth' : 'auto' })
  }, [pointIndex, hoverIndex, sortKey, query, activeRangeOnly])

  const total = sorted.length
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2
  const endIndex = Math.min(total, startIndex + visibleCount)
  const slice = sorted.slice(startIndex, endIndex)

  const toggleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc') }
    else if (sortDir === 'asc') setSortDir('desc')
    else { setSortKey(null); setSortDir(null) }
  }

  return (
    <div className="data-table">
      <div className="data-table-toolbar">
        <input className="data-search" placeholder="filter rows…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <span className="data-meta">{total.toLocaleString()} / {points.length.toLocaleString()} rows</span>
        <button type="button" disabled={sorted.length === 0} onClick={() => downloadRows(sorted, columns)}>Export visible CSV</button>
        {indexRange && <label className="chk"><input type="checkbox" checked={rangeOnly} onChange={(event) => setRangeOnly(event.target.checked)} />selected range only</label>}
        {pointIndex !== null && <button type="button" className="chip chip-on" onClick={clearSelection}>selected #{pointIndex} ×</button>}
        {indexRange && <button type="button" className="chip chip-range" onClick={() => { setRangeOnly(false); clearRange() }}>range {indexRange.start}–{indexRange.end} ×</button>}
      </div>
      <div className="grid-header" style={{ gridTemplateColumns: `60px repeat(${columns.length}, minmax(110px, 1fr))` }}>
        <div className="grid-cell grid-idx">#</div>
        {columns.map((column) => <button key={column.key} type="button" className="grid-cell grid-th" onClick={() => toggleSort(column.key)}>{column.label}{sortKey === column.key && <span className="sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>}</button>)}
      </div>
      <div ref={viewportRef} className="grid-viewport mono" style={{ height: viewportHeight }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <div style={{ height: total * ROW_HEIGHT, position: 'relative' }}>
          {slice.map(({ point, index }, offset) => {
            const selected = pointIndex === index
            const hovered = hoverIndex === index
            const inRange = indexRange !== null && index >= indexRange.start && index <= indexRange.end
            return (
              <div key={index} className={`grid-row${selected ? ' selected' : ''}${hovered ? ' hovered' : ''}${inRange ? ' in-range' : ''}`} onMouseEnter={() => setHoverIndex(index)} onMouseLeave={clearHover} onClick={() => selectPoint(selected ? null : index)} style={{ position: 'absolute', top: (startIndex + offset) * ROW_HEIGHT, height: ROW_HEIGHT, gridTemplateColumns: `60px repeat(${columns.length}, minmax(110px, 1fr))`, cursor: 'pointer' }}>
                <div className="grid-cell grid-idx">{index}</div>
                {columns.map((column) => <div key={column.key} className="grid-cell" title={fmtCell(column.get(point))}>{fmtCell(column.get(point))}</div>)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function fmtCell(value: number | string | boolean | undefined): string {
  if (value === undefined) return ''
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(Math.abs(value) < 1 ? 6 : 5)
  }
  return String(value)
}

function downloadRows(rows: Array<{ point: TrackPoint; index: number }>, columns: Column[]): void {
  const header = ['source_index', ...columns.map((column) => column.label)]
  const body = rows.map(({ point, index }) => [String(index), ...columns.map((column) => csvCell(fmtCell(column.get(point))))].join(','))
  const csv = `${header.map(csvCell).join(',')}\n${body.join('\n')}\n`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `jddc-visible-rows-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function csvCell(value: string): string {
  return value.includes(',') || value.includes('"') || value.includes('\n') || value.includes(String.fromCharCode(13)) ? `"${value.replace(/"/g, '""')}"` : value
}
