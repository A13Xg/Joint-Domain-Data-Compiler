import { strict as assert } from 'node:assert'
import { assessDatasetCompatibility } from '../src/core/metadataCompatibility.ts'
import type { Dataset } from '../src/core/model.ts'

function dataset(id: string, altitudeReference: Dataset['metadata'] extends infer M ? M extends { altitudeReference: infer A } ? A : never : never, timeReference: Dataset['metadata'] extends infer M ? M extends { timeReference: infer T } ? T : never : never): Dataset {
  return { id, name: id, sourceFormat: 'csv', points: [], warnings: [], channels: [], createdAt: 0, metadata: { coordinateSystem: 'EPSG:4326', altitudeReference, timeReference, channels: [], source: { filename: id, importedAt: 0, parserId: 'csv', parserVersion: '1' } } }
}

assert.equal(assessDatasetCompatibility(dataset('a', 'MSL', 'UTC'), dataset('b', 'MSL', 'UTC')).level, 'compatible')
assert.equal(assessDatasetCompatibility(dataset('a', 'MSL', 'UTC'), dataset('b', 'HAE', 'UTC')).level, 'blocked')
assert.equal(assessDatasetCompatibility(dataset('a', 'UNKNOWN', 'UTC'), dataset('b', 'UNKNOWN', 'UTC')).level, 'warning')
assert.equal(assessDatasetCompatibility(dataset('a', 'MSL', 'UTC'), dataset('b', 'MSL', 'GPS')).level, 'blocked')
console.log('metadata compatibility tests passed')
