import { useEffect, useMemo, useRef, useState } from 'react'
import type { TrackPoint } from '../core/model'
import { epochMsToIso } from '../core/format'
import { detectQualityEvents, eventSourceIndices } from '../core/quality/events'
import { usePointSelection } from '../state/pointSelection'
import { archiveFile } from '../desktop/fileArchive'
import { SelectionChip } from './SelectionChip'

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
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewportHeight = 460
  const { pointIndex, hoverIndex, indexRange, selectPoint, setHoverIndex, clearPointSelection, clearRangeSelection, clearHover } = usePointSelection(points)
  const activeRangeOnly = rangeOnly && indexRange !== null
  const qualityEvents = useMemo(() => detectQualityEvents(points), [points])
  const flaggedIndices = useMemo(() => eventSourceIndices(qualityEvents), [qualityEvents])

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
    if (flaggedOnly) indexed = indexed.filter(({ index }) => flaggedIndices.has(index))
    if (!normalizedQuery) return indexed
    return indexed.filter(({ point }) => columns.some((column) => {
      const value = column.get(point)
      return value !== undefined && String(value).toLowerCase().includes(normalizedQuery)
    }))
  }, [points, query, columns, activeRangeOnly, indexRange, flaggedOnly, flaggedIndices])

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

  // The badge scrolls to the row wherever it has ended up, which the automatic
  // scroll above deliberately does not do once the grid is sorted or filtered.
  // A row the current filter hides has no position to scroll to, so the jump
  // does nothing rather than scrolling somewhere arbitrary.
  const scrollToSelection = (target: number) => {
    const row = sorted.findIndex((entry) => entry.index === target)
    if (row < 0) return
    viewportRef.current?.scrollTo({ top: Math.max(0, row * ROW_HEIGHT - viewportHeight / 2), behavior: 'smooth' })
  }

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
        {qualityEvents.length > 0 && <label className="chk"><input type="checkbox" checked={flaggedOnly} onChange={(event) => setFlaggedOnly(event.target.checked)} />quality events only</label>}
        {qualityEvents.length > 0 && <button type="button" onClick={() => { const next = qualityEvents.find((event) => event.startIndex > (pointIndex ?? -1)) ?? qualityEvents[0]; if (next) selectPoint(next.startIndex) }}>Next quality event</button>}
        {indexRange && <label className="chk"><input type="checkbox" checked={rangeOnly} onChange={(event) => setRangeOnly(event.target.checked)} />selected range only</label>}
        {pointIndex !== null && <SelectionChip label={`selected #${pointIndex}`} onJump={() => scrollToSelection(pointIndex)} jumpTitle="Scroll to this row" onClear={clearPointSelection} clearLabel="Clear point selection" />}
        {indexRange && <SelectionChip label={`range ${indexRange.start}–${indexRange.end}`} tone="range" onJump={() => scrollToSelection(indexRange.start)} jumpTitle="Scroll to the start of this range" onClear={() => { setRangeOnly(false); clearRangeSelection() }} clearLabel="Clear range selection" />}
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
            const flagged = flaggedIndices.has(index)
            const eventKinds = qualityEvents.filter((event) => event.startIndex <= index && event.endIndex >= index).map((event) => event.kind).join(', ')
            return (
              <div key={index} className={`grid-row${selected ? ' selected' : ''}${hovered ? ' hovered' : ''}${inRange ? ' in-range' : ''}${flagged ? ' quality-flagged' : ''}`} title={eventKinds ? `Quality events: ${eventKinds}` : undefined} onMouseEnter={() => setHoverIndex(index)} onMouseLeave={clearHover} onClick={() => selectPoint(selected ? null : index)} style={{ position: 'absolute', top: (startIndex + offset) * ROW_HEIGHT, height: ROW_HEIGHT, gridTemplateColumns: `60px repeat(${columns.length}, minmax(110px, 1fr))`, cursor: 'pointer' }}>
                <div className="grid-cell grid-idx">{flagged ? '⚠ ' : ''}{index}</div>
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
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const filename = `jddc-visible-rows-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  void archiveFile('outputs', filename, blob)
}

function csvCell(value: string): string {
  return value.includes(',') || value.includes('"') || value.includes('\n') || value.includes(String.fromCharCode(13)) ? `"${value.replace(/"/g, '""')}"` : value
}
