import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { cleanProductName } from "../ingestion/supplier-pipeline/html"
import { assertDestructiveDbOperationAllowed } from "../utils/db-safety"

// Cleans "weird characters" out of existing product names: decodes leftover HTML
// entities, folds smart punctuation / exotic spaces / non-breaking hyphens to
// ASCII, and strips U+FFFD replacement characters left behind by old bad-charset
// ingests. Uses the same decodeHtml() the ingestion pipeline now runs, so the
// backfill and forward path stay in sync.
//
// DRY-RUN by default; pass `--commit` to write. Writing to a remote DB
// additionally requires ALLOW_REMOTE_DB_DESTRUCTIVE=true.
//
//   npm run catalog:clean-names                                  # dry-run
//   CLEAN_NAMES_COMMIT=true npm run catalog:clean-names           # write (local)
//   CLEAN_NAMES_COMMIT=true ALLOW_REMOTE_DB_DESTRUCTIVE=true \
//     npm run catalog:clean-names                                 # write (remote)

const TARGETS: Array<{ table: string; columns: string[] }> = [
  { table: "medmkp_supplier_product", columns: ["name"] },
  { table: "medmkp_canonical_product", columns: ["name", "family_name", "variant_label"] },
]

const BATCH_SIZE = 2000

export default async function cleanProductNames({
  container,
  args,
}: {
  container: any
  args: string[]
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const commit =
    process.env.CLEAN_NAMES_COMMIT === "true" || (args || []).includes("--commit")
  const dbUrl = process.env.DATABASE_URL || ""
  const host = (() => {
    try {
      return new URL(dbUrl).hostname
    } catch {
      return "?"
    }
  })()

  logger.info(`Clean product names: host=${host} mode=${commit ? "COMMIT" : "DRY-RUN"}`)
  if (commit) {
    assertDestructiveDbOperationAllowed("clean-product-names", dbUrl)
  }

  for (const { table, columns } of TARGETS) {
    let lastId = ""
    let scanned = 0
    let changed = 0
    const samples: string[] = []

    for (;;) {
      const rows: Array<Record<string, string | null>> = await knex(table)
        .select("id", ...columns)
        .where("id", ">", lastId)
        .orderBy("id", "asc")
        .limit(BATCH_SIZE)

      if (!rows.length) break
      lastId = rows[rows.length - 1].id as string

      const updates: Array<{ id: string; patch: Record<string, string> }> = []

      for (const row of rows) {
        scanned++
        const patch: Record<string, string> = {}

        for (const col of columns) {
          const value = row[col]
          if (typeof value !== "string" || !value) continue
          const cleaned = cleanProductName(value)
          if (cleaned !== value) {
            patch[col] = cleaned
            if (samples.length < 15) {
              samples.push(`  ${table}.${col}: "${value.slice(0, 60)}" -> "${cleaned.slice(0, 60)}"`)
            }
          }
        }

        if (Object.keys(patch).length) {
          changed++
          updates.push({ id: row.id as string, patch })
        }
      }

      if (commit && updates.length) {
        await knex.transaction(async (trx: any) => {
          for (const { id, patch } of updates) {
            await trx(table).where("id", id).update(patch)
          }
        })
      }
    }

    logger.info(
      `${table}: scanned=${scanned} changed=${changed} ${commit ? "(written)" : "(dry-run, not written)"}`
    )
    samples.forEach((sample) => logger.info(sample))
  }

  if (!commit) {
    logger.info("Dry-run complete. Re-run with --commit (and CLEAN_NAMES_COMMIT=true) to apply.")
  }
}
