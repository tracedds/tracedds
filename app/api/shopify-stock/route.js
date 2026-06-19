import { NextResponse } from "next/server";
import { mapWithConcurrency, resolveShopifyVariant, shopifyProduct } from "../../../lib/shopify.mjs";

const MAX_ITEMS = 60;
const MAX_CONCURRENCY = 5;

// Confirm selected Shopify offers when the plan opens. Unknown/non-Shopify and
// failed requests return null, which tells the client to retain ingestion data.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const requested = Array.isArray(body?.productUrls) ? body.productUrls.slice(0, MAX_ITEMS) : [];
  const unique = new Map();
  for (const productUrl of requested) {
    const product = shopifyProduct(productUrl);
    if (product && !unique.has(product.key)) unique.set(product.key, { productUrl, product });
  }

  const stock = await mapWithConcurrency([...unique.values()], MAX_CONCURRENCY, async ({ productUrl, product }) => {
    const variant = await resolveShopifyVariant(product.origin, product.handle);
    return { productUrl, available: variant ? variant.available : null };
  });

  return NextResponse.json({ stock });
}
