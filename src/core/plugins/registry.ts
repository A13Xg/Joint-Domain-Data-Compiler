import type { DerivedChannelDefinition } from '../analytics/registry'
import type { OperationDefinition } from '../recipes/model'
import type {
  ChartPresetPluginDefinition,
  ExporterPluginDefinition,
  JddcPlugin,
  ParserPluginDefinition,
  PluginRegistrationContext,
  ReportSectionPluginDefinition,
} from './contracts'

interface StagedRegistrations {
  parsers: ParserPluginDefinition[]
  exporters: ExporterPluginDefinition[]
  operations: OperationDefinition[]
  derivations: DerivedChannelDefinition[]
  chartPresets: ChartPresetPluginDefinition[]
  reportSections: ReportSectionPluginDefinition[]
}

export class PluginRegistry {
  private readonly hostVersion: string
  private readonly plugins = new Map<string, JddcPlugin>()
  private readonly parsers = new Map<string, ParserPluginDefinition>()
  private readonly exporters = new Map<string, ExporterPluginDefinition>()
  private readonly operations = new Map<string, OperationDefinition>()
  private readonly derivations = new Map<string, DerivedChannelDefinition>()
  private readonly chartPresets = new Map<string, ChartPresetPluginDefinition>()
  private readonly reportSections = new Map<string, ReportSectionPluginDefinition>()

  constructor(hostVersion: string) {
    if (!isVersion(hostVersion)) throw new Error(`Invalid host version: ${hostVersion}`)
    this.hostVersion = hostVersion
  }

  load(plugin: JddcPlugin): void {
    validatePlugin(plugin)
    if (this.plugins.has(plugin.id)) throw new Error(`Plugin ${plugin.id} is already loaded`)
    if (compareVersions(this.hostVersion, plugin.minimumHostVersion) < 0) {
      throw new Error(`Plugin ${plugin.id} requires host ${plugin.minimumHostVersion} or newer`)
    }

    const staged = createStaging()
    plugin.register(createStagingContext(staged))
    validateStaged(staged)
    this.assertNoCollisions(staged)
    this.commit(staged)
    this.plugins.set(plugin.id, plugin)
  }

  listPlugins(): JddcPlugin[] {
    return sorted(this.plugins)
  }

  listParsers(): ParserPluginDefinition[] {
    return sorted(this.parsers)
  }

  listExporters(): ExporterPluginDefinition[] {
    return sorted(this.exporters)
  }

  listOperations(): OperationDefinition[] {
    return sorted(this.operations)
  }

  listDerivations(): DerivedChannelDefinition[] {
    return sorted(this.derivations)
  }

  listChartPresets(): ChartPresetPluginDefinition[] {
    return sorted(this.chartPresets)
  }

  listReportSections(): ReportSectionPluginDefinition[] {
    return sorted(this.reportSections)
  }

  private assertNoCollisions(staged: StagedRegistrations): void {
    assertUniqueAgainst(this.parsers, staged.parsers, 'parser')
    assertUniqueAgainst(this.exporters, staged.exporters, 'exporter')
    assertUniqueAgainst(this.operations, staged.operations, 'operation')
    assertUniqueAgainst(this.derivations, staged.derivations, 'derivation')
    assertUniqueAgainst(this.chartPresets, staged.chartPresets, 'chart preset')
    assertUniqueAgainst(this.reportSections, staged.reportSections, 'report section')
  }

  private commit(staged: StagedRegistrations): void {
    commitMap(this.parsers, staged.parsers)
    commitMap(this.exporters, staged.exporters)
    commitMap(this.operations, staged.operations)
    commitMap(this.derivations, staged.derivations)
    commitMap(this.chartPresets, staged.chartPresets)
    commitMap(this.reportSections, staged.reportSections)
  }
}

function createStaging(): StagedRegistrations {
  return { parsers: [], exporters: [], operations: [], derivations: [], chartPresets: [], reportSections: [] }
}

function createStagingContext(staged: StagedRegistrations): PluginRegistrationContext {
  return {
    registerParser: (definition) => staged.parsers.push(definition),
    registerExporter: (definition) => staged.exporters.push(definition),
    registerOperation: (definition) => staged.operations.push(definition),
    registerDerivation: (definition) => staged.derivations.push(definition),
    registerChartPreset: (definition) => staged.chartPresets.push(definition),
    registerReportSection: (definition) => staged.reportSections.push(definition),
  }
}

function validatePlugin(plugin: JddcPlugin): void {
  validateDefinition(plugin, 'plugin')
  if (!plugin.label.trim()) throw new Error(`Plugin ${plugin.id} label is required`)
  if (!plugin.description.trim()) throw new Error(`Plugin ${plugin.id} description is required`)
  if (!isVersion(plugin.minimumHostVersion)) throw new Error(`Plugin ${plugin.id} has invalid minimumHostVersion`)
}

function validateStaged(staged: StagedRegistrations): void {
  for (const parser of staged.parsers) {
    validateDefinition(parser, 'parser')
    if (parser.extensions.length === 0) throw new Error(`Parser ${parser.id} must declare an extension`)
    parser.extensions = parser.extensions.map(normalizeExtension)
  }
  for (const exporter of staged.exporters) {
    validateDefinition(exporter, 'exporter')
    exporter.extension = normalizeExtension(exporter.extension)
  }
  for (const operation of staged.operations) validateDefinition(operation, 'operation')
  for (const derivation of staged.derivations) validateDefinition(derivation, 'derivation')
  for (const preset of staged.chartPresets) {
    validateDefinition(preset, 'chart preset')
    if (preset.channelIds.length === 0) throw new Error(`Chart preset ${preset.id} must include a channel`)
  }
  for (const section of staged.reportSections) validateDefinition(section, 'report section')

  assertUniqueWithin(staged.parsers, 'parser')
  assertUniqueWithin(staged.exporters, 'exporter')
  assertUniqueWithin(staged.operations, 'operation')
  assertUniqueWithin(staged.derivations, 'derivation')
  assertUniqueWithin(staged.chartPresets, 'chart preset')
  assertUniqueWithin(staged.reportSections, 'report section')
}

function validateDefinition(definition: { id: string; version: number }, kind: string): void {
  if (!definition.id.trim()) throw new Error(`${kind} id is required`)
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`${kind} ${definition.id} must declare a positive integer version`)
  }
}

function assertUniqueWithin(definitions: Array<{ id: string }>, kind: string): void {
  const seen = new Set<string>()
  for (const definition of definitions) {
    if (seen.has(definition.id)) throw new Error(`Duplicate ${kind} id in plugin: ${definition.id}`)
    seen.add(definition.id)
  }
}

function assertUniqueAgainst(
  existing: Map<string, unknown>,
  definitions: Array<{ id: string }>,
  kind: string,
): void {
  for (const definition of definitions) {
    if (existing.has(definition.id)) throw new Error(`${kind} ${definition.id} is already registered`)
  }
}

function commitMap<T extends { id: string }>(target: Map<string, T>, definitions: T[]): void {
  for (const definition of definitions) target.set(definition.id, definition)
}

function sorted<T extends { id: string }>(values: Map<string, T>): T[] {
  return [...values.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function normalizeExtension(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^\./, '')
  if (!normalized || !/^[a-z0-9]+$/.test(normalized)) throw new Error(`Invalid file extension: ${value}`)
  return normalized
}

function isVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value)
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}
