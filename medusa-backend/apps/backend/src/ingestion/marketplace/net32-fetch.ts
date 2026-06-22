import type {
  MarketplaceFetchOptions,
  MarketplaceFetchResult,
  MarketplaceFetcher,
} from "./types"

const DEFAULT_SIDECAR_URL = "http://127.0.0.1:8791"
// A Net32 browser search (navigate + clear challenge + getBestPrice) routinely
// takes 20-35s. The marketplace CLI defaults --timeout-ms to 20s (fine for proxy
// fetches), which would abort legitimate Net32 searches — so this fetcher floors
// the timeout at this value regardless of what the caller passes.
const DEFAULT_TIMEOUT_MS = 90000

export type Net32SidecarOptions = {
  /** Base URL of the net32-harvester sidecar (NUC, headful Chromium under xvfb). */
  baseUrl?: string
  /** Shared-secret bearer token, when the sidecar requires one. */
  token?: string
  /** Max listings to request from the sidecar per query. */
  maxResults?: number
  defaultTimeoutMs?: number
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

/**
 * Net32 is Cloudflare-fronted and serves prices from a POST API, so it can't be
 * fetched like a static page. This fetcher delegates to the net32-harvester
 * sidecar — a long-lived headful browser on the NUC that clears the challenge
 * and drives /rest/neo/search/getBestPrice — and returns the sidecar's JSON
 * ({ products, bestPriceMap }) as the body for net32Provider.parseResults.
 *
 * It plugs into the same MarketplaceFetcher seam as the proxy fetcher, so the
 * rest of the pipeline (search -> match -> persist) is reused unchanged. The
 * incoming `url` is the net32 search URL built by the provider; we forward its
 * `q` to the sidecar. Keeping the browser in a sidecar means Playwright never
 * ships in the Render-deployed backend.
 */
export function createNet32SidecarFetcher(
  options: Net32SidecarOptions = {}
): MarketplaceFetcher {
  const baseUrl = (
    options.baseUrl ??
    process.env.NET32_HARVESTER_URL ??
    DEFAULT_SIDECAR_URL
  ).replace(/\/$/, "")
  const token = options.token ?? process.env.NET32_HARVESTER_TOKEN ?? ""
  const maxResults =
    options.maxResults ?? Number(process.env.NET32_HARVESTER_MAX ?? 10)
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
  const doFetch = options.fetchImpl ?? fetch

  return async function fetchNet32(
    url: string,
    fetchOptions: MarketplaceFetchOptions = {}
  ): Promise<MarketplaceFetchResult> {
    let query = ""
    try {
      // The provider builds the net32 search URL with the `query` param.
      query = new URL(url).searchParams.get("query") ?? ""
    } catch {
      query = ""
    }
    const sidecar = `${baseUrl}/search?q=${encodeURIComponent(query)}&max=${maxResults}`

    const controller = new AbortController()
    // Floor (don't just default) the timeout: a caller passing a short timeout
    // (the CLI's 20s) must not abort a legitimately-slow browser search.
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(fetchOptions.timeoutMs ?? 0, defaultTimeoutMs)
    )

    try {
      const response = await doFetch(sidecar, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      })
      const body = await response.text()

      // The sidecar reports a Cloudflare interstitial it couldn't clear as
      // { blocked: true }; surface that so the run records it as blocked rather
      // than persisting an empty result as success.
      let blocked = false
      try {
        blocked = Boolean(JSON.parse(body)?.blocked)
      } catch {
        // Non-JSON body = sidecar-level failure; leave blocked=false so ok
        // reflects the HTTP status instead of a false captcha signal.
      }

      return {
        url,
        final_url: sidecar,
        status: response.status,
        ok: response.ok && !blocked,
        body,
        blocked,
      }
    } catch (error) {
      return {
        url,
        final_url: sidecar,
        status: 0,
        ok: false,
        body: "",
        blocked: false,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
