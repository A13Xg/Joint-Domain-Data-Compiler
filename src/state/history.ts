export const MAX_HISTORY_SNAPSHOTS = 50

/**
 * Appends a snapshot, pruning from index 1 so index 0 always stays the
 * original import.
 *
 * `past[0]` is not just the oldest undo step. It is the `replaySource` handed
 * to TransformPanel, the dataset "Restore original" resets to, and the
 * `checkpoint` the project archive persists. A plain `slice(-limit)` dropped
 * it on the 51st operation, which silently broke "Replay verified history"
 * (the recipe's sourceDatasetHash check would fail against whatever snapshot
 * had rotated into index 0) and would defeat "Restore original" outright.
 *
 * Cost: one extra full Dataset retained per import, unpruned, against a
 * 100k-point parser cap. The archive already stores this snapshot — it was
 * simply storing the wrong one.
 */
export function appendHistorySnapshot<T>(past: readonly T[], snapshot: T, limit = MAX_HISTORY_SNAPSHOTS): T[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('History limit must be a positive integer')
  const next = [...past, snapshot]
  if (next.length <= limit) return next
  // Keep the original plus the most recent limit-1 steps. At limit 1 there is
  // no room for recent steps, so the original is all that survives.
  const original = next[0] as T
  return limit === 1 ? [original] : [original, ...next.slice(next.length - (limit - 1))]
}
