import { strict as assert } from 'node:assert'
import { assessDatasetCompatibility, assessFusionCompatibility } from '../src/core/metadataCompatibility.ts'
import type { Dataset } from '../src/core/model.ts'

function dataset(id: string, altitudeReference: Dataset['metadata'] extends infer M ? M extends { altitudeReference: infer A } ? A : never : never, timeReference: Dataset['metadata'] extends infer M ? M extends { timeReference: infer T } ? T : never : never, coordinateSystem = 'EPSG:4326', points: Dataset['points'] = [{ lat: 10, lon: 20, time: 1 }]): Dataset {
  return { id, name: id, sourceFormat: 'csv', points, warnings: [], channels: [], createdAt: 0, metadata: { coordinateSystem, altitudeReference, timeReference, channels: [], source: { filename: id, importedAt: 0, parserId: 'csv', parserVersion: '1' } } }
}

assert.equal(assessDatasetCompatibility(dataset('a', 'MSL', 'UTC'), dataset('b', 'MSL', 'UTC')).level, 'compatible')
assert.equal(assessDatasetCompatibility(dataset('a', 'MSL', 'UTC'), dataset('b', 'HAE', 'UTC')).level, 'blocked')
assert.equal(assessDatasetCompatibility(dataset('a', 'UNKNOWN', 'UTC'), dataset('b', 'UNKNOWN', 'UTC')).level, 'warning')
assert.equal(assessDatasetCompatibility(dataset('a', 'MSL', 'UTC'), dataset('b', 'MSL', 'GPS')).level, 'blocked')
assert.equal(assessFusionCompatibility([dataset('a', 'MSL', 'UTC'), dataset('b', 'MSL', 'UTC')]).level, 'compatible')
const differentCrs = assessFusionCompatibility([dataset('a', 'MSL', 'UTC'), dataset('b', 'MSL', 'UTC', 'EPSG:3857')])
assert.equal(differentCrs.level, 'blocked')
assert.match(differentCrs.reasons.join(' '), /Coordinate systems differ.*Reproject/i)
const missingCoverage = assessFusionCompatibility([dataset('a', 'MSL', 'UTC'), dataset('b', 'MSL', 'UTC', 'EPSG:4326', [{ lat: 999, lon: 20 }])])
assert.equal(missingCoverage.level, 'blocked')
assert.match(missingCoverage.reasons.join(' '), /no valid latitude\/longitude coverage/i)
const incompatibleRefs = assessFusionCompatibility([dataset('a', 'MSL', 'UTC'), dataset('b', 'HAE', 'UTC')])
assert.equal(incompatibleRefs.level, 'blocked')
assert.match(incompatibleRefs.reasons.join(' '), /Altitude references differ/i)
console.log('metadata compatibility tests passed')
