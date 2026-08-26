import type { JddcPlugin } from '../src/core/plugins/contracts.ts'
import { PluginRegistry } from '../src/core/plugins/registry.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const registry = new PluginRegistry('0.1.0')
const validPlugin: JddcPlugin = {
  id: 'sample-plugin',
  version: 1,
  label: 'Sample plugin',
  description: 'Registers representative extension types.',
  minimumHostVersion: '0.1.0',
  register(context) {
    context.registerParser({
      id: 'sample-parser',
      version: 1,
      sourceFormat: 'sample',
      extensions: ['.SAMPLE'],
      binary: false,
      parse: () => ({ points: [], warnings: [], channels: [] }),
    })
    context.registerExporter({
      id: 'sample-exporter',
      version: 1,
      extension: '.OUT',
      label: 'Sample export',
      export: () => ({ fileName: 'sample.out', mimeType: 'text/plain', text: '', warnings: [] }),
    })
    context.registerChartPreset({
      id: 'sample-chart',
      version: 1,
      label: 'Sample chart',
      xAxis: 'time',
      channelIds: ['elevation'],
    })
    context.registerReportSection({
      id: 'sample-report',
      version: 1,
      label: 'Sample report',
      render: () => '<section>sample</section>',
    })
  },
}

registry.load(validPlugin)
check('Plugin is registered', registry.listPlugins()[0]?.id === 'sample-plugin')
check('Parser extension is normalized', registry.listParsers()[0]?.extensions[0] === 'sample')
check('Exporter extension is normalized', registry.listExporters()[0]?.extension === 'out')
check('Chart presets are registered', registry.listChartPresets()[0]?.id === 'sample-chart')
check('Report sections are registered', registry.listReportSections()[0]?.id === 'sample-report')

let duplicatePluginRejected = false
try {
  registry.load(validPlugin)
} catch {
  duplicatePluginRejected = true
}
check('Duplicate plugin ids are rejected', duplicatePluginRejected)

const beforeAtomicFailure = registry.listParsers().length
let atomicFailureRejected = false
try {
  registry.load({
    id: 'atomic-failure',
    version: 1,
    label: 'Atomic failure',
    description: 'Should not partially commit.',
    minimumHostVersion: '0.1.0',
    register(context) {
      context.registerParser({
        id: 'temporary-parser',
        version: 1,
        sourceFormat: 'temporary',
        extensions: ['tmp'],
        binary: false,
        parse: () => ({ points: [], warnings: [], channels: [] }),
      })
      context.registerParser({
        id: 'sample-parser',
        version: 1,
        sourceFormat: 'collision',
        extensions: ['collision'],
        binary: false,
        parse: () => ({ points: [], warnings: [], channels: [] }),
      })
    },
  })
} catch {
  atomicFailureRejected = true
}
check('Registration collisions are rejected', atomicFailureRejected)
check('Failed plugins do not partially commit', registry.listParsers().length === beforeAtomicFailure)

let hostVersionRejected = false
try {
  registry.load({
    id: 'future-plugin',
    version: 1,
    label: 'Future plugin',
    description: 'Requires a newer host.',
    minimumHostVersion: '9.0.0',
    register() {},
  })
} catch {
  hostVersionRejected = true
}
check('Minimum host versions are enforced', hostVersionRejected)

let duplicateWithinPluginRejected = false
try {
  registry.load({
    id: 'duplicate-within',
    version: 1,
    label: 'Duplicate within plugin',
    description: 'Registers duplicate ids internally.',
    minimumHostVersion: '0.1.0',
    register(context) {
      const preset = { id: 'duplicate-preset', version: 1, label: 'Duplicate', xAxis: 'time' as const, channelIds: ['elevation'] }
      context.registerChartPreset(preset)
      context.registerChartPreset(preset)
    },
  })
} catch {
  duplicateWithinPluginRejected = true
}
check('Duplicate ids within one plugin are rejected', duplicateWithinPluginRejected)

let invalidExtensionRejected = false
try {
  registry.load({
    id: 'bad-extension',
    version: 1,
    label: 'Bad extension',
    description: 'Uses an invalid extension.',
    minimumHostVersion: '0.1.0',
    register(context) {
      context.registerExporter({
        id: 'bad-exporter',
        version: 1,
        extension: '../bad',
        label: 'Bad',
        export: () => ({ fileName: 'bad', mimeType: 'text/plain', warnings: [] }),
      })
    },
  })
} catch {
  invalidExtensionRejected = true
}
check('Unsafe file extensions are rejected', invalidExtensionRejected)

console.log(`\n${failures === 0 ? 'ALL PLUGIN CHECKS PASSED' : `${failures} PLUGIN CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
