import { defineLink } from "@medusajs/framework/utils"
import CustomerModule from "@medusajs/medusa/customer"
import MedmkpModule from "../modules/medmkp"

// A dental practice can have many customer logins; each customer belongs to one practice.
export default defineLink(
  CustomerModule.linkable.customer,
  MedmkpModule.linkable.medmkpDentalPractice
)
