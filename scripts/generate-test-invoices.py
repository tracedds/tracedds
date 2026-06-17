#!/usr/bin/env python3
"""Generate dental test invoice PDFs from real supplier catalog data.

Reads priced supplier products from the local MedMKP Postgres, prefers
products that show up across multiple suppliers, marks invoice prices up
5-30% (so the savings pipeline has something to find), and renders
realistic vendor invoices into demo-assets/test-invoices/.

Usage:
  python3 scripts/generate-test-invoices.py [--count N] [--seed S]

DATABASE_URL is taken from the environment or from
medusa-backend/apps/backend/.env.
"""

import argparse
import datetime
import json
import os
import random
import re
import subprocess
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "demo-assets" / "test-invoices"

BILL_TO = [
    "Northline Dental",
    "Alex Kim, Operations Director",
    "500 Healthcare Blvd",
    "Nashville, TN 37203",
]

UNITS = ["each", "box", "pack", "case", "bag"]

MIN_SUPPLIERS_PER_ITEM = 3
DEMO_SUPPLIERS = {
    "amerdental-prod-full": "American Dental Accessories",
    "carolina-prod-full": "Carolina Dental Supply",
    "smoke-dental_city": "Dental City",
    "smoke-pearson_dental": "Pearson Dental",
}
# Suppliers whose ingested catalog carries product image URLs. Demo invoices
# draw their items from these so the matched products render with real
# thumbnails in the reorder list instead of the placeholder icon.
DEMO_VENDORS = ["Pearson Dental", "American Dental Accessories"]
DEMO_SIZES = ["small", "medium", "large", "extra large"]


def database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env_path = ROOT / "medusa-backend" / "apps" / "backend" / ".env"
    for line in env_path.read_text().splitlines():
        match = re.match(r"^DATABASE_URL=(.+)$", line)
        if match:
            return match.group(1).strip()
    raise SystemExit("DATABASE_URL not found")


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def load_products_from_db():
    """Query priced supplier products via psql, including image_url so demo
    invoices can be restricted to products that render with a thumbnail."""
    sql = (
        "SELECT s.name AS supplier, p.sku, p.name, "
        "COALESCE(p.manufacturer_sku, '') AS manufacturer_sku, "
        "COALESCE(p.brand, '') AS brand, "
        "COALESCE(p.pack_size, '') AS pack_size, "
        "COALESCE(p.unit_of_measure, '') AS unit_of_measure, "
        "COALESCE(p.product_url, '') AS product_url, "
        "COALESCE(p.category, '') AS category, "
        "COALESCE(p.description, '') AS description, "
        "COALESCE(p.image_url, '') AS image_url, "
        "snap.price_cents "
        "FROM medmkp_supplier_product p "
        "JOIN medmkp_supplier s ON s.id = p.supplier_id AND s.deleted_at IS NULL "
        "JOIN LATERAL (SELECT price_cents FROM medmkp_supplier_price_snapshot ps "
        "  WHERE ps.supplier_product_id = p.id AND ps.deleted_at IS NULL "
        "  ORDER BY captured_at DESC LIMIT 1) snap ON snap.price_cents > 0 "
        "WHERE p.deleted_at IS NULL"
    )
    out = subprocess.run(
        ["psql", database_url(), "-tA", "-F", "\t", "-c", sql],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    products = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) != 12:
            continue
        (supplier, sku, name, manufacturer_sku, brand, pack_size, unit_of_measure,
         product_url, category, description, image_url, price) = parts
        products.append(
            {
                "supplier": supplier,
                "sku": sku,
                "name": name,
                "manufacturer_sku": manufacturer_sku,
                "brand": brand,
                "pack_size": pack_size,
                "unit_of_measure": unit_of_measure,
                "product_url": product_url,
                "category": category,
                "description": description,
                "image_url": image_url,
                "price_cents": int(price),
            }
        )
    return products


def load_products_from_cache():
    """Fallback only: cached ingestion files (no image_url)."""
    cache_root = ROOT / "medusa-backend" / "apps" / "backend" / ".medmkp" / "ingestion"
    cached_products = []
    if cache_root.exists():
        for products_path in cache_root.rglob("products.json"):
            supplier_key = products_path.parent.name
            display_name = DEMO_SUPPLIERS.get(supplier_key, supplier_key)
            try:
                entries = json.loads(products_path.read_text())
            except Exception:
                continue
            for entry in entries:
                cached_products.append(
                    {
                        "supplier_key": supplier_key,
                        "supplier": display_name,
                        "sku": entry.get("sku", ""),
                        "name": entry.get("name", ""),
                        "description": entry.get("description", ""),
                        "manufacturer_sku": entry.get("manufacturer_sku", ""),
                        "brand": entry.get("brand", ""),
                        "pack_size": entry.get("pack_size", ""),
                        "unit_of_measure": entry.get("unit_of_measure", ""),
                        "product_url": entry.get("product_url", ""),
                        "category": entry.get("category", ""),
                        "image_url": entry.get("image_url", ""),
                        "price_cents": round(float(entry.get("price", 0)) * 100),
                    }
                )
    return cached_products


