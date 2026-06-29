import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MEDMKP_MODULE } from "../../../../modules/medmkp"
import type MedMKPModuleService from "../../../../modules/medmkp/service"
import { requirePractice } from "../../../../utils/practice"
import {
  buildEvidenceWrite,
  loadOwnedEvidence,
  EVIDENCE_REVIEWED_STATUSES,
} from "../../../../utils/evidence"

// GET /medmkp/evidence/:id — one practice-owned evidence document.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const practiceId = await requirePractice(req, res)
  if (!practiceId) return
  const medmkp = req.scope.resolve<MedMKPModuleService>(MEDMKP_MODULE)
  const doc = await loadOwnedEvidence(medmkp, req.params.id, practiceId, res)
  if (!doc) return
  res.json({ evidence: doc })
}

// PATCH /medmkp/evidence/:id — partial update of editable metadata, linkage, and
// review status. Moving status to a reviewed state (verified/rejected) stamps
// reviewed_at/reviewed_by unless the caller set them explicitly.
export async function PATCH(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const practiceId = await requirePractice(req, res)
  if (!practiceId) return
  const medmkp = req.scope.resolve<MedMKPModuleService>(MEDMKP_MODULE)
  const doc = await loadOwnedEvidence(medmkp, req.params.id, practiceId, res)
  if (!doc) return

  const body = (req.body ?? {}) as Record<string, any>
  const built = buildEvidenceWrite(body, { isCreate: false })
  if ("error" in built) {
    res.status(422).json({ error: built.error })
    return
  }

  const actor = req.auth_context?.actor_id ?? null
  const update: Record<string, any> = { ...built.fields, id: doc.id, updated_by: actor }

  if (
    EVIDENCE_REVIEWED_STATUSES.includes(update.status) &&
    update.status !== doc.status
  ) {
    if (update.reviewed_at === undefined) update.reviewed_at = new Date()
    if (update.reviewed_by === undefined) update.reviewed_by = actor
  }

  const saved = await medmkp.updateEvidenceDocuments(update)
  res.json({ evidence: saved })
}
