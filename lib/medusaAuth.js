import { NextResponse } from "next/server";

export const MEDUSA_URL = process.env.MEDUSA_BACKEND_URL || "http://127.0.0.1:9000";
export const SESSION_COOKIE = "medmkp_session";

// Exchanges email/password for a Medusa customer JWT, or null if invalid.
export async function authenticate(email, password) {
  const response = await fetch(`${MEDUSA_URL}/auth/customer/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  return data.token || null;
}

// Returns a JSON response that also sets the session cookie.
export function sessionResponse(token, payload = { ok: true }) {
  const response = NextResponse.json(payload);
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return response;
}
