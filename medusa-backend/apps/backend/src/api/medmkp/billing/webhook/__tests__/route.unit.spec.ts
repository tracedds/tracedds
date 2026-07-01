// Fake the Stripe signature verification + config via the billing helpers, so the
// route is exercised without a live Stripe endpoint (Stripe fixtures / a test
// secret would produce the same event objects). constructWebhookEvent returns a
// crafted event, or throws to simulate a bad signature.
const constructWebhookEvent = jest.fn()
jest.mock("../../../../../utils/billing", () => ({
  webhookConfigured: jest.fn(() => true),
  constructWebhookEvent: (...args: any[]) => constructWebhookEvent(...args),
}))

import { POST } from "../route"
import { webhookConfigured } from "../../../../../utils/billing"

const mockConfigured = webhookConfigured as jest.Mock

// In-memory subscription store keyed by row id, with the unique-column lookups the
// route uses (stripe_subscription_id / stripe_customer_id / practice_id).
function makeService(rows: any[] = []) {
  const subs = [...rows]
  const ledger: any[] = []
  const listPracticeSubscriptions = jest.fn(async (filter: any = {}) =>
    subs.filter((r) =>
      Object.entries(filter).every(([k, v]) => (r as any)[k] === v)
    )
  )
  const updatePracticeSubscriptions = jest.fn(async (patch: any) => {
    const row = subs.find((r) => r.id === patch.id)
    Object.assign(row, patch)
    return row
  })
  const listProcessedWebhookEvents = jest.fn(async (filter: any = {}) =>
    ledger.filter((e) => e.event_id === filter.event_id)
  )
  const createProcessedWebhookEvents = jest.fn(async (row: any) => {
    if (ledger.some((e) => e.event_id === row.event_id)) {
      throw new Error("duplicate event_id")
    }
    ledger.push(row)
    return row
  })
  return {
    subs,
    ledger,
    service: {
      listPracticeSubscriptions,
      updatePracticeSubscriptions,
      listProcessedWebhookEvents,
      createProcessedWebhookEvents,
    },
  }
}

function makeReq(service: any, { signature = "sig_ok", rawBody = Buffer.from("{}") } = {}) {
  return {
    headers: signature == null ? {} : { "stripe-signature": signature },
    rawBody,
    scope: { resolve: () => service },
  } as any
}

function makeRes() {
  const res: any = { statusCode: 200 }
  res.status = (c: number) => ((res.statusCode = c), res)
  res.json = (p: any) => ((res.body = p), res)
  return res
}

// Event factory. `created` is Unix seconds (for the ordering guard).
function evt(type: string, object: any, { id = `evt_${Math.random().toString(36).slice(2)}`, created = 1_700_000_000 } = {}) {
  return { id, type, created, data: { object } }
}

function subRow(over: any = {}) {
  return {
    id: "mps_1",
    practice_id: "prac_1",
    status: "active",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    last_reconciled_at: null,
    ...over,
  }
}

beforeEach(() => {
  constructWebhookEvent.mockReset()
  mockConfigured.mockReset().mockReturnValue(true)
})

