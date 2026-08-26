import assert from 'node:assert/strict'
import { generateSyntheticTrack } from '../benchmarks/generate.ts'

const first = generateSyntheticTrack(12, { seed: 7, gapFraction: 0.25 })
const second = generateSyntheticTrack(12, { seed: 7, gapFraction: 0.25 })
const differentSeed = generateSyntheticTrack(12, { seed: 8, gapFraction: 0.25 })

assert.deepEqual(second, first, 'same seed/options must produce identical benchmark fixtures')
assert.notDeepEqual(differentSeed, first, 'different seed should alter fixture samples')
assert.equal(first.length, 12)
assert.ok(first.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon) && Number.isFinite(point.time)))
assert.ok(first.slice(1).every((point, index) => point.time! > first[index]!.time!), 'fixture timestamps must be strictly chronological')
assert.throws(() => generateSyntheticTrack(-1), /pointCount/)
assert.throws(() => generateSyntheticTrack(1.5), /pointCount/)
assert.throws(() => generateSyntheticTrack(1, { gapFraction: -0.1 }), /gapFraction/)
assert.throws(() => generateSyntheticTrack(1, { gapFraction: 1.1 }), /gapFraction/)

console.log('benchmark fixture tests passed')
