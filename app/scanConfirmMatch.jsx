"use client";

// ScanConfirmMatch — full-screen overlay shown when a scanned line has
// match_status === "needs_review". The user sees what the barcode resolved to
// (or "no match"), can accept it as-is or search the catalog for the right
// product, then optionally fill lot/expiry before confirming.
//
// Props:
//   line        — scan_line object (id, barcode, name, image_url, lot_number,
//                 expiration_date, match_status, _offer?)
//   locName     — string display name of the location
//   onConfirm   — (lineId, patchBody) => void   — accept + patch the line
//   onSkip      — () => void                     — leave as-is, go back
//   onBack      — () => void                     — back / cancel

import { useState } from "react";
import { BrandMark, Icon } from "./icons";
import { useProductSearch, ProductSearchResults } from "./ui";
import s from "./scanConfirmMatch.module.css";

// ── helpers ───────────────────────────────────────────────────────────

function offerSku(line) {
  return line?._offer?.sku || line?.barcode || "";
}
function offerPack(line) {
  const o = line?._offer;
  if (!o) return "";
  if (o.pack_size) return o.pack_size;
  if (o.pack_quantity && o.base_unit) return `${o.pack_quantity} ${o.base_unit} / pack`;
  return "";
}

// ── sub-views ─────────────────────────────────────────────────────────

