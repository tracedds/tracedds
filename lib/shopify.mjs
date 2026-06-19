export const SHOPIFY_FETCH_TIMEOUT_MS = 8000;

// Shopify product pages conventionally live under /products/{handle}. Keep URL
// parsing in one place so live stock checks and cart building resolve the same
// endpoint and dedupe key.
export function shopifyProduct(productUrl) {
  try {
    const url = new URL(productUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const match = url.pathname.match(/\/products\/([^/]+)/);
    if (!match) return null;
    const handle = decodeURIComponent(match[1]);
    return {
      origin: url.origin,
      handle,
      key: `${url.origin}/products/${encodeURIComponent(handle)}`,
    };
  } catch {
    return null;
  }
}

// Resolve the variant Shopify would add to a cart. Variant-specific SKU/title
// matching is deliberately separate follow-up work; this preserves the existing
// behavior of preferring any available variant, then falling back to the first.
export async function resolveShopifyVariant(origin, handle) {
  try {
    const response = await fetch(`${origin}/products/${encodeURIComponent(handle)}.js`, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(SHOPIFY_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const variants = Array.isArray(data?.variants) ? data.variants : [];
    const inStock = variants.find((variant) => variant?.available);
    const variant = inStock || variants[0];
    return variant?.id ? { id: variant.id, available: Boolean(inStock) } : null;
  } catch {
    return null;
  }
}

export async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
