import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { MEDMKP_MODULE } from "../../../modules/medmkp"
import type MedMKPModuleService from "../../../modules/medmkp/service"
import { resolvePracticeId } from "../../../utils/practice"

// Identity for the signed-in buyer: their name (for the topbar/profile) and the
// practice they belong to (for the list header). The frontend /api/auth/me
// proxies this with the session cookie as a Bearer token.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    res.status(401).json({ error: "Not authenticated." })
    return
  }

  const customerModule = req.scope.resolve(Modules.CUSTOMER)
  const customer = await customerModule.retrieveCustomer(customerId).catch(() => null)

  let practice: { id: string; name: string } | null = null
  const practiceId = await resolvePracticeId(req)
  if (practiceId) {
    const medmkp = req.scope.resolve<MedMKPModuleService>(MEDMKP_MODULE)
    const [row] = await medmkp.listDentalPractices({ id: practiceId })
    if (row) practice = { id: row.id, name: row.name }
  }

  res.json({
    customer: customer
      ? { first_name: customer.first_name, last_name: customer.last_name, email: customer.email }
      : null,
    practice,
  })
}
