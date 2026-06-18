#!/usr/bin/env python3
"""Generate UPC-A barcode SVGs from real DC Dental products for scanner testing.

Source: medmkp_supplier_product.barcode (DC Dental `upccode`, 100% UPC-A).
Selection: DC Dental products whose canonical match is carried by the most
distinct suppliers (ranked via medmkp_canonical_product_match), so each scan
resolves to a product available from 4-5 of our 9 suppliers.
Output: test/barcodes/*.svg + index.html scan sheet.
"""
import io
import os
import html
from barcode import UPCA
from barcode.writer import SVGWriter

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "test", "barcodes")

# (name, brand, sku, barcode, suppliers) — pulled live from prod. `suppliers` is
# the distinct set of our suppliers whose catalog carries a match for this
# product's canonical (see medmkp_canonical_product_match). Ordered by coverage.
PRODUCTS = [
    ("D-Lish Prophy Paste Medium Mint 200/Bx", "Young Dental", "592-300120", "743842007546",
     ["American Dental", "Carolina Dental", "DC Dental", "Dental City", "Pearson Dental"]),
    ("Scaler 107-108 3/8 Blue", "American Eagle Instrument", "761-AES107-108X", "646570356484",
     ["American Dental", "Carolina Dental", "DC Dental", "Dental City", "Young Specialties"]),
    ("Calcium Hydroxide Placement Instrument", "American Eagle Instrument", "761-AEPPA", "807016560425",
     ["American Dental", "Carolina Dental", "DC Dental", "Dental City", "Pearson Dental"]),
    ("Curette Columbia DE 4R/4L #2 Handle", "Hu-Friedy", "616-SC4R/4L", "673414540044",
     ["American Dental", "Carolina Dental", "DC Dental", "Dental City", "Pearson Dental"]),
    ("E-Z Access Shelf White", "Zirc Dental Products", "605-20Z420A", "813230816781",
     ["American Dental", "Carolina Dental", "DC Dental", "Dental City", "Pearson Dental"]),
    ("3M Sof-Lex Finishing and Polishing System Kit, 2385P", "3M (now Solventum)", "516-2385P", "140328606802",
     ["Carolina Dental", "DC Dental", "Dental City", "Pearson Dental"]),
    ("GC Capsule Applier V", "GC America, Inc.", "677-013764", "522232660703",
     ["Carolina Dental", "DC Dental", "Dental City", "Pearson Dental"]),
    ("Clorox Hydrogen Peroxide Disinfectant Gallon", "Clorox", "348-30829", "785306841174",
     ["Carolina Dental", "DC Dental", "Dental City", "Pearson Dental"]),
    ("Clean & Simple Ultrasonic Cleaner 1 Gallon", "Tuttnauer USA Co.", "372-CSU1", "845737881450",
     ["American Dental", "Carolina Dental", "DC Dental", "Dental City"]),
    ("Activa BioActive Cement Single Pack A2", "Pulpdent Corporation", "589-VC1A2", "687636480217",
     ["Carolina Dental", "DC Dental", "Dental City", "Pearson Dental"]),
]


def upca_check_digit(eleven: str) -> str:
    odd = sum(int(eleven[i]) for i in range(0, 11, 2))
    even = sum(int(eleven[i]) for i in range(1, 11, 2))
    return str((10 - (odd * 3 + even) % 10) % 10)


def barcode_svg(value: str) -> str:
    writer = SVGWriter()
    buf = io.BytesIO()
    UPCA(value, writer=writer).write(
        buf,
        options={"module_width": 0.33, "module_height": 22.0, "quiet_zone": 4.0, "font_size": 12},
    )
    return buf.getvalue().decode("utf-8")


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    cards = []
    for name, brand, sku, barcode, suppliers in PRODUCTS:
        expected = upca_check_digit(barcode[:11])
        ok = "OK" if expected == barcode[11] else f"MISMATCH(exp {expected})"
        print(f"{barcode}  check={ok:14}  {len(suppliers)} suppliers  {sku:16} {name}")

        svg = barcode_svg(barcode)
        fname = f"{sku.replace('/', '-')}_{barcode}.svg"
        with open(os.path.join(OUT_DIR, fname), "w") as f:
            f.write(svg)

        cards.append(
            f"""    <figure class="card">
      <figcaption>
        <strong>{html.escape(name)}</strong>
        <span>{html.escape(brand)} &middot; SKU {html.escape(sku)} &middot; UPC {barcode}</span>
        <span class="sup">{len(suppliers)} suppliers: {html.escape(", ".join(suppliers))}</span>
      </figcaption>
      <div class="bc">{svg}</div>
    </figure>"""
        )

    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DC Dental test barcodes</title>
<style>
  body {{ font: 14px/1.4 -apple-system, system-ui, sans-serif; margin: 24px; color: #111; }}
  h1 {{ font-size: 18px; }}
  p.note {{ color: #555; max-width: 60ch; }}
  .grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }}
  .card {{ border: 1px solid #ddd; border-radius: 10px; padding: 16px; margin: 0; background: #fff; }}
  figcaption strong {{ display: block; }}
  figcaption span {{ display: block; color: #666; font-size: 12px; }}
  figcaption span.sup {{ color: #1a7f37; margin-top: 2px; }}
  .bc {{ margin-top: 10px; }}
  .bc svg {{ max-width: 100%; height: auto; }}
</style>
</head>
<body>
  <h1>DC Dental &mdash; {len(PRODUCTS)} multi-supplier UPC-A barcodes for scanner testing</h1>
  <p class="note">Each barcode is the real <code>upccode</code> from a DC Dental product, chosen
  because its canonical match is carried by the most distinct suppliers in our catalog. Scan
  on-screen or print this page. The scanner's <code>?barcode=</code> GTIN lookup should resolve
  each to its canonical product and surface every supplier offering it.</p>
  <div class="grid">
{os.linesep.join(cards)}
  </div>
</body>
</html>"""
    with open(os.path.join(OUT_DIR, "index.html"), "w") as f:
        f.write(page)
    print(f"\nWrote {len(PRODUCTS)} SVGs + index.html to {os.path.normpath(OUT_DIR)}")


if __name__ == "__main__":
    main()
