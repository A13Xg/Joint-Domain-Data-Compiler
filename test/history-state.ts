import assert from 'node:assert/strict'
import { appendHistorySnapshot } from '../src/state/history.ts'

const snapshots = [1, 2, 3]
assert.deepEqual(appendHistorySnapshot(snapshots, 4, 3), [2, 3, 4])
assert.deepEqual(appendHistorySnapshot(snapshots, 4, 10), [1, 2, 3, 4])
assert.throws(() => appendHistorySnapshot(snapshots, 4, 0), /positive/)
console.log('history state tests passed')
