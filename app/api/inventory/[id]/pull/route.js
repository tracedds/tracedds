import { forward } from "../../../../../lib/medusaProxy";

// POST /api/inventory/:id/pull → confirm a lot was physically pulled (reason:
// expiry | recall | manual), or undo it with { pulled: false }.
export async function POST(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return forward(`/medmkp/inventory/${encodeURIComponent(id)}/pull`, { method: "POST", body });
}
