import { NextResponse } from "next/server";
import { MEDUSA_URL } from "../../../lib/medusaAuth";

export async function GET(request) {
  const url = new URL(request.url);
  const query = url.search || "";

  try {
    const response = await fetch(`${MEDUSA_URL}/medmkp/supplier-products${query}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Medusa returned ${response.status}`);
    }

    const body = await response.json();
    return NextResponse.json({
      ...body,
      source: "medusa",
    });
  } catch (error) {
    return NextResponse.json(
      {
        count: 0,
        supplier_products: [],
        source: "fallback",
        warning: "Medusa backend is not reachable.",
      },
      { status: 503 }
    );
  }
}
