import type { DerivedChannelDefinition } from '../analytics/registry'
import type { Dataset, ParseResult, SourceFormat } from '../model'
import type { OperationDefinition } from '../recipes/model'

export interface ParserPluginDefinition {
  id: string
  version: number
  /** A built-in SourceFormat, or a plugin-defined format id. Widened to
   *  `string` deliberately — `SourceFormat | string` collapsed to `string`
   *  anyway and read as if it constrained something. */
  sourceFormat: SourceFormat | (string & {})
  extensions: string[]
  binary: boolean
  parse(input: string | ArrayBuffer, fileName: string): Promise<ParseResult> | ParseResult
}

export interface ExportPluginResult {
  fileName: string
  mimeType: string
  text?: string
  bytes?: Uint8Array
  warnings: string[]
}

export interface ExporterPluginDefinition {
  id: string
  version: number
  extension: string
  label: string
  export(dataset: Dataset, options?: unknown): Promise<ExportPluginResult> | ExportPluginResult
}

export interface ChartPresetPluginDefinition {
  id: string
  version: number
  label: string
  xAxis: 'time' | 'index' | 'distance'
  channelIds: string[]
  description?: string
}

export interface ReportSectionPluginDefinition {
  id: string
  version: number
  label: string
  render(dataset: Dataset): Promise<string> | string
}

export interface PluginRegistrationContext {
  registerParser(definition: ParserPluginDefinition): void
  registerExporter(definition: ExporterPluginDefinition): void
  registerOperation<TParams>(definition: OperationDefinition<TParams>): void
  registerDerivation(definition: DerivedChannelDefinition): void
  registerChartPreset(definition: ChartPresetPluginDefinition): void
  registerReportSection(definition: ReportSectionPluginDefinition): void
}

export interface JddcPlugin {
  id: string
  version: number
  label: string
  description: string
  minimumHostVersion: string
  register(context: PluginRegistrationContext): void
}
