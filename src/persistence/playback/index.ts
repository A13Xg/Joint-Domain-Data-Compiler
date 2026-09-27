// .jddc-playback: a scoped profile of the project archive — entities + points,
// no undo/redo history, no recipes/fusion/bookmarks. Reuses the existing
// gzip-JSON archive codec wholesale (see docs/superpowers/specs/2026-09-27-jddc-suite-design.md
// §11.1): no separate format, no separate validation boundary. `buildProjectManifest`
// is called with no recipes/fusionArtifacts/bookmarks input, so the manifest it
// produces has none of those by construction — never pruned after the fact,
// so there is nothing to accidentally leave dangling.
import type { Dataset } from '../../core/model'
import { EMPTY_WORKSPACE_SELECTION } from '../../core/selection'
import type { WorkspaceDisplay } from '../../state/workspaceDisplay'
import {
  buildProjectManifest,
  createProjectArchive,
  decodeProjectArchive,
  encodeProjectArchive,
  serializeProjectArchive,
  type ProjectArchive,
} from '../project/archive'

export interface PlaybackDatasetMetadata {
  callsign?: string
  aircraftType?: string
}

export interface BuildPlaybackArchiveInput {
  datasets: Dataset[]
  /** Callsign/aircraft type per dataset id, keyed the same way as datasetDisplay. */
  datasetMetadata?: Readonly<Record<string, PlaybackDatasetMetadata>>
  /** Reused for per-dataset color only — visibility/opacity/label stay workbench-local. */
  datasetDisplay?: WorkspaceDisplay
  scenarioName?: string
  applicationVersion: string
}

/**
 * Builds a `.jddc-playback` archive: the same `ProjectArchive` shape as
 * `.jddc-project`, scoped to just the given datasets with empty history.
 * Every entry in `manifest.datasets` keeps its original `sourceFormat` and
 * `sourceFileName` — playback export is a repackaging, never a re-labeling
 * that would destroy provenance.
 */
export function buildPlaybackArchive(input: BuildPlaybackArchiveInput): ProjectArchive {
  // `view.datasetDisplay` validation rejects any entry whose id isn't one of
  // the manifest's own datasets, so a caller's full, workspace-wide display
  // map (which may cover datasets outside this export's subset) must be
  // narrowed first — never passed through as-is.
  const includedIds = new Set(input.datasets.map((dataset) => dataset.id))
  const scopedDisplay = input.datasetDisplay
    ? Object.fromEntries(Object.entries(input.datasetDisplay).filter(([id]) => includedIds.has(id)))
    : undefined
  const manifest = buildProjectManifest({
    datasets: input.datasets,
    activeDatasetId: input.datasets[0]?.id ?? null,
    activeTab: 'overview',
    selection: EMPTY_WORKSPACE_SELECTION,
    datasetDisplay: scopedDisplay,
    datasetSuiteMetadata: input.datasetMetadata,
    projectName: input.scenarioName,
    applicationVersion: input.applicationVersion,
  })
  return createProjectArchive({
    manifest,
    datasets: input.datasets,
    histories: Object.fromEntries(input.datasets.map((dataset) => [dataset.id, { past: [], future: [] }])),
  })
}

/** Gzip-compressed `.jddc-playback` bytes (default — matches `.jddc-project`). */
export async function encodePlaybackArchive(archive: ProjectArchive): Promise<Blob> {
  return encodeProjectArchive(archive)
}

/**
 * Uncompressed `.jddc-playback` bytes: opens directly in a text editor.
 * `decodePlaybackArchive` (and `decodeProjectArchive`) read either form —
 * the gzip magic bytes are sniffed, not assumed — so this is not a format
 * fork, just an export option.
 */
export function encodePlaybackArchiveUncompressed(archive: ProjectArchive): Blob {
  return new Blob([serializeProjectArchive(archive)], { type: 'application/vnd.jddc.playback+json' })
}

/** Reads either a gzip or plain-JSON `.jddc-playback` file. Identical validation to `.jddc-project`. */
export async function decodePlaybackArchive(file: Blob): Promise<ProjectArchive> {
  return decodeProjectArchive(file)
}
