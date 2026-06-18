import { redirect } from "next/navigation"
import { normalizeParam } from "../data"

// Catalog search now lives inside the app shell at /app/catalog/search.
// Redirect legacy /catalog/search links, preserving the query.
export default async function CatalogSearchRedirect({ searchParams }) {
  const resolvedSearchParams = await searchParams
  const q = normalizeParam(resolvedSearchParams?.q)
  redirect(q ? `/app/catalog/search?q=${encodeURIComponent(q)}` : "/app/catalog/search")
}
