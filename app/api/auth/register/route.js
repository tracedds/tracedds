import { NextResponse } from "next/server";
import { MEDUSA_URL, authenticate, sessionResponse } from "../../../../lib/medusaAuth";

export async function POST(request) {
  const { email, password, practiceName, firstName, lastName } = await request
    .json()
    .catch(() => ({}));

  if (!email || !password || !practiceName) {
    return NextResponse.json(
      { error: "Practice name, email, and password are required." },
      { status: 400 }
    );
  }

  // 1. Create the practice + customer + auth identity in Medusa.
  const registerRes = await fetch(`${MEDUSA_URL}/medmkp/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      practice_name: practiceName,
      first_name: firstName || "",
      last_name: lastName || "",
    }),
  });

  if (!registerRes.ok) {
    const err = await registerRes.json().catch(() => ({}));
    return NextResponse.json(
      { error: err.error || "Could not create account." },
      { status: registerRes.status }
    );
  }

  // 2. Log in immediately to start a session.
  const token = await authenticate(email, password);
  if (!token) {
    return NextResponse.json(
      { error: "Account created, but automatic sign-in failed. Please log in." },
      { status: 500 }
    );
  }

  return sessionResponse(token);
}
