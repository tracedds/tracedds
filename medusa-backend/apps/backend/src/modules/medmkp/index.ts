import { Module } from "@medusajs/framework/utils"
import medMKPModuleService from "./service"

export const MEDMKP_MODULE = "medmkp"

export default Module(MEDMKP_MODULE, {
  service: medMKPModuleService,
})
