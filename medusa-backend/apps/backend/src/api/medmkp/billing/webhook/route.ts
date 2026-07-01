import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type Stripe from "stripe"
import { MEDMKP_MODULE } from "../../../../modules/medmkp"
import type MedMKPModuleService from "../../../../modules/medmkp/service"
import { constructWebhookEvent, webhookConfigured, type SubscriptionRow } from "../../../../utils/billing"

// POST /medmkp/billing/webhook — Stripe is the source of truth for subscription
// status; this endpoint keeps medmkp_practice_subscription in sync with it. It is
// NOT session-authed (see middlewares.ts): Stripe signs each payload and we verify
// that signature. The route is deliberately narrow — verify + ingest + persist —
// with no checkout, no plan changes, and no live reconcile pull.
//
// Contract:
//  - Bad / missing signature            -> 400 (Stripe will not retry a 4xx)
//  - Already-seen event.id              -> 200 no-op (idempotency ledger)
//  - Unmappable event (0 or >1 rows)    -> quarantined: logged, skipped, 200
//  - Stale event (older than our truth) -> ordering guard skips the write, 200
//  - Applied                            -> row.status updated + audited, 200
//  - Handler threw                      -> 500 (no ledger row -> Stripe retries)

// The six subscribed event types. Anything else is acknowledged (200) and ignored.
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
])

// Keys we can use to find the practice's subscription row, pulled from the event's
// object. practice_id (from checkout metadata) is the strongest; the Stripe ids
// are one-to-one with a row too. All three columns are unique, so each lookup
// returns at most one row.
type MappingKeys = {
  practiceId?: string
  customerId?: string
  subscriptionId?: string
}

// The target status this event implies, plus the keys to locate the row. Returns
// null for an event whose object we can't read a status from.
function interpret(event: Stripe.Event): { status: SubscriptionRow["status"]; keys: MappingKeys } | null {
  const obj = event.data.object as Record<string, any>
  const metaPractice =
    typeof obj?.metadata?.practice_id === "string" ? obj.metadata.practice_id : undefined
  const asId = (v: unknown) => (typeof v === "string" && v ? v : undefined)

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      // The object IS the Subscription — its own status is authoritative (Stripe
      // sends "canceled" in the object on .deleted).
      return {
        status: obj.status,
        keys: { practiceId: metaPractice, customerId: asId(obj.customer), subscriptionId: asId(obj.id) },
      }
    }
    case "checkout.session.completed": {
      // A completed subscription checkout means the practice is now paying.
      return {
        status: "active",
        keys: {
          practiceId: metaPractice,
          customerId: asId(obj.customer),
          subscriptionId: asId(obj.subscription),
        },
      }
    }
    case "invoice.payment_succeeded": {
      return {
        status: "active",
        keys: {
          practiceId: metaPractice,
          customerId: asId(obj.customer),
          subscriptionId: asId(obj.subscription),
        },
      }
    }
    case "invoice.payment_failed": {
      return {
        status: "past_due",
        keys: {
          practiceId: metaPractice,
          customerId: asId(obj.customer),
          subscriptionId: asId(obj.subscription),
        },
      }
    }
    default:
      return null
  }
}

// Gather the subscription rows any of the keys point at, de-duped by id. Because
// every key column is unique, this is 0 rows (unmapped) or 1 row (mapped); it is
// only >1 when the keys disagree and point at different rows (ambiguous) — both of
// the latter get quarantined.
async function findRows(medmkp: MedMKPModuleService, keys: MappingKeys): Promise<SubscriptionRow[]> {
  const byId = new Map<string, SubscriptionRow>()
  const collect = async (filter: Record<string, string>) => {
    const rows = (await medmkp.listPracticeSubscriptions(filter)) as unknown as SubscriptionRow[]
    for (const r of rows) byId.set(r.id, r)
  }
  if (keys.subscriptionId) await collect({ stripe_subscription_id: keys.subscriptionId })
  if (keys.customerId) await collect({ stripe_customer_id: keys.customerId })
  if (keys.practiceId) await collect({ practice_id: keys.practiceId })
  return [...byId.values()]
}

