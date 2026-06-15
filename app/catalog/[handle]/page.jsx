import Link from "next/link"
import { notFound } from "next/navigation"
import { availabilityLabel, formatMoney, formatPriceRange, getCatalogProducts, normalizeParam } from "../data"

export async function generateMetadata({ params }) {
  const resolvedParams = await params
  return {
    title: resolvedParams.handle.replace(/-/g, " "),
  }
}

export default async function CatalogProductPage({ params }) {
  const resolvedParams = await params
  const handle = normalizeParam(resolvedParams.handle)
  const { products } = await getCatalogProducts({ handle, limit: 1 })
  const product = products[0]

  if (!product) {
    notFound()
  }

  const offers = [...(product.offers || [])].sort((a, b) => a.price_cents - b.price_cents)
  const best = offers[0]
  const priceRange = formatPriceRange(product.price_range_cents, product.offer_count)

  return (
    <main className="catalog-page">
      <section className="product-hero">
        <div className="product-hero-media">
          {product.image_url ? (
            <img src={product.image_url} alt={product.name} />
          ) : (
            <div className="product-hero-placeholder">No image available</div>
          )}
        </div>
        <div className="product-hero-copy">
          <Link className="back-link" href="/catalog/search">
            Back to search
          </Link>
          <p className="eyebrow">Canonical product</p>
          <h1>{product.name}</h1>
          <p>{product.description || product.attributes_text || "Canonical catalog item."}</p>
          <div className="product-summary">
            <div>
              <span>Best price</span>
              <strong>{best ? formatMoney(best.price_cents) : "Price pending"}</strong>
            </div>
            <div>
              <span>Offer range</span>
              <strong>{priceRange}</strong>
            </div>
            <div>
              <span>Suppliers</span>
              <strong>{product.offer_count}</strong>
            </div>
          </div>
          <div className="product-hero-actions">
            <Link className="primary-action" href="/add-items/recommendations">Add to draft order</Link>
            <Link className="secondary-action" href={`/catalog/search?category=${encodeURIComponent(product.category)}`}>More in category</Link>
          </div>
        </div>
      </section>

      <section className="product-details-grid">
        <article className="product-details-card">
          <h2>Attributes</h2>
          <dl>
            <div><dt>Category</dt><dd>{product.category}</dd></div>
            <div><dt>Handle</dt><dd>{product.handle}</dd></div>
            <div><dt>Unit</dt><dd>{product.unit_of_measure || "n/a"}</dd></div>
            <div><dt>Description</dt><dd>{product.description || "n/a"}</dd></div>
          </dl>
          <p className="product-attributes-text">{product.attributes_text || "No structured attributes captured yet."}</p>
        </article>

        <article className="product-details-card">
          <h2>Supplier offers</h2>
          <div className="offer-table">
            <div className="offer-table-head">
              <span>Supplier</span>
              <span>Brand</span>
              <span>SKU</span>
              <span>Availability</span>
              <span>Price</span>
            </div>
            {offers.map((offer, index) => (
              <div className={`offer-table-row ${index === 0 ? "best" : ""}`} key={offer.supplier_product_id}>
                <span>
                  <strong>{offer.supplier_name}</strong>
                  {index === 0 && <em>Best price</em>}
                </span>
                <span>{offer.brand || "n/a"}</span>
                <span>{offer.sku}</span>
                <span>{availabilityLabel(offer.availability)}</span>
                <span>{formatMoney(offer.price_cents)}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  )
}
