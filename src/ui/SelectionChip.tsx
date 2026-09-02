// The selection badge shown by the map, charts, table and 3D scene.
//
// It used to be one button that cleared the selection wherever you clicked it,
// which put the destructive action under the whole target and left no way to
// ask "where is that point?" — the question the badge actually raises. The body
// now takes you to the samples it names, and only the × discards the selection.
//
// Two buttons in a wrapper rather than a nested one: a button inside a button
// is invalid HTML and browsers reparent it, which breaks both the layout and
// the click target.

interface Props {
  /** What the badge names, e.g. "selected #412" or "range 20–95". */
  label: string
  /** Styling only: a point selection reads as active, a range as a span, a set as a group. */
  tone?: 'point' | 'range' | 'set'
  /** Brings the named samples into view. Omitted where the surrounding view has nowhere to go. */
  onJump?: () => void
  /** What the jump does here, e.g. "Zoom the chart to this point". */
  jumpTitle?: string
  onClear: () => void
  /** Accessible name for the ×, e.g. "Clear point selection". */
  clearLabel: string
}

export function SelectionChip({ label, tone = 'point', onJump, jumpTitle, onClear, clearLabel }: Props) {
  return (
    <span className={`chip selection-chip ${tone === 'range' ? 'chip-range' : tone === 'set' ? 'chip-set' : 'chip-on'}`}>
      {onJump
        ? <button type="button" className="selection-chip-jump" onClick={onJump} title={jumpTitle}>{label}</button>
        : <span className="selection-chip-label">{label}</span>}
      <button type="button" className="selection-chip-clear" onClick={onClear} aria-label={clearLabel} title={clearLabel}>×</button>
    </span>
  )
}