// Apply one verified, not-yet-seen event. Never throws for an expected anomaly
// (unmapped / ambiguous / stale) — those are logged and skipped so we still 200.
async function handleEvent(medmkp: MedMKPModuleService, event: Stripe.Event): Promise<void> {
  if (!HANDLED.has(event.type)) {
    // Subscribed-to at the endpoint but nothing to do — acknowledge and move on.
    return
  }

  const interpreted = interpret(event)
  if (!interpreted) return
  const { status, keys } = interpreted

  const rows = await findRows(medmkp, keys)
  if (rows.length !== 1) {
    // 0 -> no practice owns this; >1 -> the ids disagree. Guessing could flip the
    // wrong practice's entitlement, so quarantine: log + skip (the reconcile-on-
    // return + deny-path read-through self-heal the legitimate row later).
    console.warn("[billing][webhook] quarantined unmappable event", {
      event_id: event.id,
      type: event.type,
      matched_rows: rows.length,
      keys,
    })
    return
  }

  const row = rows[0]
  // Ordering guard: last_reconciled_at is the as-of time of our latest known truth
  // (written by both reconcile and this handler). An event created at or before
  // that is stale — e.g. a late subscription.updated(active) arriving after a
  // cancel — and must not clobber newer state. Skip the write but still 200.
  const eventTs = new Date(event.created * 1000)
  const knownAsOf = row.last_reconciled_at ? new Date(row.last_reconciled_at as any) : null
  if (knownAsOf && eventTs <= knownAsOf) {
    console.warn("[billing][webhook] skipped stale event (ordering guard)", {
      event_id: event.id,
      type: event.type,
      practice_id: (row as any).practice_id,
      event_at: eventTs.toISOString(),
      known_as_of: knownAsOf.toISOString(),
      would_have_set: status,
      current: row.status,
    })
    return
  }

  const from = row.status
  await medmkp.updatePracticeSubscriptions({ id: row.id, status, last_reconciled_at: eventTs } as any)

  // Audit trail for every applied change (source=webhook), so an entitlement flip
  // is always traceable back to the exact Stripe event that caused it.
  console.log("[billing][webhook] applied", {
    source: "webhook",
    event_id: event.id,
    type: event.type,
    practice_id: (row as any).practice_id,
    from,
    to: status,
    event_at: eventTs.toISOString(),
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!webhookConfigured()) {
    res.status(503).json({ error: "Billing webhook is not configured." })
    return
  }

  const signature = req.headers["stripe-signature"]
  // preserveRawBody (middlewares.ts) stashes the untouched bytes here; without them
  // signature verification can't work, so treat a missing raw body as a 400.
  const rawBody = (req as any).rawBody as Buffer | undefined
  if (typeof signature !== "string" || !rawBody) {
    res.status(400).json({ error: "Missing signature or body." })
    return
  }

  let event: Stripe.Event
  try {
    event = constructWebhookEvent(rawBody, signature)
  } catch (err) {
    // Bad/forged signature (or unparseable payload). 4xx so Stripe stops retrying.
    console.warn("[billing][webhook] signature verification failed", (err as Error).message)
    res.status(400).json({ error: "Invalid signature." })
    return
  }

  const medmkp = req.scope.resolve<MedMKPModuleService>(MEDMKP_MODULE)

  // Idempotency: a redelivered / duplicate event.id is a no-op. The ledger row is
  // written only after a clean handle (below), so a handler failure re-processes.
  const [seen] = await medmkp.listProcessedWebhookEvents({ event_id: event.id }, { take: 1 })
  if (seen) {
    res.json({ received: true, duplicate: true })
    return
  }

  try {
    await handleEvent(medmkp, event)
  } catch (err) {
    // Leave no ledger row -> Stripe's retry gets a real second chance.
    console.error("[billing][webhook] handler failed", { event_id: event.id, type: event.type }, err)
    res.status(500).json({ error: "Webhook handling failed." })
    return
  }

  try {
    await medmkp.createProcessedWebhookEvents({
      event_id: event.id,
      type: event.type,
      processed_at: new Date(),
    })
  } catch (err) {
    // A concurrent duplicate delivery can lose the unique-event_id race; that's
    // fine — the event was handled, so still acknowledge success.
    console.warn("[billing][webhook] ledger insert raced/failed", (err as Error).message)
  }

  res.json({ received: true })
}