describe("POST /medmkp/billing/webhook", () => {
  it("503s when the webhook is not configured", async () => {
    mockConfigured.mockReturnValue(false)
    const { service } = makeService()
    const res = makeRes()
    await POST(makeReq(service), res)
    expect(res.statusCode).toBe(503)
    expect(constructWebhookEvent).not.toHaveBeenCalled()
  })

  it("400s a bad signature and writes no ledger row", async () => {
    constructWebhookEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature")
    })
    const { service, ledger } = makeService([subRow()])
    const res = makeRes()
    await POST(makeReq(service, { signature: "sig_bad" }), res)
    expect(res.statusCode).toBe(400)
    expect(ledger).toHaveLength(0)
  })

  it("400s when the raw body is missing", async () => {
    const { service } = makeService([subRow()])
    const req = makeReq(service)
    delete req.rawBody
    const res = makeRes()
    await POST(req, res)
    expect(res.statusCode).toBe(400)
    expect(constructWebhookEvent).not.toHaveBeenCalled()
  })

  it("applies a valid signed event and reflects the new status", async () => {
    const { service, subs, ledger } = makeService([subRow({ status: "active" })])
    constructWebhookEvent.mockReturnValue(
      evt("invoice.payment_failed", { customer: "cus_1", subscription: "sub_1" })
    )
    const res = makeRes()
    await POST(makeReq(service), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ received: true })
    expect(subs[0].status).toBe("past_due")
    expect(ledger).toHaveLength(1)
  })

  it("is idempotent: a duplicate event.id is a no-op", async () => {
    const { service, subs } = makeService([subRow({ status: "active" })])
    const event = evt("invoice.payment_failed", { customer: "cus_1", subscription: "sub_1" }, { id: "evt_dup" })
    constructWebhookEvent.mockReturnValue(event)
    const res1 = makeRes()
    await POST(makeReq(service), res1)
    expect(subs[0].status).toBe("past_due")

    // Second delivery of the same event.id: bump the row so we can prove no write.
    subs[0].status = "active"
    subs[0].last_reconciled_at = null
    const res2 = makeRes()
    await POST(makeReq(service), res2)
    expect(res2.statusCode).toBe(200)
    expect(res2.body).toEqual({ received: true, duplicate: true })
    expect(subs[0].status).toBe("active") // untouched
    expect(service.updatePracticeSubscriptions).toHaveBeenCalledTimes(1)
  })

  it("ordering guard: a stale updated(active) after a cancel does not resurrect active", async () => {
    const { service, subs } = makeService([subRow({ status: "active" })])

    // 1) cancel at T2
    constructWebhookEvent.mockReturnValue(
      evt("customer.subscription.deleted", { id: "sub_1", customer: "cus_1", status: "canceled" }, { id: "evt_cancel", created: 2000 })
    )
    await POST(makeReq(service), makeRes())
    expect(subs[0].status).toBe("canceled")

    // 2) a late updated(active) generated earlier, at T1 < T2
    constructWebhookEvent.mockReturnValue(
      evt("customer.subscription.updated", { id: "sub_1", customer: "cus_1", status: "active" }, { id: "evt_stale", created: 1000 })
    )
    const res = makeRes()
    await POST(makeReq(service), res)
    expect(res.statusCode).toBe(200)
    expect(subs[0].status).toBe("canceled") // NOT resurrected
  })

  it("quarantines an unmappable event (0 rows) without crashing", async () => {
    const { service, subs, ledger } = makeService([subRow()])
    constructWebhookEvent.mockReturnValue(
      evt("customer.subscription.updated", { id: "sub_UNKNOWN", customer: "cus_UNKNOWN", status: "past_due" })
    )
    const res = makeRes()
    await POST(makeReq(service), res)
    expect(res.statusCode).toBe(200)
    expect(subs[0].status).toBe("active") // untouched
    expect(service.updatePracticeSubscriptions).not.toHaveBeenCalled()
    expect(ledger).toHaveLength(1) // decision recorded
  })

  it("quarantines an ambiguous event whose ids point at different rows", async () => {
    const { service } = makeService([
      subRow({ id: "mps_1", practice_id: "prac_1", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" }),
      subRow({ id: "mps_2", practice_id: "prac_2", stripe_customer_id: "cus_2", stripe_subscription_id: "sub_2" }),
    ])
    // customer of row A but subscription of row B -> two distinct rows -> ambiguous.
    constructWebhookEvent.mockReturnValue(
      evt("customer.subscription.updated", { id: "sub_2", customer: "cus_1", status: "past_due" })
    )
    const res = makeRes()
    await POST(makeReq(service), res)
    expect(res.statusCode).toBe(200)
    expect(service.updatePracticeSubscriptions).not.toHaveBeenCalled()
  })

  it.each([
    ["checkout.session.completed", { customer: "cus_1", subscription: "sub_1", metadata: { practice_id: "prac_1" } }, "active"],
    ["customer.subscription.created", { id: "sub_1", customer: "cus_1", status: "trialing" }, "trialing"],
    ["customer.subscription.updated", { id: "sub_1", customer: "cus_1", status: "past_due" }, "past_due"],
    ["customer.subscription.deleted", { id: "sub_1", customer: "cus_1", status: "canceled" }, "canceled"],
    ["invoice.payment_succeeded", { customer: "cus_1", subscription: "sub_1" }, "active"],
    ["invoice.payment_failed", { customer: "cus_1", subscription: "sub_1" }, "past_due"],
  ])("maps %s -> %s", async (type, object, expected) => {
    const { service, subs } = makeService([subRow({ status: "incomplete", last_reconciled_at: null })])
    constructWebhookEvent.mockReturnValue(evt(type as string, object))
    const res = makeRes()
    await POST(makeReq(service), res)
    expect(res.statusCode).toBe(200)
    expect(subs[0].status).toBe(expected)
  })

  it("acknowledges an unsubscribed event type without touching the row", async () => {
    const { service, subs } = makeService([subRow()])
    constructWebhookEvent.mockReturnValue(evt("customer.created", { id: "cus_1" }))
    const res = makeRes()
    await POST(makeReq(service), res)
    expect(res.statusCode).toBe(200)
    expect(service.updatePracticeSubscriptions).not.toHaveBeenCalled()
  })
})
