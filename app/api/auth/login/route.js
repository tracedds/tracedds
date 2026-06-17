import { NextResponse } from "next/server";
import { authenticate, sessionResponse } from "../../../../lib/medusaAuth";

export async function POST(request) {
  const { email, password } = await request.json().catch(() => ({}));

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const token = await authenticate(email, password);
  if (!token) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  return sessionResponse(token);
}
