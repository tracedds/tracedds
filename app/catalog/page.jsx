import { redirect } from "next/navigation"
import { normalizeParam } from "./data"

// The catalog now lives inside the app shell at /app/catalog. Preserve any
// existing /catalog links (and ?q= searches) by redirecting to the new surface.
export default async function CatalogRedirect({ searchParams }) {
  const resolvedSearchParams = await searchParams
  const q = normalizeParam(resolvedSearchParams?.q)
  redirect(q ? `/app/catalog/search?q=${encodeURIComponent(q)}` : "/app/catalog")
}