def load_products():
    """Prefer the live DB (current prices + image_url); fall back to cached
    ingestion files only if the database is unreachable."""
    try:
        products = load_products_from_db()
        if products:
            return products
    except Exception as error:  # pragma: no cover - operational fallback
        print(f"DB load failed ({error}); falling back to cached ingestion files.", file=sys.stderr)
    return load_products_from_cache()


def extract_size(product_name: str) -> str:
    text = normalize_key(product_name)
    if "extra large" in text or re.search(r"\bxl\b", text):
        return "extra large"
    if "extra small" in text or re.search(r"\bxs\b", text) or "x small" in text:
        return "extra small"
    if "medium" in text:
        return "medium"
    if "large" in text:
        return "large"
    if "small" in text:
        return "small"
    return ""


def build_glove_demo_batches(products, rng):
    batches = []
    for vendor in DEMO_VENDORS:
        supplier_products = [
            product
            for product in products
            if product.get("supplier") == vendor
            and str(product.get("image_url", "")).strip()
            and "nitrile" in normalize_key(f"{product['name']} {product.get('description', '')} {product.get('category', '')}")
            and "glove" in normalize_key(f"{product['name']} {product.get('description', '')} {product.get('category', '')}")
        ]
        if not supplier_products:
            continue

        by_size = {}
        for product in supplier_products:
            size = extract_size(product["name"] + " " + product.get("description", ""))
            if size and size not in by_size:
                by_size[size] = product

        items = []
        for size in DEMO_SIZES:
            product = by_size.get(size)
            if not product:
                continue
            qty = 1 if size in {"small", "extra small"} else 2 if size == "medium" else 3 if size == "large" else 4
            items.append(
                (
                    product["sku"],
                    product_description(product),
                    qty,
                    "box",
                    round(product["price_cents"] * rng.uniform(1.05, 1.18)),
                )
            )

        if len(items) >= 2:
            batches.append((vendor, items))

    return batches


def overlap_key(product):
    if product["manufacturer_sku"].strip():
        return f"msku:{normalize_key(product['manufacturer_sku'])}"
    return "name:" + "|".join(
        [
            normalize_key(product["brand"]),
            normalize_key(product["pack_size"]),
            normalize_key(product["name"]),
        ]
    )


def build_overlap_groups(products):
    groups = {}
    for product in products:
        key = overlap_key(product)
        if key in {"msku:", "name:||"}:
            continue
        groups.setdefault(key, []).append(product)

    scored = []
    for key, rows in groups.items():
        best_by_supplier = {}
        for row in rows:
            current = best_by_supplier.get(row["supplier"])
            if current is None or row["price_cents"] < current["price_cents"]:
                best_by_supplier[row["supplier"]] = row

        items = sorted(best_by_supplier.values(), key=lambda row: (row["price_cents"], row["supplier"]))
        if len(items) < MIN_SUPPLIERS_PER_ITEM:
            continue

        prices = [row["price_cents"] for row in items]
        scored.append(
            {
                "key": key,
                "items": items,
                "suppliers": sorted(best_by_supplier.keys()),
                "supplier_count": len(best_by_supplier),
                "price_min": min(prices),
                "price_max": max(prices),
                "spread": max(prices) - min(prices),
            }
        )

    scored.sort(key=lambda group: (group["supplier_count"], group["spread"], len(group["items"])), reverse=True)
    return scored


def build_supplier_pools(groups):
    pools = {}
    for group in groups:
        for item in group["items"]:
            pools.setdefault(item["supplier"], []).append(group)

    for supplier_groups in pools.values():
        supplier_groups.sort(
            key=lambda group: (
                group["supplier_count"],
                group["spread"],
                group["price_max"],
                group["price_min"],
            ),
            reverse=True,
        )
    return pools


