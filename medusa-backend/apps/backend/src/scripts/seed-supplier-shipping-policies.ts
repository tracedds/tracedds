import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { assertDestructiveDbOperationAllowed } from "../utils/db-safety"

// Curated, source-cited shipping policies for suppliers that PUBLISH a usable
// rule on their website. This makes the otherwise-manual prod write reproducible
// and auditable: re-runnable after a DB reset, reviewable in code, and clear
// about where each number came from.
//
// Most B2B dental distributors quote shipping at checkout or under an account,
// so they are intentionally absent here — leaving their policy null makes the
// app honestly show "Not estimated" rather than inventing a number. Add an entry
// only when the supplier publishes a flat fee and/or a free-shipping threshold,
// or when you have account-specific terms to record.
//
//   npm run supplier:seed-shipping-policies                              # dry-run
//   SEED_SHIPPING_POLICIES_COMMIT=true npm run supplier:seed-shipping-policies          # write (local)
//   SEED_SHIPPING_POLICIES_COMMIT=true ALLOW_REMOTE_DB_DESTRUCTIVE=true npm run supplier:seed-shipping-policies   # write (remote)

type ShipTier = { min_subtotal_cents: number; flat_cents: number }

type Policy = {
  slug: string
  free_shipping_threshold_cents: number | null
  flat_shipping_cents: number | null
  // Tiered flat rate (highest tier whose min_subtotal_cents <= basket wins).
  // Takes precedence over flat_shipping_cents; leave undefined for single-flat.
  shipping_flat_tiers?: ShipTier[] | null
  shipping_policy_notes: string
  // Layer 1 delivery promise. Stated ground transit window in business days +
  // optional same-day cutoff. Leave undefined when the supplier publishes no
  // usable delivery promise (we then show "ship time not estimated").
  transit_days_min?: number | null
  transit_days_max?: number | null
  order_cutoff_local?: string | null
  ships_same_day?: boolean | null
  // Layer 2 origin(s) for per-destination ground estimation. Only set when the
  // DC location is confirmed — an incomplete origin would contradict the promise.
  dist_center_zips?: string | null
  ship_carrier?: string | null
  shipping_time_notes?: string | null
}

const PUBLISHED_POLICIES: Policy[] = [
  {
    slug: "dc-dental",
    free_shipping_threshold_cents: null,
    flat_shipping_cents: 800,
    shipping_policy_notes:
      "Published policy: $8 minimum handling fee includes shipping (dcdental.com/terms-conditions, retrieved 2026-06-19).",
    // Single Windsor Mill, MD distribution center → per-destination ground estimate.
    order_cutoff_local: "15:00 ET",
    ships_same_day: true,
    dist_center_zips: "21244",
    shipping_time_notes:
      "Same-day shipping on orders placed by 3pm ET; ships from the Windsor Mill, MD distribution center (dcdental.com/warehouse, retrieved 2026-06-22).",
  },
  {
    slug: "carolina-dental-supply",
    free_shipping_threshold_cents: 25000,
    flat_shipping_cents: null,
    shipping_policy_notes:
      "Published policy: free standard shipping on US orders over $250; under $250 calculated at checkout (carolinadental.com/policies/shipping-policy, retrieved 2026-06-19).",
    // Single High Point, NC location → per-destination ground estimate.
    ships_same_day: true,
    dist_center_zips: "27260",
    shipping_time_notes:
      "Same-day shipping on in-stock orders; ships from High Point, NC (carolinadental.com, retrieved 2026-06-22).",
  },
  {
    slug: "darby-dental",
    free_shipping_threshold_cents: null,
    // Two-tier flat rate: $13.95 under $150, $10.95 at $150+.
    flat_shipping_cents: null,
    shipping_flat_tiers: [
      { min_subtotal_cents: 0, flat_cents: 1395 },
      { min_subtotal_cents: 15000, flat_cents: 1095 },
    ],
    shipping_policy_notes:
      "Published policy: flat-rate shipping — $13.95 on orders under $150, $10.95 on orders $150+ (darbydental.com/Scripts/Policies.aspx, retrieved 2026-06-21).",
    // Door-to-door promise. DCs are not individually confirmed, so Layer 2
    // distance refinement is intentionally left off (no dist_center_zips) to
    // avoid contradicting the published 1–2 day reach.
    transit_days_min: 1,
    transit_days_max: 2,
    shipping_time_notes:
      "Published: 1–2 business day delivery to most of the US via regional distribution centers + automated/barcode picking (darbydental.com/about-us, retrieved 2026-06-21).",
  },
  {
    slug: "dental-city",
    free_shipping_threshold_cents: 20000,
    flat_shipping_cents: 1000,
    shipping_policy_notes:
      "Published policy: $10 flat shipping on orders under $200; free shipping on orders $200+ for Keys to the City members (dentalcity.com, retrieved 2026-06-22).",
    // Single Green Bay DC → per-destination ground estimate (no published transit window).
    order_cutoff_local: "16:00 CT",
    ships_same_day: true,
    dist_center_zips: "54311",
    shipping_time_notes:
      "Same-day shipping on in-stock orders placed by 4pm CT; ships from the Green Bay, WI distribution center (dentalcity.com, retrieved 2026-06-22).",
  },
  {
    slug: "practicon",
    free_shipping_threshold_cents: 14999,
    flat_shipping_cents: 1033,
    shipping_policy_notes:
      "Published policy: $10.33 flat shipping on orders under $149.99; free shipping on orders $149.99+ (practicon.com/shipping-returns, retrieved 2026-06-22).",
    // Single Greenville, NC location → per-destination ground estimate (ships within 24h).
    dist_center_zips: "27834",
    shipping_time_notes:
      "Orders ship within 24 hours; ships from Greenville, NC (practicon.com/shipping-returns, retrieved 2026-06-22).",
  },
  {
    slug: "american-dental-accessories",
    // Shipping calculated at checkout by weight — no published flat or free threshold.
    free_shipping_threshold_cents: null,
    flat_shipping_cents: null,
    shipping_policy_notes:
      "Shipping calculated at checkout (ground / USPS Ground Advantage by weight); no published flat or free-shipping threshold (amerdental.com/pages/shipping, retrieved 2026-06-22).",
    // Single Minneapolis warehouse → per-destination ground estimate; published
    // door-to-door cap of 4 business days (lower 48) is the fallback when the
    // buyer's ship-to state is unknown.
    transit_days_max: 4,
    order_cutoff_local: "16:30 ET",
    ships_same_day: true,
    dist_center_zips: "55426",
    ship_carrier: "ground",
    shipping_time_notes:
      "Most orders ship same day if ordered by 4:30pm ET; delivered in 4 business days or less to the lower 48 via ground/USPS; ships from Minneapolis, MN. Back-orders ship free; some items drop-ship separately (amerdental.com/pages/shipping, retrieved 2026-06-22).",
  },
]

