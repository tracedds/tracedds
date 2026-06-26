import { syncInventoryFromLine } from "../scan-sessions"

// One scanner, no mode: syncInventoryFromLine infers what a scan did to the
// lot-at-location evidence. A lot not yet on the shelf is filed (received); a lot
// already on file is refreshed (confirmed present). capture_type is stamped from
// that — "receiving" on first entry, never overwritten by a later confirm — so the
// compliance distinction survives without the buyer choosing a mode.
function fakeMedmkp(atLocation: any[] = []) {
  const calls = { update: [] as any[], create: [] as any[] }
  const medmkp = {
    listInventoryItems: async () => atLocation,
    updateInventoryItems: async (f: any) => { calls.update.push(f); return f },
    createInventoryItems: async (f: any) => { calls.create.push(f); return { id: "inv_new", ...f } },
    _calls: calls,
  }
  return medmkp as any
}

const ident = {
  canonical_product_id: "mcp_app6",
  supplier_product_id: null,
  name: "Bonding Applicator",
  quantity: 1,
  lot_number: "L1",
  expiration_date: "2028-02-11",
}

describe("syncInventoryFromLine — received vs confirmed inference", () => {
  it("files a lot not yet on the shelf as 'received' and stamps capture_type receiving", async () => {
    const medmkp = fakeMedmkp([])
    const res = await syncInventoryFromLine(medmkp, ident, "loc_1", "actor_1")
    expect(res).toEqual({ id: "inv_new", action: "received" })
    expect(medmkp._calls.create).toHaveLength(1)
    expect(medmkp._calls.create[0].capture_type).toBe("receiving")
    expect(medmkp._calls.update).toHaveLength(0)
  })

  it("confirms a lot already on the shelf and leaves its capture_type untouched", async () => {
    const existing = { id: "inv_1", canonical_product_id: "mcp_app6", lot_number: "L1", pulled_at: null, capture_type: "receiving" }
    const medmkp = fakeMedmkp([existing])
    const res = await syncInventoryFromLine(medmkp, ident, "loc_1", "actor_1")
    expect(res).toEqual({ id: "inv_1", action: "confirmed" })
    expect(medmkp._calls.update).toHaveLength(1)
    // Provenance is preserved: a confirm never rewrites how the lot first entered.
    expect("capture_type" in medmkp._calls.update[0]).toBe(false)
    expect(medmkp._calls.create).toHaveLength(0)
  })

  it("treats a different lot of the same product as a new receive (FEFO coexist)", async () => {
    const existing = { id: "inv_1", canonical_product_id: "mcp_app6", lot_number: "L1", pulled_at: null }
    const medmkp = fakeMedmkp([existing])
    const res = await syncInventoryFromLine(medmkp, { ...ident, lot_number: "L2" }, "loc_1", "actor_1")
    expect(res?.action).toBe("received")
    expect(medmkp._calls.create).toHaveLength(1)
  })

  it("treats a pulled (historical) lot as a new receive, not a revival", async () => {
    const pulled = { id: "inv_1", canonical_product_id: "mcp_app6", lot_number: "L1", pulled_at: new Date() }
    const medmkp = fakeMedmkp([pulled])
    const res = await syncInventoryFromLine(medmkp, ident, "loc_1", "actor_1")
    expect(res?.action).toBe("received")
    expect(medmkp._calls.create).toHaveLength(1)
  })

  it("does not touch inventory for an unidentified line", async () => {
    const medmkp = fakeMedmkp([])
    const res = await syncInventoryFromLine(medmkp, { name: "Unknown", quantity: 1 }, "loc_1", "actor_1")
    expect(res).toBeNull()
    expect(medmkp._calls.create).toHaveLength(0)
    expect(medmkp._calls.update).toHaveLength(0)
  })

  it("does not file evidence when no location is set yet", async () => {
    const medmkp = fakeMedmkp([])
    const res = await syncInventoryFromLine(medmkp, ident, null, "actor_1")
    expect(res).toBeNull()
  })
})
