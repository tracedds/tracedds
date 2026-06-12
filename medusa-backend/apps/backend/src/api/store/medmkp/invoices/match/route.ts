import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Client } from "pg"
import {
  loadCatalogIndex,
  matchLineItem,
  resolveVendorSupplier,
  type CatalogIndex,
  type LineItemInput,
} from "../../../../../matching/line-items"

const INDEX_TTL_MS = 5 * 60 * 1000

let indexPromise: Promise<CatalogIndex> | null = null

async function buildIndex(): Promise<CatalogIndex> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set")
  }
  const client = new Client({
    connectionString: databaseUrl,
    ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? undefined : { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    return await loadCatalogIndex(client)
  } finally {
    await client.end()
  }
}

async function getIndex(): Promise<CatalogIndex> {
  if (indexPromise) {
    const index = await indexPromise.catch(() => null)
    if (index && Date.now() - index.loadedAt < INDEX_TTL_MS) {
      return index
    }
  }
  indexPromise = buildIndex()
  try {
    return await indexPromise
  } catch (error) {
    indexPromise = null
    throw error
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as {
    vendor_name?: string
    line_items?: LineItemInput[]
  }

  const lineItems = Array.isArray(body.line_items) ? body.line_items : []
  if (!lineItems.length) {
    res.status(400).json({ error: "line_items is required" })
    return
  }
  if (lineItems.some((item) => !item || typeof item.description !== "string" || !item.description.trim())) {
    res.status(400).json({ error: "every line item needs a description" })
    return
  }

  const index = await getIndex()
  const vendorSupplierId = resolveVendorSupplier(index, body.vendor_name)
  const matches = lineItems
    .slice(0, 200)
    .map((item) => matchLineItem(index, item, vendorSupplierId))

  const totals = matches.reduce(
    (acc, match) => {
      const qty = match.input.qty ?? 1
      if (match.input.unit_price_cents != null) {
        acc.invoice_cents += match.input.unit_price_cents * qty
      }
      if (match.best_offer && match.input.unit_price_cents != null) {
        acc.suggested_cents += Math.min(
          match.best_offer.comparable_price_cents,
          match.input.unit_price_cents
        ) * qty
      } else if (match.input.unit_price_cents != null) {
        acc.suggested_cents += match.input.unit_price_cents * qty
      }
      acc.savings_cents += match.savings_cents
      return acc
    },
    { invoice_cents: 0, suggested_cents: 0, savings_cents: 0 }
  )

  res.json({
    vendor_supplier_id: vendorSupplierId,
    catalog_products: index.products.length,
    line_items: matches,
    summary: {
      ...totals,
      matched: matches.filter((match) => match.match_status !== "unmatched").length,
      exact: matches.filter((match) => match.match_status === "exact").length,
      variant: matches.filter((match) => match.match_status === "variant").length,
      needs_review: matches.filter((match) => match.match_status === "needs_review").length,
      unmatched: matches.filter((match) => match.match_status === "unmatched").length,
    },
  })
}
