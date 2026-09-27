import type { Dataset } from '../../core/model'
import { assessDatasetCompatibility } from '../../core/metadataCompatibility'

/**
 * Why another dataset may, or may not, share the 3D scene with the active one.
 *
 * - `compatible`: both declare the same altitude and time references.
 * - `same-recording`: tracks decoded from one P5 recording. Their datum is
 *   "unknown" only in the sense that the file does not name it — every slot is
 *   placed through the same georeference and anchor, so relative geometry
 *   between them is exact by construction.
 * - `unknown-reference`: at least one side does not declare its references.
 *   Drawing them together is fine for looking at shapes, but a height
 *   difference between them may be a datum difference, so it is opt-in.
 * - `blocked`: the references are declared and differ.
 */
export type SceneCompanionStatus = 'compatible' | 'same-recording' | 'unknown-reference' | 'blocked'

export function sceneCompanionStatus(primary: Dataset, candidate: Dataset): { status: SceneCompanionStatus; reasons: string[] } {
  const compatibility = assessDatasetCompatibility(primary, candidate)
  if (compatibility.level === 'compatible') return { status: 'compatible', reasons: [] }
  if (compatibility.level === 'blocked') return { status: 'blocked', reasons: compatibility.reasons }
  const primaryKey = primary.metadata?.meta?.p5DocumentKey
  if (primaryKey && primaryKey === candidate.metadata?.meta?.p5DocumentKey) return { status: 'same-recording', reasons: [] }
  return { status: 'unknown-reference', reasons: compatibility.reasons }
}

export interface SceneCompanionPlan {
  included: Dataset[]
  /** Unknown-reference datasets left out because the opt-in is off. */
  heldBack: Dataset[]
  blocked: Dataset[]
  /** Included only because the opt-in is on: shapes comparable, heights may not be. */
  includedWithUnknownReference: Dataset[]
}

export function planSceneCompanions(primary: Dataset, others: readonly Dataset[], includeUnknownReferences: boolean): SceneCompanionPlan {
  const plan: SceneCompanionPlan = { included: [], heldBack: [], blocked: [], includedWithUnknownReference: [] }
  for (const candidate of others) {
    if (candidate.id === primary.id) continue
    const { status } = sceneCompanionStatus(primary, candidate)
    if (status === 'blocked') plan.blocked.push(candidate)
    else if (status === 'unknown-reference') {
      if (includeUnknownReferences) { plan.included.push(candidate); plan.includedWithUnknownReference.push(candidate) }
      else plan.heldBack.push(candidate)
    } else plan.included.push(candidate)
  }
  return plan
}
