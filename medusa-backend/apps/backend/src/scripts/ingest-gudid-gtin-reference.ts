import fs from "fs"
import path from "path"
import readline from "readline"
import { Client } from "pg"
import { extractGudidReferenceRows, GtinReferenceRow, normalizeGudidKey } from "../ingestion/gudid"
import { assertDestructiveDbOperationAllowed } from "../utils/db-safety"

/**
 * Load the GS1 brand+model -> GTIN reference (medmkp_gtin_reference) from a local
 * AccessGUDID full release (the directory of FULLDownload_Part*.xml files).
 *
 * The release is ~19GB of XML, so we stream each part line-by-line, slice out
 * <device>...</device> blocks, and batch-insert the distilled rows. TRUNCATE +
 * reinsert, so a remote DATABASE_URL requires ALLOW_REMOTE_DB_DESTRUCTIVE=true.
 *
 * By default this is CATALOG-SCOPED: a GUDID row is kept when its model matches
 * a manufacturer SKU we carry OR its brand_name/company_name contains a brand we
 * carry, so the table doesn't fill prod with unrelated cardiac/ortho/surgical
 * GTINs. The brand path restores rows the scan route's soft-brand join can use
 * but that pure model-scoping dropped. Pass --full to load the entire GS1 GUDID
 * set.
 *
 *   DATABASE_URL=... ts-node src/scripts/ingest-gudid-gtin-reference.ts \
 *     --dir /path/to/gudid_full_release_YYYYMMDD [--full]
 */

const BATCH_ROWS = 2000

function resolveDir(): string {
  const flag = process.argv.indexOf("--dir")
  if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1]
  throw new Error("Pass --dir <gudid full release directory>")
}

// The set of normalized model keys we actually carry. GUDID holds ~430k GS1
// device GTINs across every medical specialty; keeping only the rows whose model
// matches one of ours bounds the table to the few thousand the enrichment could
// ever use, instead of storing unrelated cardiac/ortho/surgical devices.
//
// Two key sources: (1) real manufacturer SKUs across all suppliers, and (2) the
// Henry Schein item number (sku) — GUDID keys HS house-brand products (Criterion
// gloves, Syngauze, etc.) on the HS item number, which is our sku, not an MPN,
// so we'd miss the entire HS house brand without this. Brand/identity agreement
// is still enforced at join time.
async function loadCatalogModelKeys(client: Client): Promise<Set<string>> {
  const { rows } = await client.query<{ model_norm: string }>(
    `select distinct model_norm from (
       select lower(regexp_replace(manufacturer_sku, '[^a-z0-9]', '', 'gi')) model_norm
       from medmkp_supplier_product
       where deleted_at is null and manufacturer_sku <> sku
       union
       select lower(regexp_replace(sku, '[^a-z0-9]', '', 'gi')) model_norm
       from medmkp_supplier_product
       where deleted_at is null and supplier_id = 'msup_henryschein_com'
     ) k
     where length(model_norm) >= 4`
  )
  return new Set(rows.map((r) => r.model_norm))
}

// The set of normalized brands we carry, for the brand-scoped keep path. Model-
// scoping alone drops a GUDID row whenever its model number isn't stored as one
// of our manufacturer SKUs — which loses real matches the soft-brand join in the
// scan route could otherwise make (GUDID's brand_name is often a sub-brand like
// "Premier Curettes" while we store "Premier"). Keeping rows whose brand_name or
// company_name contains a brand we carry restores that coverage. The join still
// enforces model agreement, so the extra rows can only ever *enable* a correct
// match, never fabricate one — they just cost table size.
//
// Length >= 4 keeps the substring test meaningful: 2-3 char brands ("gc", "3m")
// match far too much as a substring. Those products still come in via the model-
// scoped path, so they aren't lost.
async function loadCatalogBrandKeys(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ brand_norm: string }>(
    `select distinct lower(regexp_replace(brand, '[^a-z0-9]', '', 'gi')) brand_norm
       from medmkp_supplier_product
      where deleted_at is null and brand is not null and brand <> ''`
  )
  return rows.map((r) => r.brand_norm).filter((b) => b.length >= 4)
}

// Compile the carried brands into one alternation so each GUDID row is one regex
// test instead of thousands of substring scans over a 19GB stream.
function buildBrandMatcher(brands: string[]): (haystack: string) => boolean {
  if (!brands.length) return () => false
  const escaped = brands.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const re = new RegExp(escaped.join("|"))
  return (haystack: string) => haystack.length >= 4 && re.test(haystack)
}

async function ensureTable(client: Client) {
  await client.query(
    `create table if not exists "medmkp_gtin_reference" ("id" text not null, "gtin" text not null, "brand_norm" text not null, "model_norm" text not null, "brand_name" text null, "model_raw" text null, "company_name" text null, "issuing_agency" text null, "device_id_type" text null, "pkg_quantity" text null, constraint "medmkp_gtin_reference_pkey" primary key ("id"));`
  )
  await client.query(`create index if not exists "IDX_medmkp_gtin_reference_brand_model" on "medmkp_gtin_reference" ("brand_norm", "model_norm");`)
  await client.query(`create index if not exists "IDX_medmkp_gtin_reference_model" on "medmkp_gtin_reference" ("model_norm");`)
}

