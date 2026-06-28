import path from "path"
import { Client } from "pg"
import { commitMatchRun, loadSupplierProducts } from "../matching/db"
import { runMatching } from "../matching/engine"
import { normalizeProduct } from "../matching/normalize"
import { writeReports } from "../matching/report"
import { assertDestructiveDbOperationAllowed } from "../utils/db-safety"
import { resolveDatabaseUrl } from "../utils/database-url"

async function main() {
  const commit = process.argv.includes("--commit")
  const outputDir = path.resolve(__dirname, "../../.medmkp/matching/latest")

  const databaseUrl = resolveDatabaseUrl()
  if (commit) {
    assertDestructiveDbOperationAllowed(
      "products:match --commit (resets auto-generated matches)",
      databaseUrl
    )
  }
  const client = new Client({
    connectionString: databaseUrl,
    ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? undefined : { rejectUnauthorized: false },
    // The catalog load runs for minutes against the remote prod DB; without TCP
    // keepalive a dropped connection leaves node-pg waiting forever instead of
    // erroring, so the run hangs silently rather than failing fast.
    keepAlive: true,
    keepAliveInitialDelayMillis: 30000,
  })
  await client.connect()

  try {
    console.log("Loading supplier products and latest prices...")
    const rows = await loadSupplierProducts(client)
    console.log(`Loaded ${rows.length} supplier products`)

    console.log("Normalizing...")
    const products = rows.map(normalizeProduct)

    console.log("Matching...")
    const startedAt = Date.now()
    const result = runMatching(products)
    console.log(`Matching finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)

    const summary = writeReports(result, outputDir)
    console.log(JSON.stringify(summary, null, 2))
    console.log(`Reports written to ${outputDir}`)

    if (commit) {
      console.log("Committing matches to Postgres...")
      await commitMatchRun(client, result)
      console.log("Commit complete")
    } else {
      console.log("Dry run (no DB writes). Re-run with --commit to persist matches.")
    }
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
