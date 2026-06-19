import assert from "node:assert/strict";
import test from "node:test";

import { mapWithConcurrency, resolveShopifyVariant, shopifyProduct } from "../lib/shopify.mjs";

test("shopifyProduct canonicalizes a product URL for deduping", () => {
  assert.deepEqual(shopifyProduct("https://supplier.test/products/prophy-angle?variant=123"), {
    origin: "https://supplier.test",
    handle: "prophy-angle",
    key: "https://supplier.test/products/prophy-angle",
  });
  assert.equal(shopifyProduct("https://supplier.test/collections/all"), null);
  assert.equal(shopifyProduct("javascript:alert(1)/products/nope"), null);
});

test("resolveShopifyVariant prefers an available variant and reports stock", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    variants: [
      { id: 10, available: false },
      { id: 20, available: true },
    ],
  }), { status: 200 });

  assert.deepEqual(await resolveShopifyVariant("https://supplier.test", "item"), {
    id: 20,
    available: true,
  });
});

test("resolveShopifyVariant reports false when every variant is unavailable", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    variants: [{ id: 10, available: false }],
  }), { status: 200 });

  assert.deepEqual(await resolveShopifyVariant("https://supplier.test", "item"), {
    id: 10,
    available: false,
  });
});

test("mapWithConcurrency preserves order and respects its cap", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });

  assert.deepEqual(result, [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);
});
