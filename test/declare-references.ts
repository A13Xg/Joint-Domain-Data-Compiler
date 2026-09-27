import type { Dataset } from '../src/core/model.ts'
import { declareReferencesOperation, validateDeclareReferencesParams } from '../src/core/operations/references.ts'
import { ensureBuiltinOperationsRegistered } from '../src/core/operations/basic.ts'
import { executeOperation } from '../src/core/recipes/executor.ts'
import { assessDatasetCompatibility } from '../src/core/metadataCompatibility.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}
const throws = (fn: () => unknown) => { try { fn(); return false } catch { return true } }

function dataset(altitudeReference: string, timeReference: string): Dataset {
  return {
    id: 'd', name: 'd', sourceFormat: 'csv', warnings: [], channels: [], createdAt: 0,
    points: [{ lat: 35, lon: -117, ele: 1234.5, time: 1000 }, { lat: 35.001, lon: -117, ele: 1240, time: 2000 }],
    metadata: { coordinateSystem: 'EPSG:4326', altitudeReference: altitudeReference as never, timeReference: timeReference as never, channels: [], source: { filename: 'd.csv', importedAt: 0, parserId: 'csv', parserVersion: '1' } },
  }
}

// Validation: params arrive as `unknown` from a replayed recipe or a restored project.
check('accepts a known altitude reference', validateDeclareReferencesParams({ altitudeReference: 'MSL' }).altitudeReference === 'MSL')
check('rejects an unknown reference name', throws(() => validateDeclareReferencesParams({ altitudeReference: 'WGS84' })))
check('rejects an empty declaration', throws(() => validateDeclareReferencesParams({})))
check('rejects extra fields', throws(() => validateDeclareReferencesParams({ altitudeReference: 'MSL', meters: 3 })))
check('rejects non-objects', throws(() => validateDeclareReferencesParams('MSL')) && throws(() => validateDeclareReferencesParams(null)) && throws(() => validateDeclareReferencesParams(['MSL'])))

// Declaring from UNKNOWN: relabels, changes no value, and warns about nothing.
const unknown = dataset('UNKNOWN', 'UNKNOWN')
const declared = declareReferencesOperation.execute({ dataset: unknown, params: { altitudeReference: 'MSL', timeReference: 'UTC' } })
check('the references are declared', declared.dataset.metadata?.altitudeReference === 'MSL' && declared.dataset.metadata?.timeReference === 'UTC')
check('no point value changes', JSON.stringify(declared.dataset.points) === JSON.stringify(unknown.points))
check('the input dataset is not mutated', unknown.metadata?.altitudeReference === 'UNKNOWN')
check('declaring over UNKNOWN raises no conversion warning', (declared.warnings ?? []).length === 0)
check('the summary says what changed', declared.summary.includes('UNKNOWN → MSL') && declared.summary.includes('UNKNOWN → UTC'))

// Relabelling a declared reference: allowed, but it says values were not converted.
const relabel = declareReferencesOperation.execute({ dataset: dataset('MSL', 'UTC'), params: { altitudeReference: 'HAE' } })
check('relabelling a declared altitude reference warns that nothing was converted', (relabel.warnings ?? []).some((warning) => warning.includes('not converted')))
check('an omitted field is left as it was', relabel.dataset.metadata?.timeReference === 'UTC')

// It is registered, so it records and replays like any other transform.
ensureBuiltinOperationsRegistered()
const execution = executeOperation(unknown, 'declare-references', { altitudeReference: 'MSL', timeReference: 'UTC' })
check('it runs through the registered executor and is recorded', execution.record.operationId === 'declare-references' && execution.dataset.metadata?.altitudeReference === 'MSL')

// And it is what unblocks cross-track comparison.
const other = { ...dataset('MSL', 'UTC'), id: 'o' }
check('two unknown-reference tracks only warn', assessDatasetCompatibility(unknown, other).level === 'warning')
check('once declared, the pair is compatible', assessDatasetCompatibility(execution.dataset, other).level === 'compatible')

console.log(`\n${failures === 0 ? 'ALL DECLARE REFERENCES CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
