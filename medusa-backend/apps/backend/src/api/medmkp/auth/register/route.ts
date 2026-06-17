import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { MEDMKP_MODULE } from "../../../../modules/medmkp"
import type MedMKPModuleService from "../../../../modules/medmkp/service"

type RegisterBody = {
  email?: string
  password?: string
  first_name?: string
  last_name?: string
  practice_name?: string
}

// Signs up a dental practice: creates an emailpass identity, a customer login,
// the dental practice, and links the two. Login itself uses the built-in
// POST /auth/customer/emailpass route.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as RegisterBody
  const email = body.email?.trim().toLowerCase()
  const password = body.password ?? ""
  const firstName = body.first_name?.trim() ?? ""
  const lastName = body.last_name?.trim() ?? ""
  const practiceName = body.practice_name?.trim() ?? ""

  if (!email || !password || !practiceName) {
    res.status(400).json({ error: "email, password, and practice_name are required." })
    return
  }

  const authModule = req.scope.resolve(Modules.AUTH)
  const customerModule = req.scope.resolve(Modules.CUSTOMER)
  const medmkp = req.scope.resolve<MedMKPModuleService>(MEDMKP_MODULE)
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)

  // 1. Create the emailpass auth identity (hashes and stores the password).
  const { success, authIdentity, error } = await authModule.register("emailpass", {
    body: { email, password },
  })

  if (!success || !authIdentity) {
    res.status(409).json({ error: error || "An account with that email already exists." })
    return
  }

  // 2. Create the customer login record.
  const customer = await customerModule.createCustomers({
    email,
    first_name: firstName,
    last_name: lastName,
    has_account: true,
  })

  // 3. Bind the auth identity to the customer so future logins resolve the actor.
  await authModule.updateAuthIdentities({
    id: authIdentity.id,
    app_metadata: { customer_id: customer.id },
  })

  // 4. Create the dental practice and link it to the customer.
  const practice = await medmkp.createDentalPractices({
    name: practiceName,
    primary_contact_name: [firstName, lastName].filter(Boolean).join(" "),
    primary_contact_email: email,
    phone: "",
    website_url: "",
    address_text: "",
    practice_management_system: "",
    status: "active",
  })

  await link.create({
    [Modules.CUSTOMER]: { customer_id: customer.id },
    [MEDMKP_MODULE]: { medmkp_dental_practice_id: practice.id },
  })

  res.status(201).json({
    customer: { id: customer.id, email: customer.email },
    practice: { id: practice.id, name: practice.name },
  })
}
