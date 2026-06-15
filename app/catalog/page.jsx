import Link from "next/link"
import { getCatalogCategories, formatMoney, normalizeParam } from "./data"

export const metadata = {
  title: "Catalog",
  description: "Browse canonical dental products and jump into comparison search.",
}

function searchHref(params) {
  const url = new URL("/catalog/search", "http://localhost")
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value)
    }
  })

  return `${url.pathname}${url.search}`
}

export default async function CatalogPage({ searchParams }) {
  const resolvedSearchParams = await searchParams
  const q = normalizeParam(resolvedSearchParams?.q)
  const catalog = await getCatalogCategories()
  const categories = catalog.categories || []

  return (
    <main className="catalog-page">
      <section className="catalog-hero">
        <div className="catalog-hero-copy">
          <p className="eyebrow">Catalog</p>
          <h1>Find the product, then compare the offers.</h1>
          <p>
            Search canonical products, browse categories, and open a comparison page that shows
            the lowest supplier offers first.
          </p>
          <form className="catalog-search-form" action="/catalog/search" method="get">
            <label className="catalog-search-field">
              <span>Search products</span>
              <input
                name="q"
                defaultValue={q}
                type="search"
                placeholder="Gloves, burs, irrigants, impression material..."
              />
            </label>
            <button className="primary-action" type="submit">Search catalog</button>
          </form>
          <div className="catalog-hero-links">
            <Link href="/add-items/recommendations" className="secondary-action">
              Add to draft order
            </Link>
            <Link href="/quotes" className="secondary-action">
              Review recommendations
            </Link>
          </div>
        </div>
        <aside className="catalog-hero-panel">
          <strong>{categories.length} active categories</strong>
          <span>{catalog.source === "medusa" ? "Live Medusa data" : "Fallback catalog"}</span>
          <small>Search and browse stay on the same listing surface.</small>
        </aside>
      </section>

      <section className="catalog-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Browse</p>
            <h2>Categories</h2>
            <p>Pick a category to jump straight into the listing view with the filter pre-applied.</p>
          </div>
          <Link className="secondary-action compact" href="/catalog/search">
            Open full catalog
          </Link>
        </div>

        <div className="catalog-category-grid">
          {categories.map((category) => {
            const best = category.best_value_item
            return (
              <article className="catalog-category-card" key={category.id}>
                <div>
                  <span className="catalog-category">{category.name}</span>
                  <h3>{best?.name || category.name}</h3>
                </div>
                <dl className="catalog-category-meta">
                  <div>
                    <dt>Products</dt>
                    <dd>{category.product_count}</dd>
                  </div>
                  <div>
                    <dt>Suppliers</dt>
                    <dd>{category.supplier_count}</dd>
                  </div>
                </dl>
                <div className="catalog-offer">
                  <span>Best value</span>
                  <strong>{best ? formatMoney(best.unit_price_cents) : "Price pending"}</strong>
                </div>
                <p>{best?.supplier_name || "Supplier pending"}</p>
                <Link className="category-link" href={searchHref({ category: category.name })}>
                  View category
                </Link>
              </article>
            )
          })}
        </div>
      </section>
    </main>
  )
}
