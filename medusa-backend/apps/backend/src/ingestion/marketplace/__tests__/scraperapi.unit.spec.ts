import { fetchScraperApiCredits, resolveScraperApiKey } from "../scraperapi"

describe("resolveScraperApiKey", () => {
  it("prefers the explicit SCRAPERAPI_API_KEY env var", () => {
    expect(
      resolveScraperApiKey({ SCRAPERAPI_API_KEY: "explicit-key" } as NodeJS.ProcessEnv)
    ).toBe("explicit-key")
  })

  it("falls back to the api_key param of a scraperapi MARKETPLACE_SCRAPER_URL", () => {
    expect(
      resolveScraperApiKey({
        MARKETPLACE_SCRAPER_URL:
          "https://api.scraperapi.com/?api_key=abc123&render=true&url={url}",
      } as NodeJS.ProcessEnv)
    ).toBe("abc123")
  })

  it("returns undefined for a non-scraperapi proxy template", () => {
    expect(
      resolveScraperApiKey({
        MARKETPLACE_SCRAPER_URL: "https://api.zenrows.com/v1/?apikey=zzz&url={url}",
      } as NodeJS.ProcessEnv)
    ).toBeUndefined()
  })

  it("returns undefined when nothing is configured", () => {
    expect(resolveScraperApiKey({} as NodeJS.ProcessEnv)).toBeUndefined()
  })
})

describe("fetchScraperApiCredits", () => {
  it("maps the account payload", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({ creditsLeft: 4150, requestLimit: 5000, requestCount: 850 }),
    })) as unknown as typeof fetch

    expect(await fetchScraperApiCredits("k", fetchImpl)).toEqual({
      credits_left: 4150,
      request_limit: 5000,
      request_count: 850,
      concurrency_limit: undefined,
    })
  })

  it("returns undefined (never throws) on failure", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    expect(await fetchScraperApiCredits("k", fetchImpl)).toBeUndefined()
  })
})