def money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def build_invoice(path: Path, vendor: str, items, invoice_no: str, layout: str, rng):
    """items: list of (sku, description, qty, unit, unit_price_cents)."""
    styles = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=9, leading=12)
    bold = ParagraphStyle("bold", parent=body, fontName="Helvetica-Bold")
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], fontSize=16, spaceAfter=2)

    invoice_date = datetime.date.today() - datetime.timedelta(days=rng.randint(5, 40))
    due = invoice_date + datetime.timedelta(days=15)

    doc = SimpleDocTemplate(
        str(path), pagesize=letter, topMargin=0.6 * inch, bottomMargin=0.6 * inch
    )
    story = [
        Paragraph(vendor, h1),
        Paragraph("Remit to: PO Box %d, %s" % (rng.randint(1000, 9999), rng.choice(
            ["Madison, WI 53718", "Columbus, OH 43228", "Pomona, CA 91768", "Brooklyn, NY 11232"]
        )), body),
        Spacer(1, 10),
        Paragraph("INVOICE", bold),
        Spacer(1, 4),
        Table(
            [
                [
                    Paragraph("<b>Bill To</b><br/>" + "<br/>".join(BILL_TO), body),
                    Paragraph(
                        f"<b>Invoice #:</b> {invoice_no}<br/>"
                        f"<b>Invoice Date:</b> {invoice_date:%B %-d, %Y}<br/>"
                        f"<b>Due Date:</b> {due:%B %-d, %Y}<br/>"
                        f"<b>Terms:</b> Net 15",
                        body,
                    ),
                ]
            ],
            colWidths=[3.6 * inch, 3.0 * inch],
        ),
        Spacer(1, 14),
    ]

    subtotal = 0
    if layout == "sku-first":
        rows = [["SKU", "Description", "Qty", "Unit", "Unit Price", "Line Total"]]
        widths = [0.9, 3.1, 0.45, 0.55, 0.8, 0.9]
        for sku, desc, qty, unit, price in items:
            total = qty * price
            subtotal += total
            rows.append([sku, Paragraph(desc, body), str(qty), unit, money(price), money(total)])
    else:
        rows = [["Description", "Item #", "Qty", "Price", "Amount"]]
        widths = [3.6, 0.9, 0.5, 0.85, 0.85]
        for sku, desc, qty, unit, price in items:
            total = qty * price
            subtotal += total
            rows.append([Paragraph(desc, body), sku, str(qty), money(price), money(total)])

    shipping = rng.choice([0, 895, 1250, 1800])
    tax = round(subtotal * 0.0925)
    grand = subtotal + shipping + tax
    span = len(rows[0]) - 2
    rows.append([""] * span + ["Subtotal", money(subtotal)])
    if shipping:
        rows.append([""] * span + ["Shipping", money(shipping)])
    rows.append([""] * span + ["Sales Tax", money(tax)])
    rows.append([""] * span + ["Invoice Total", money(grand)])

    table = Table(rows, colWidths=[w * inch for w in widths], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("LINEBELOW", (0, 0), (-1, 0), 0.75, colors.black),
                ("LINEBELOW", (0, -4), (-1, -4), 0.5, colors.grey),
                ("FONTNAME", (-2, -1), (-1, -1), "Helvetica-Bold"),
                ("ALIGN", (-3, 0), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(table)
    story.append(Spacer(1, 16))
    story.append(Paragraph("Thank you for your business.", body))
    doc.build(story)
    return grand


def product_description(product):
    pieces = [product["name"]]
    if product["brand"].strip() and product["brand"].strip().lower() not in normalize_key(product["name"]):
        pieces.append(product["brand"].strip())
    if product["pack_size"].strip():
        pieces.append(product["pack_size"].strip())
    return " - ".join(pieces)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=6, help="invoices per run")
    parser.add_argument("--seed", type=int, default=20260612)
    args = parser.parse_args()
    rng = random.Random(args.seed)

    products = load_products()
    demo_batches = build_glove_demo_batches(products, rng)
    if demo_batches:
        print(f"Found {len(demo_batches)} image-backed demo supplier groups (Pearson / American Dental).")
    else:
        groups = build_overlap_groups(products)
        supplier_pools = build_supplier_pools(groups)
        demo_batches = []
        suppliers = [
            name
            for name, groups_for_supplier in sorted(
                supplier_pools.items(), key=lambda item: len(item[1]), reverse=True
            )
            if len(groups_for_supplier) >= 4
        ]
        if not groups:
            raise SystemExit(
                "No multi-supplier overlap groups found. The demo invoice generator needs at least one product shared by 3 suppliers."
            )
        if not suppliers:
            raise SystemExit("No suppliers with enough multi-supplier overlap products found.")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for existing in OUT_DIR.glob("invoice-*.pdf"):
        existing.unlink()

    made = []
    for index, (vendor, items) in enumerate(demo_batches[: args.count]):
        slug = re.sub(r"[^a-z0-9]+", "-", vendor.lower()).strip("-")
        invoice_no = f"{slug[:3].upper()}-{20260000 + index + 1}"
        path = OUT_DIR / f"invoice-{slug}-glove-demo.pdf"
        total = build_invoice(path, vendor, items, invoice_no, "sku-first", rng)
        made.append((path.name, vendor, len(items), total))

    for name, vendor, count, total in made:
        print(f"{name}: {vendor} · {count} items · {money(total)}")


if __name__ == "__main__":
    main()
