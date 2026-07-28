export const MAX_HISTORY_SNAPSHOTS = 50

export function appendHistorySnapshot<T>(past: readonly T[], snapshot: T, limit = MAX_HISTORY_SNAPSHOTS): T[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('History limit must be a positive integer')
  return [...past, snapshot].slice(-limit)
}
