import { NextResponse } from "next/server";
import { MEDUSA_URL } from "../../../../lib/medusaAuth";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || "";
  const code = searchParams.get("code") || "";
  const limit = searchParams.get("limit") || "8";

  if (!q.trim() && !code.trim()) {
    return NextResponse.json({ canonical_products: [], source: "medusa", kind: "none" });
  }

  const params = new URLSearchParams({ limit });
  if (code.trim()) params.set("code", code.trim());
  else params.set("q", q.trim());

  try {
    const response = await fetch(`${MEDUSA_URL}/medmkp/products/search?${params}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Medusa returned ${response.status}`);
    const body = await response.json();
    return NextResponse.json({
      canonical_products: body.products || [],
      kind: body.kind || "none",
      source: "medusa",
    });
  } catch {
    return NextResponse.json({
      canonical_products: [],
      kind: "none",
      source: "fallback",
      warning: "Medusa backend is not reachable.",
    });
  }
}
