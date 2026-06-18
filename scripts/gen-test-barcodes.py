#!/usr/bin/env python3
"""Generate UPC-A barcode SVGs from real DC Dental products for scanner testing.

Source: medmkp_supplier_product.barcode (DC Dental `upccode`, 100% UPC-A).
Output: demo-assets/barcodes/*.svg + index.html scan sheet.
"""
import io
import os
import html
from barcode import UPCA
from barcode.writer import SVGWriter

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "demo-assets", "barcodes")

# (name, brand, sku, barcode) — pulled live from prod DC Dental catalog.
PRODUCTS = [
    ("3M Adper Scotchbond Multi-Purpose 3 Well Dispenser, 7544", "3M (now Solventum)", "516-7544", "354227064216"),
    ("Ecosite One Safetips 0.25gm x 16/Pk", "DMG America", "317-222901", "133757658177"),
    ("Initial IQ Lustre Pastes ONE Diluting Liquid 8mL", "GC America, Inc.", "677-876449", "556268357771"),
    ("Premise Syringe Refill 4gm A3.5-P", "Kerr Restoratives", "813-32648", "513324144829"),
    ("Stela Automix Intro Kit", "Southern Dental Industries", "836-8640002", "441887758811"),
    ("Tetric EvoCeram Aligner Cavifils 0.2gm 20/Pk", "Vivadent", "579-762518WW", "143673500269"),
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
    for name, brand, sku, barcode in PRODUCTS:
        expected = upca_check_digit(barcode[:11])
        ok = "OK" if expected == barcode[11] else f"MISMATCH(exp {expected})"
        print(f"{barcode}  check={ok:14}  {sku:14} {name}")

        svg = barcode_svg(barcode)
        fname = f"{sku.replace('/', '-')}_{barcode}.svg"
        with open(os.path.join(OUT_DIR, fname), "w") as f:
            f.write(svg)

        cards.append(
            f"""    <figure class="card">
      <figcaption>
        <strong>{html.escape(name)}</strong>
        <span>{html.escape(brand)} &middot; SKU {html.escape(sku)} &middot; UPC {barcode}</span>
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
  figcaption span {{ color: #666; font-size: 12px; }}
  .bc {{ margin-top: 10px; }}
  .bc svg {{ max-width: 100%; height: auto; }}
</style>
</head>
<body>
  <h1>DC Dental &mdash; 6 real UPC-A barcodes for scanner testing</h1>
  <p class="note">Each barcode is the real <code>upccode</code> from a DC Dental product in the
  catalog. Scan on-screen or print this page. The scanner's <code>?barcode=</code> GTIN lookup
  should resolve each to its canonical product.</p>
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
