import { strict as assert } from 'node:assert'
import { createDatasetId, assertUniqueDatasetId, insertDataset } from '../src/core/ids.ts'
import { makeDataset } from '../src/core/parsers/index.ts'

const deterministicIds = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']
let call = 0
const nextId = () => deterministicIds[call++]!

const first = createDatasetId('Flight A.gpx', nextId)
const second = createDatasetId('Flight A.gpx', nextId)
assert.notEqual(first, second)
assert.match(first, /^ds_00000000-0000-4000-8000-000000000001_flight_a_gpx$/)
assert.doesNotThrow(() => assertUniqueDatasetId([{ id: first }], second))
assert.throws(() => assertUniqueDatasetId([{ id: first }], first), /Duplicate dataset id/)
assert.deepEqual(insertDataset([{ id: first, label: 'original' }], { id: second, label: 'new' }), [{ id: first, label: 'original' }, { id: second, label: 'new' }])
assert.throws(() => insertDataset([{ id: first }], { id: first }), /Duplicate dataset id/)

const dataset = makeDataset('demo.gpx', 'gpx', { points: [], warnings: [], channels: [] })
assert.match(dataset.id, /^ds_[0-9a-f-]{36}_demo_gpx$/)
assert.doesNotMatch(dataset.id, /^ds_\d+_/) 

console.log('dataset id tests passed')
