import fs from "fs"
import path from "path"

/**
 * Resolve the Postgres connection string for standalone (ts-node) scripts.
 * Prefers `process.env.DATABASE_URL`, then falls back to reading `DATABASE_URL`
 * from the backend's `.env`. This lets the data scripts run the same whether or
 * not the var is exported — the matcher already did this; the refresh scripts
 * didn't, which silently broke a manual re-match's read-model refresh on the NUC.
 */
export function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL
  }
  const envPath = path.resolve(__dirname, "../../.env")
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(/^DATABASE_URL=(.+)$/)
      if (match) {
        return match[1].trim()
      }
    }
  }
  throw new Error("DATABASE_URL is not set and could not be read from .env")
}
