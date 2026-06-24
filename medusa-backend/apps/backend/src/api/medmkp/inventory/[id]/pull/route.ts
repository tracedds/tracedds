import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MEDMKP_MODULE } from "../../../../../modules/medmkp"
import type MedMKPModuleService from "../../../../../modules/medmkp/service"
import { requirePractice } from "../../../../../utils/practice"
import { needsAttention, deriveLifecycle, loadOwnedItem, PULL_REASONS } from "../../../../../utils/inventory"

// POST /medmkp/inventory/:id/pull — record the human-confirmed physical removal
// of a lot (reason: expiry | recall | manual), or undo it (`{ pulled: false }`).
// This is the ONLY thing that moves a lot out of the active set: expiry escalates
// a lot to "pull now" but never removes it; a person confirming the pull does.
// The record is kept (soft state, not deleted) as audit history.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const practiceId = await requirePractice(req, res)
  if (!practiceId) return
  const medmkp = req.scope.resolve<MedMKPModuleService>(MEDMKP_MODULE)
  const owned = await loadOwnedItem(medmkp, req.params.id, practiceId, res)
  if (!owned) return

  const body = (req.body ?? {}) as Record<string, any>
  const pulling = body.pulled !== false // default: pull

  const update: Record<string, any> = { id: owned.item.id }
  if (pulling) {
    update.pulled_at = new Date()
    update.pulled_reason =
      typeof body.reason === "string" && (PULL_REASONS as readonly string[]).includes(body.reason)
        ? body.reason
        : "manual"
  } else {
    // Undo: bring the lot back into the active set.
    update.pulled_at = null
    update.pulled_reason = null
  }

  const saved = await medmkp.updateInventoryItems(update)
  res.json({
    item: { ...saved, needs_attention: needsAttention(saved), lifecycle: deriveLifecycle(saved) },
  })
}
