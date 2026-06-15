import { Pool } from "pg"

function intEnv(name: string, fallback: number) {
  const value = process.env[name]
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function shouldUseSsl(databaseUrl: string) {
  if (process.env.DB_SSL === "true") {
    return true
  }

  return !/localhost|127\.0\.0\.1/.test(databaseUrl)
}

let pool: Pool | null = null

export function getPostgresPool() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set")
  }

  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: intEnv("DB_DIRECT_POOL_MAX", 3),
      idleTimeoutMillis: intEnv("DB_POOL_IDLE_TIMEOUT_MS", 30000),
      connectionTimeoutMillis: intEnv("DB_POOL_ACQUIRE_TIMEOUT_MS", 60000),
      ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined,
    })
  }

  return pool
}
