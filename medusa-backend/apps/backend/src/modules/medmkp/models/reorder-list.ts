import { model } from "@medusajs/framework/utils"

// One persisted reorder-list workspace per dental practice, so the working list
// follows the account across devices instead of living only in browser
// localStorage. `state` is the same app-state blob the web app already keeps
// (draftItems, uploadedDocs, archivedLists, listTouched, buyingPrefs,
// defaultBuyingPrefs); we store it whole and use last-write-wins.
const ReorderList = model.define("medmkp_reorder_list", {
  id: model.id({ prefix: "mrl" }).primaryKey(),
  practice_id: model.text().unique(),
  state: model.json(),
})

export default ReorderList