const usd = (cents: number | null) => (cents == null ? "—" : `$${(cents / 100).toFixed(2)}`)

export default async function seedSupplierShippingPolicies({ container, args }: { container: any; args: string[] }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const commit = process.env.SEED_SHIPPING_POLICIES_COMMIT === "true" || (args || []).includes("--commit")
  const dbUrl = process.env.DATABASE_URL || ""
  const host = (() => { try { return new URL(dbUrl).hostname } catch { return "?" } })()

  logger.info(`Seed supplier shipping policies: host=${host} mode=${commit ? "COMMIT" : "DRY-RUN"}`)
  if (commit) assertDestructiveDbOperationAllowed("seed-supplier-shipping-policies", dbUrl)

  let updated = 0
  let missing = 0
  for (const policy of PUBLISHED_POLICIES) {
    const rows: Array<{ id: string; name: string }> = await knex("medmkp_supplier")
      .select("id", "name")
      .where("slug", policy.slug)
      .whereNull("deleted_at")
    if (!rows.length) {
      logger.warn(`  skip ${policy.slug}: no matching supplier`)
      missing += 1
      continue
    }
    const tierLabel = policy.shipping_flat_tiers
      ? policy.shipping_flat_tiers.map((t) => `${usd(t.flat_cents)}@${usd(t.min_subtotal_cents)}+`).join(" / ")
      : null
    const transitLabel =
      policy.transit_days_min != null || policy.transit_days_max != null
        ? `, transit ${policy.transit_days_min ?? "?"}–${policy.transit_days_max ?? "?"}d`
        : ""
    logger.info(
      `  ${rows[0].name} (${policy.slug}): free≥${usd(policy.free_shipping_threshold_cents)}, flat ${tierLabel ?? usd(policy.flat_shipping_cents)}${transitLabel}`
    )
    if (commit) {
      await knex("medmkp_supplier")
        .where("slug", policy.slug)
        .whereNull("deleted_at")
        .update({
          free_shipping_threshold_cents: policy.free_shipping_threshold_cents,
          flat_shipping_cents: policy.flat_shipping_cents,
          shipping_flat_tiers:
            policy.shipping_flat_tiers != null ? JSON.stringify(policy.shipping_flat_tiers) : null,
          shipping_policy_notes: policy.shipping_policy_notes,
          transit_days_min: policy.transit_days_min ?? null,
          transit_days_max: policy.transit_days_max ?? null,
          order_cutoff_local: policy.order_cutoff_local ?? null,
          ships_same_day: policy.ships_same_day ?? null,
          dist_center_zips: policy.dist_center_zips ?? null,
          ship_carrier: policy.ship_carrier ?? null,
          shipping_time_notes: policy.shipping_time_notes ?? null,
          updated_at: knex.fn.now(),
        })
      updated += rows.length
    }
  }

  logger.info(
    commit
      ? `COMMIT complete — updated ${updated} supplier(s), ${missing} not found.`
      : `DRY-RUN complete — ${PUBLISHED_POLICIES.length - missing} supplier(s) would be updated, ${missing} not found. Re-run with --commit to persist.`
  )
}