// Inline search when the user rejects the auto-match.
function CatalogSearchView({ onPick, onBack }) {
  const { query, setQuery, results, loading } = useProductSearch(true);
  return (
    <div className={s.screen}>
      <header className={s.topbar}>
        <button type="button" className={s.iconBtn} onClick={onBack} aria-label="Back">
          <Icon name="icon-chevron-left" />
        </button>
        <span className={s.brand}><BrandMark /></span>
        <span className={s.topSpacer} />
      </header>

      <div className={s.searchBody}>
        <p className={s.searchHint}>Search by product name, SKU, or barcode.</p>
        <label className={s.searchField}>
          <Icon name="icon-search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Cavit, Heliomolar, Cavitron…"
            aria-label="Search products"
            autoFocus
          />
        </label>
        <div className={s.searchResults}>
          <ProductSearchResults
            query={query}
            results={results}
            loading={loading}
            onPick={onPick}
            emptyHint="Type a product name to search the catalog."
          />
        </div>
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────

export function ScanConfirmMatch({ line, locName, onConfirm, onSkip, onBack }) {
  const hasAutoMatch = Boolean(
    line.name && line.match_status !== "needs_review_no_match",
  );

  // product state — starts from whatever the line already carries
  const [pickedProduct, setPickedProduct] = useState(null); // null = using line's auto-match
  const [searching, setSearching]         = useState(false);
  const [lot, setLot]                     = useState(line.lot_number || "");
  const [exp, setExp]                     = useState(
    line.expiration_date ? String(line.expiration_date).slice(0, 10) : "",
  );

  // The "active" product shown at the top (either the auto-match or user pick)
  const active = pickedProduct || (hasAutoMatch ? line : null);

  if (searching) {
    return (
      <CatalogSearchView
        onBack={() => setSearching(false)}
        onPick={(product) => {
          const best = product.best_offer || product.offers?.[0] || null;
          setPickedProduct({
            id:                  product.id,
            name:                product.name,
            image_url:           product.image_url || best?.image_url || "",
            canonical_product_id: product.id?.startsWith("mcp") ? product.id : null,
            supplier_product_id:  best?.supplier_product_id ||
                                  (product.id?.startsWith("msp") ? product.id : null),
            _offer: best,
          });
          setSearching(false);
        }}
      />
    );
  }

  function handleConfirm() {
    const patch = {
      lot_number:      lot.trim() || null,
      expiration_date: exp || null,
    };
    if (pickedProduct) {
      patch.canonical_product_id = pickedProduct.canonical_product_id;
      patch.supplier_product_id  = pickedProduct.supplier_product_id;
      patch.name                 = pickedProduct.name;
      patch.image_url            = pickedProduct.image_url;
    }
    onConfirm(line.id, patch);
  }

  const sku  = offerSku(active || line);
  const pack = offerPack(active || line);
  const isExpired = exp && new Date(exp) <= new Date();

  return (
    <div className={s.screen}>
      <header className={s.topbar}>
        <button type="button" className={s.iconBtn} onClick={onBack} aria-label="Back">
          <Icon name="icon-chevron-left" />
        </button>
        <span className={s.brand}><BrandMark /></span>
        <span className={s.topSpacer} />
      </header>

      <div className={s.body}>

        {/* Status banner */}
        <div className={s.reviewBanner}>
          <span className={s.reviewBannerIcon}><Icon name="icon-alert-triangle" /></span>
          <div>
            <strong className={s.reviewBannerTitle}>Review required</strong>
            <span className={s.reviewBannerSub}>
              {hasAutoMatch
                ? "Confirm the product match before this scan is saved."
                : "No catalog match found. Search to link the right product."}
            </span>
          </div>
        </div>

        {/* Product card */}
        <div className={`${s.prodCard} ${!active ? s.prodCardEmpty : ""}`}>
          {active ? (
            <>
              <div className={s.prodTop}>
                <span className={s.prodImg}>
                  {active.image_url
                    ? <img src={active.image_url} alt="" />
                    : <Icon name="icon-package" />}
                </span>
                <div className={s.prodInfo}>
                  <span className={s.prodName}>{active.name}</span>
                  {active._offer?.brand && (
                    <span className={s.prodAttr}>{active._offer.brand}</span>
                  )}
                  {pickedProduct && (
                    <span className={s.pickedBadge}><Icon name="icon-check-circle" /> Manually linked</span>
                  )}
                </div>
              </div>
              {(sku || pack) && (
                <div className={s.prodSpecs}>
                  {sku  && <div className={s.prodSpec}><span className={s.prodSpecLabel}>SKU / MPN</span><span className={s.prodSpecVal}>{sku}</span></div>}
                  {pack && <div className={s.prodSpec}><span className={s.prodSpecLabel}>Package</span><span className={s.prodSpecVal}>{pack}</span></div>}
                </div>
              )}
              <div className={s.prodLocChip}><Icon name="icon-map-pin" /> {locName}</div>
            </>
          ) : (
            <div className={s.noMatchPlaceholder}>
              <span className={s.noMatchIcon}><Icon name="icon-search" /></span>
              <span className={s.noMatchText}>No product matched — search to link one.</span>
            </div>
          )}
        </div>

        <button
          type="button"
          className={s.searchLink}
          onClick={() => setSearching(true)}
        >
          <Icon name="icon-search" />
          {active ? "Change product match" : "Search catalog"}
        </button>

        {/* Lot / expiry */}
        <div className={s.formCard}>
          <div className={s.formHead}><Icon name="icon-shield-check" /> Traceability</div>

          {isExpired && (
            <div className={s.expiredBanner}>
              <Icon name="icon-alert-triangle" />
              Expired — verify this lot has been removed or replaced.
            </div>
          )}

          <div className={s.formRow}>
            <span className={s.formLabel}>Lot number</span>
            <input
              className={s.input}
              value={lot}
              onChange={(e) => setLot(e.target.value)}
              placeholder="e.g. A219"
            />
          </div>
          <div className={s.formRow}>
            <span className={s.formLabel}>Expiration date</span>
            <input
              className={s.input}
              type="date"
              value={exp}
              onChange={(e) => setExp(e.target.value)}
            />
          </div>
        </div>

        <p className={s.scannedCode}>
          <Icon name="icon-scan" />
          Scanned: <code>{line.barcode || "—"}</code>
        </p>

      </div>

      <div className={s.footer}>
        <button type="button" className={s.btnOutline} onClick={onSkip}>
          Skip for now
        </button>
        <button
          type="button"
          className={s.btnPrimary}
          onClick={handleConfirm}
          disabled={!active}
        >
          <Icon name="icon-check" /> Confirm match
        </button>
      </div>
    </div>
  );
}
