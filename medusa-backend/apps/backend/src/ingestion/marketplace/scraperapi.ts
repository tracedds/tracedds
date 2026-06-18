// ScraperAPI account auditing. The marketplace fetcher routes through ScraperAPI
// (a paid, metered service), so each ingest logs credits remaining before/after
// for an audit trail of consumption.

export type ScraperApiCredits = {
  credits_left?: number
  request_limit?: number
  request_count?: number
  concurrency_limit?: number
}

/**
 * Find the ScraperAPI key from SCRAPERAPI_API_KEY, or fall back to the `api_key`
 * query param of MARKETPLACE_SCRAPER_URL when that points at scraperapi.com.
 * Returns undefined when no ScraperAPI key is configured.
 */
export function resolveScraperApiKey(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const explicit = env.SCRAPERAPI_API_KEY?.trim()
  if (explicit) {
    return explicit
  }

  const template = env.MARKETPLACE_SCRAPER_URL ?? ""
  if (!/api\.scraperapi\.com/i.test(template)) {
    return undefined
  }

  return template.match(/[?&]api_key=([^&{}\s]+)/i)?.[1]
}

/**
 * Query the ScraperAPI account endpoint for remaining credits. Never throws —
 * returns undefined on any failure, since credit auditing must not break a run.
 */
export async function fetchScraperApiCredits(
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<ScraperApiCredits | undefined> {
  try {
    const response = await fetchImpl(
      `https://api.scraperapi.com/account?api_key=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(15000) }
    )
    if (!response.ok) {
      return undefined
    }
    const data = (await response.json()) as Record<string, unknown>
    const num = (value: unknown) => (typeof value === "number" ? value : undefined)

    return {
      credits_left: num(data.creditsLeft),
      request_limit: num(data.requestLimit),
      request_count: num(data.requestCount),
      concurrency_limit: num(data.concurrencyLimit),
    }
  } catch {
    return undefined
  }
}
