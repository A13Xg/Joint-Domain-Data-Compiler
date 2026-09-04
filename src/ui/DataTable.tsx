import { useEffect, useMemo, useRef, useState } from 'react'
import type { TrackPoint } from '../core/model'
import { epochMsToIso } from '../core/format'
import { detectQualityEvents, eventSourceIndices } from '../core/quality/events'
import { usePointSelection } from '../state/pointSelection'
import { archiveFile } from '../desktop/fileArchive'
import { SelectionChip } from './SelectionChip'
import { useConfirm } from './confirmContext'

const ROW_HEIGHT = 26
const OVERSCAN = 8
const INDEX_COL_WIDTH = 60
const MIN_COL_WIDTH = 110

type SortDir = 'asc' | 'desc' | null

interface Column {
  key: string
  label: string
  get: (point: TrackPoint) => number | string | boolean | undefined
}

export function DataTable({ points, channels, onDeletePoints }: { points: TrackPoint[]; channels: string[]; onDeletePoints: (indices: number[]) => void }) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [rangeOnly, setRangeOnly] = useState(false)
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  // The row a screen reader/keyboard user is "on". Kept separate from click-selection
  // (pointIndex/indexSet) — moving focus with arrow keys must not itself select a row,
  // the same way moving a mouse cursor over rows without clicking doesn't.
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  // Set immediately before this grid's own rows publish a hover, and consumed by
  // the follow-selection effect below. See that effect for why.
  const selfDrivenHoverRef = useRef(false)
  const viewportHeight = 460
  const confirm = useConfirm()
  const { pointIndex, hoverIndex, indexRange, indexSet, selectPoint, setHoverIndex, toggleInSet, extendSetRange, clearPointSelection, clearRangeSelection, clearSet, clearHover } = usePointSelection(points)
  const indexSetLookup = useMemo(() => new Set(indexSet), [indexSet])
  const activeRangeOnly = rangeOnly && indexRange !== null
  const qualityEvents = useMemo(() => detectQualityEvents(points), [points])
  const flaggedIndices = useMemo(() => eventSourceIndices(qualityEvents), [qualityEvents])
  // Shift+click unions a *source-index* run between the anchor and the
  // clicked row. That run is only meaningful while the grid shows every row
  // in dataset order — under a sort or any filter, the rows between anchor
  // and target on screen are not the rows between those indices in the
  // dataset, and unioning by index would silently reach past what's visible
  // (and, via delete, remove points the user never saw). Outside natural
  // order, shift+click degrades to the same single-index toggle as
  // ctrl/cmd+click rather than doing nothing or doing the wrong thing.
  const naturalOrder = !sortKey && query.trim().length === 0 && !flaggedOnly && !activeRangeOnly

  const handleDeleteSet = async () => {
    if (indexSet.length === 0) return
    const proceed = await confirm({
      title: `Delete ${indexSet.length.toLocaleString()} point(s)`,
      message: 'These points are removed from the track. Every row after a deleted point shifts up by one for each point removed ahead of it.',
      details: [
        `${points.length.toLocaleString()} points → ${(points.length - indexSet.length).toLocaleString()} points`,
        'Undoable from the operation history',
      ],
      confirmLabel: 'Delete',
    })
    if (!proceed) return
    // applyTransform → restorePointSelection already clears indexSet (and
    // everything else) once the delete lands, since the indices it named no
    // longer resolve to the same rows. No need to clearSet() here too.
    onDeletePoints(indexSet)
  }

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

  // Follows a selection made in another panel — hovering the map, the chart, or
  // the 3D scene scrubs this grid to the matching row — and arrow-key navigation.
  //
  // It must NOT follow a hover this grid produced itself. Each row publishes its
  // index on mouseenter, so recentring on that scrolls new rows under a
  // stationary cursor, which fires the next mouseenter, which scrolls again: the
  // grid ran away on its own the moment the pointer neared the top or bottom
  // edge. The ref marks those self-driven updates so they are consumed here
  // instead of acted on, leaving cross-panel and keyboard following intact.
  useEffect(() => {
    if (selfDrivenHoverRef.current) {
      selfDrivenHoverRef.current = false
      return
    }
    const targetIndex = pointIndex ?? hoverIndex
    if (targetIndex === null || sortKey || query || activeRangeOnly) return
    const viewport = viewportRef.current
    if (!viewport) return

    // A row already on screen needs no scroll at all. Recentring one regardless
    // is what made cross-panel hover jump the grid on every sample.
    // Rows start below the sticky header inside the same scroll content.
    const rowTop = (headerRef.current?.offsetHeight ?? 0) + targetIndex * ROW_HEIGHT
    const visibleTop = viewport.scrollTop
    const visibleBottom = visibleTop + viewportHeight - ROW_HEIGHT
    if (pointIndex === null && rowTop >= visibleTop && rowTop <= visibleBottom) return

    viewport.scrollTo({ top: Math.max(0, rowTop - viewportHeight / 2), behavior: pointIndex !== null ? 'smooth' : 'auto' })
  }, [pointIndex, hoverIndex, sortKey, query, activeRangeOnly])

  // `1fr` still stretches the columns when the grid fits, while minWidth gives
  // the grid an intrinsic width to overflow (and therefore scroll) past when it
  // does not. Header and rows share both so the two stay in register.
  const gridTemplate = `${INDEX_COL_WIDTH}px repeat(${columns.length}, minmax(${MIN_COL_WIDTH}px, 1fr))`
  const gridMinWidth = INDEX_COL_WIDTH + columns.length * MIN_COL_WIDTH

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

  // Falls back to the first visible row once the focused one drops out of the current
  // filter/sort (e.g. it no longer matches the search query) rather than pointing
  // `aria-activedescendant` at a row id that no longer exists.
  const activeIndex = focusedIndex !== null && sorted.some((entry) => entry.index === focusedIndex)
    ? focusedIndex
    : sorted[0]?.index ?? null

  // Row-only scroll, distinct from scrollToSelection's smooth badge-jump: instant so
  // repeated arrow-key presses don't queue up animations behind each other.
  const scrollRowIntoView = (target: number) => {
    const row = sorted.findIndex((entry) => entry.index === target)
    if (row < 0) return
    const rowTop = (headerRef.current?.offsetHeight ?? 0) + row * ROW_HEIGHT
    const viewport = viewportRef.current
    if (!viewport) return
    const visibleTop = viewport.scrollTop
    const visibleBottom = visibleTop + viewportHeight - ROW_HEIGHT
    if (rowTop >= visibleTop && rowTop <= visibleBottom) return
    viewport.scrollTo({ top: Math.max(0, rowTop - viewportHeight / 2), behavior: 'auto' })
  }

  // Shared by both the mouse click handler and the keyboard Enter/Space handler so
  // selection behavior never drifts between the two input paths.
  const activateRow = (index: number, shift: boolean, ctrlOrMeta: boolean) => {
    selfDrivenHoverRef.current = true
    setFocusedIndex(index)
    if (shift) {
      if (naturalOrder) extendSetRange(index)
      else toggleInSet(index)
      return
    }
    if (ctrlOrMeta) {
      toggleInSet(index)
      return
    }
    selectPoint(pointIndex === index ? null : index)
  }

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (sorted.length === 0) return
    const currentPos = activeIndex !== null ? sorted.findIndex((entry) => entry.index === activeIndex) : -1
    const basePos = currentPos < 0 ? 0 : currentPos
    const clampPos = (pos: number) => Math.max(0, Math.min(sorted.length - 1, pos))
    const moveTo = (pos: number) => {
      const target = sorted[clampPos(pos)]!.index
      setFocusedIndex(target)
      scrollRowIntoView(target)
    }
    const page = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT))
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveTo(basePos + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        moveTo(basePos - 1)
        break
      case 'Home':
        event.preventDefault()
        moveTo(0)
        break
      case 'End':
        event.preventDefault()
        moveTo(sorted.length - 1)
        break
      case 'PageDown':
        event.preventDefault()
        moveTo(basePos + page)
        break
      case 'PageUp':
        event.preventDefault()
        moveTo(basePos - page)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (activeIndex !== null) activateRow(activeIndex, event.shiftKey, event.ctrlKey || event.metaKey)
        break
      default:
        break
    }
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
        {indexSet.length > 0 && <SelectionChip label={`set of ${indexSet.length}`} tone="set" onJump={() => scrollToSelection(indexSet[0]!)} jumpTitle="Scroll to the first selected point" onClear={clearSet} clearLabel="Clear multi-select" />}
        {indexSet.length > 0 && <button type="button" onClick={() => void handleDeleteSet()}>Delete {indexSet.length} point(s)</button>}
      </div>
      <div className="data-table-hint">Ctrl/⌘+click a row to add or remove it from a delete set{naturalOrder ? '; shift+click extends it to a range' : ' (sort/filter active — shift+click adds one row at a time)'}. Arrow keys move the focused row, Enter/Space selects it, with the same Ctrl/⌘/Shift modifiers.</div>
      {/* Header and rows share one scroll container so a grid wider than the
          panel scrolls both together and the labels stay over their columns
          instead of being clipped at the right edge. Keeping the header in a
          separate synced element cannot hold alignment: only the body reserves
          a vertical scrollbar, so the two scrollports differ in width and the
          header runs out of travel first. Sticky keeps it pinned vertically. */}
      <div
        ref={viewportRef}
        className="grid-viewport mono"
        style={{ height: viewportHeight }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        role="grid"
        aria-label={`Track points, ${total.toLocaleString()} of ${points.length.toLocaleString()} rows shown`}
        aria-rowcount={total}
        aria-colcount={columns.length + 1}
        aria-multiselectable="true"
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        aria-activedescendant={activeIndex !== null ? `row-${activeIndex}` : undefined}
      >
        <div style={{ minWidth: gridMinWidth }}>
          <div ref={headerRef} className="grid-header" role="row" aria-rowindex={1} style={{ gridTemplateColumns: gridTemplate }}>
            <div className="grid-cell grid-idx" role="columnheader">#</div>
            {columns.map((column) => (
              <button
                key={column.key}
                type="button"
                role="columnheader"
                aria-sort={sortKey === column.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="grid-cell grid-th"
                onClick={() => toggleSort(column.key)}
              >
                {column.label}{sortKey === column.key && <span className="sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>}
              </button>
            ))}
          </div>
          <div style={{ height: total * ROW_HEIGHT, position: 'relative' }}>
          {slice.map(({ point, index }, offset) => {
            const selected = pointIndex === index
            const hovered = hoverIndex === index
            const inRange = indexRange !== null && index >= indexRange.start && index <= indexRange.end
            const inSet = indexSetLookup.has(index)
            const flagged = flaggedIndices.has(index)
            const focused = activeIndex === index
            const eventKinds = qualityEvents.filter((event) => event.startIndex <= index && event.endIndex >= index).map((event) => event.kind).join(', ')
            return (
              <div
                key={index}
                id={`row-${index}`}
                role="row"
                aria-rowindex={startIndex + offset + 2}
                aria-selected={selected || inSet}
                className={`grid-row${selected ? ' selected' : ''}${hovered ? ' hovered' : ''}${inRange ? ' in-range' : ''}${inSet ? ' in-set' : ''}${flagged ? ' quality-flagged' : ''}${focused ? ' kbd-focused' : ''}`}
                title={eventKinds ? `Quality events: ${eventKinds}` : undefined}
                onMouseEnter={() => { selfDrivenHoverRef.current = true; setHoverIndex(index) }}
                onMouseLeave={clearHover}
                onClick={(event) => activateRow(index, event.shiftKey, event.ctrlKey || event.metaKey)}
                style={{ position: 'absolute', top: (startIndex + offset) * ROW_HEIGHT, height: ROW_HEIGHT, gridTemplateColumns: gridTemplate, cursor: 'pointer' }}
              >
                <div className="grid-cell grid-idx" role="gridcell">{flagged ? '⚠ ' : ''}{index}</div>
                {columns.map((column) => <div key={column.key} className="grid-cell" role="gridcell" title={fmtCell(column.get(point))}>{fmtCell(column.get(point))}</div>)}
              </div>
              )
            })}
          </div>
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
