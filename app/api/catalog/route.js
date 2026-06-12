import { NextResponse } from "next/server";

export async function GET() {
  const medusaUrl = process.env.MEDUSA_BACKEND_URL || "http://127.0.0.1:9000";

  try {
    const response = await fetch(`${medusaUrl}/medmkp/categories`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Medusa returned ${response.status}`);
    }

    const body = await response.json();
    return NextResponse.json({
      categories: body.categories || [],
      source: "medusa",
    });
  } catch (error) {
    return NextResponse.json({
      categories: [],
      source: "fallback",
      warning: "Medusa backend is not reachable.",
    });
  }
}
