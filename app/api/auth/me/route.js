import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { MEDUSA_URL, SESSION_COOKIE, isTokenExpired } from "../../../../lib/medusaAuth";

export async function GET() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const authenticated = Boolean(token) && !isTokenExpired(token);
  if (!authenticated) return NextResponse.json({ authenticated: false });

  // Enrich with the buyer's name + practice so the app shell can show who's
  // signed in instead of a hardcoded placeholder. Non-fatal if Medusa is slow.
  try {
    const response = await fetch(`${MEDUSA_URL}/medmkp/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (response.ok) {
      const { customer, practice } = await response.json();
      return NextResponse.json({ authenticated: true, customer, practice });
    }
  } catch {
    // fall through — still authenticated, just without profile details
  }
  return NextResponse.json({ authenticated: true });
}
