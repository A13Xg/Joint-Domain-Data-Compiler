import assert from 'node:assert/strict'
import { appendHistorySnapshot, MAX_HISTORY_SNAPSHOTS } from '../src/state/history.ts'

const snapshots = [1, 2, 3]
// Index 0 is pinned: it is the replay source, the "Restore original" target,
// and the archive checkpoint, so pruning takes from index 1 instead.
assert.deepEqual(appendHistorySnapshot(snapshots, 4, 3), [1, 3, 4])
assert.deepEqual(appendHistorySnapshot(snapshots, 4, 10), [1, 2, 3, 4])
assert.deepEqual(appendHistorySnapshot(snapshots, 4, 1), [1])
assert.deepEqual(appendHistorySnapshot([], 1, 3), [1])
assert.throws(() => appendHistorySnapshot(snapshots, 4, 0), /positive/)

// The regression this replaces: past the limit, slice(-limit) rotated the
// original out of index 0 and quietly broke replay.
let past: number[] = []
for (let step = 0; step < MAX_HISTORY_SNAPSHOTS * 3; step++) past = appendHistorySnapshot(past, step)
assert.equal(past[0], 0, 'the original survives well past the snapshot limit')
assert.equal(past.length, MAX_HISTORY_SNAPSHOTS, 'the limit is still honored')
assert.equal(past.at(-1), MAX_HISTORY_SNAPSHOTS * 3 - 1, 'the most recent step is retained')
assert.equal(past[1], MAX_HISTORY_SNAPSHOTS * 3 - (MAX_HISTORY_SNAPSHOTS - 1), 'pruning takes from index 1')

console.log('history state tests passed')
