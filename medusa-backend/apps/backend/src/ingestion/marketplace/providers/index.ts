import type { MarketplaceProvider } from "../types"
import { alibabaProvider } from "./alibaba"
import { amazonProvider } from "./amazon"

export const MARKETPLACE_PROVIDERS: Record<string, MarketplaceProvider> = {
  [alibabaProvider.id]: alibabaProvider,
  [amazonProvider.id]: amazonProvider,
}

export function getMarketplaceProvider(id: string): MarketplaceProvider {
  const provider = MARKETPLACE_PROVIDERS[id?.trim().toLowerCase()]
  if (!provider) {
    throw new Error(
      `Unknown marketplace provider "${id}". Known: ${Object.keys(
        MARKETPLACE_PROVIDERS
      ).join(", ")}`
    )
  }
  return provider
}

export { alibabaProvider, amazonProvider }