async function flush(client: Client, rows: GtinReferenceRow[]) {
  if (!rows.length) return
  const cols = ["id", "gtin", "brand_norm", "model_norm", "brand_name", "model_raw", "company_name", "issuing_agency", "device_id_type", "pkg_quantity"]
  const values: unknown[] = []
  const tuples = rows.map((row, i) => {
    const base = i * cols.length
    values.push(row.id, row.gtin, row.brand_norm, row.model_norm, row.brand_name, row.model_raw, row.company_name, row.issuing_agency, row.device_id_type, row.pkg_quantity)
    return `(${cols.map((_, c) => `$${base + c + 1}`).join(",")})`
  })
  await client.query(
    `insert into "medmkp_gtin_reference" (${cols.map((c) => `"${c}"`).join(",")}) values ${tuples.join(",")} on conflict ("id") do nothing`,
    values
  )
}

async function main() {
  assertDestructiveDbOperationAllowed("ingest-gudid-gtin-reference (truncates medmkp_gtin_reference)")

  const dir = resolveDir()
  // Default: only keep GUDID rows whose model matches a catalog MPN. Pass --full
  // to load the entire GS1 GUDID set (every medical specialty) instead.
  const catalogOnly = !process.argv.includes("--full")
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL is not set")

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^FULLDownload_Part\d+_Of_\d+_.*\.xml$/.test(f))
    .sort()
  if (!files.length) throw new Error(`No FULLDownload_Part*.xml files in ${dir}`)
  console.log(`Found ${files.length} GUDID part files in ${dir}`)

  const client = new Client({
    connectionString: databaseUrl,
    ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? undefined : { rejectUnauthorized: false },
  })
  await client.connect()

  try {
    await ensureTable(client)
    await client.query(`truncate table "medmkp_gtin_reference"`)

    const catalogModels = catalogOnly ? await loadCatalogModelKeys(client) : null
    const catalogBrands = catalogOnly ? await loadCatalogBrandKeys(client) : []
    const brandMatches = buildBrandMatcher(catalogBrands)
    console.log(
      catalogModels
        ? `Catalog-scoped: keeping GUDID rows matching ${catalogModels.size} catalog MPNs OR ${catalogBrands.length} carried brands (pass --full to load everything)`
        : `Full load: keeping every GS1 GUDID device`
    )

    let devices = 0
    let inserted = 0
    let keptByModel = 0
    let keptByBrand = 0
    let pending: GtinReferenceRow[] = []
    // Dedupe ids within a batch window so the multi-row insert never lists the
    // same primary key twice (Postgres rejects that even with ON CONFLICT).
    let pendingIds = new Set<string>()

    const started = Date.now()
    for (let fi = 0; fi < files.length; fi++) {
      const stream = fs.createReadStream(path.join(dir, files[fi]), { encoding: "utf8" })
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
      let buf = ""
      for await (const line of rl) {
        buf += line + "\n"
        let end: number
        while ((end = buf.indexOf("</device>")) !== -1) {
          const block = buf.slice(buf.indexOf("<device"), end + "</device>".length)
          buf = buf.slice(end + "</device>".length)
          devices++
          for (const row of extractGudidReferenceRows(block)) {
            if (catalogModels) {
              const byModel = catalogModels.has(row.model_norm)
              const byBrand =
                !byModel &&
                (brandMatches(row.brand_norm) ||
                  brandMatches(normalizeGudidKey(row.company_name)))
              if (!byModel && !byBrand) continue
              if (byModel) keptByModel++
              else keptByBrand++
            }
            if (pendingIds.has(row.id)) continue
            pendingIds.add(row.id)
            pending.push(row)
          }
          if (pending.length >= BATCH_ROWS) {
            await flush(client, pending)
            inserted += pending.length
            pending = []
            pendingIds = new Set<string>()
          }
        }
      }
      console.log(`  [${fi + 1}/${files.length}] ${files[fi]} — ${devices} devices, ~${inserted} rows`)
    }
    await flush(client, pending)
    inserted += pending.length

    const { rows: countRows } = await client.query(`select count(*)::int n, count(distinct brand_norm)::int brands from "medmkp_gtin_reference"`)
    console.log(
      JSON.stringify(
        {
          devices_scanned: devices,
          rows_inserted_attempted: inserted,
          kept_by_model: keptByModel,
          kept_by_brand: keptByBrand,
          rows_in_table: countRows[0].n,
          distinct_brands: countRows[0].brands,
          seconds: Math.round((Date.now() - started) / 1000),
        },
        null,
        2
      )
    )
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
