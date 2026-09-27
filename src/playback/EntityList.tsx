import type { PlaybackTrack } from './PlaybackState'

interface Props {
  tracks: readonly PlaybackTrack[]
  selectedIds: readonly string[]
  onVisibleChange: (trackId: string, visible: boolean) => void
  onColorChange: (trackId: string, color: string) => void
  onSelectForPair: (trackId: string) => void
}

/**
 * Clicking a row toggles it in/out of the pair-selection (for the
 * range/bearing/closure metrics panel): the two most recently clicked
 * distinct tracks are the pair.
 */
export function EntityList({ tracks, selectedIds, onVisibleChange, onColorChange, onSelectForPair }: Props) {
  return (
    <table className="playback-entity-list">
      <thead>
        <tr><th>Show</th><th>Callsign</th><th>Type</th><th>Color</th><th>Pair</th></tr>
      </thead>
      <tbody>
        {tracks.map((track) => {
          const inPair = selectedIds.includes(track.id)
          return (
            <tr key={track.id} className={inPair ? 'playback-entity-selected' : undefined}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Show ${track.name}`}
                  checked={track.visible}
                  onChange={(event) => onVisibleChange(track.id, event.target.checked)}
                />
              </td>
              <td>{track.callsign || track.name}</td>
              <td>{track.aircraftType || '—'}</td>
              <td>
                <input
                  type="color"
                  aria-label={`Color for ${track.name}`}
                  value={track.color}
                  onChange={(event) => onColorChange(track.id, event.target.value)}
                />
              </td>
              <td>
                <button type="button" className={inPair ? 'active' : undefined} onClick={() => onSelectForPair(track.id)}>
                  {inPair ? 'Selected' : 'Select'}
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
