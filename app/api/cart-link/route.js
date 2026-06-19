import { NextResponse } from "next/server";
import { mapWithConcurrency, resolveShopifyVariant, shopifyProduct } from "../../../lib/shopify.mjs";

// Turn one supplier's order lines into the best available "build cart" target.
//
// Suppliers don't share a universal cart-prefill URL, so we resolve per platform:
//   • Shopify storefronts expose a per-product `.js` endpoint with variant ids,
//     and a `/cart/{variant}:{qty},…` permalink that prefills the whole cart in
//     one click. We resolve variant ids server-side to dodge the browser's CORS
//     block on cross-origin storefront fetches.
//   • Everyone else (NetSuite, ASP, BigCommerce, …) has no reliable GET-based
//     cart prefill, so we hand back the product pages for the buyer to open and
//     add to the supplier's own cart.

const MAX_ITEMS = 60;
const MAX_CONCURRENCY = 5;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const items = Array.isArray(body?.items) ? body.items.slice(0, MAX_ITEMS) : [];
  const withUrls = items.filter((item) => item?.productUrl);

  // Try the Shopify path for any line whose URL looks like a Shopify product.
  const resolved = await mapWithConcurrency(
    withUrls,
    MAX_CONCURRENCY,
    async (item) => {
      const shop = shopifyProduct(item.productUrl);
      if (!shop) return { item, variant: null, origin: null };
      const variant = await resolveShopifyVariant(shop.origin, shop.handle);
      return { item, variant, origin: shop.origin };
    }
  );

  const stock = resolved
    .filter((result) => result.variant)
    .map((result) => ({ productUrl: result.item.productUrl, available: result.variant.available }));

  // Only in-stock variants can actually land in the cart via the permalink.
  const addable = resolved.filter((r) => r.variant && r.variant.available);
  if (addable.length) {
    // All of one supplier's items share an origin; pin to the first resolved
    // storefront and bundle every variant that lives there into one permalink.
    const origin = addable[0].origin;
    const sameShop = addable.filter((r) => r.origin === origin);
    const pairs = sameShop.map(
      (r) => `${r.variant.id}:${Math.max(1, Math.round(Number(r.item.qty) || 1))}`
    );
    // Anything not in the permalink (out of stock, or a non-Shopify line that
    // slipped into the group) is surfaced so the buyer can add it by hand.
    const leftovers = resolved
      .filter((r) => !sameShop.includes(r))
      .map((r) => ({ name: r.item.name || "", qty: r.item.qty, productUrl: r.item.productUrl }));
    return NextResponse.json({
      kind: "shopify-cart",
      url: `${origin}/cart/${pairs.join(",")}`,
      count: sameShop.length,
      leftovers,
      stock,
    });
  }

  // No prefillable storefront — return the product pages to open one by one.
  return NextResponse.json({
    kind: "pages",
    items: withUrls.map((item) => ({
      name: item.name || "",
      qty: item.qty,
      productUrl: item.productUrl,
    })),
    missing: items.length - withUrls.length,
    stock,
  });
}
