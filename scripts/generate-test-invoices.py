#!/usr/bin/env python3
"""Generate dental test invoice PDFs from real supplier catalog data.

Reads priced supplier products from the local MedMKP Postgres, marks prices
up 5-30% (so the savings pipeline has something to find), and renders
realistic vendor invoices into demo-assets/test-invoices/.

Usage:
  python3 scripts/generate-test-invoices.py [--count N] [--seed S]

DATABASE_URL is taken from the environment or from
medusa-backend/apps/backend/.env.
"""

import argparse
import datetime
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


def database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env_path = ROOT / "medusa-backend" / "apps" / "backend" / ".env"
    for line in env_path.read_text().splitlines():
        match = re.match(r"^DATABASE_URL=(.+)$", line)
        if match:
            return match.group(1).strip()
    raise SystemExit("DATABASE_URL not found")


def load_products():
    """supplier name -> [(sku, product name, price_cents)] via psql (no driver dep)."""
    sql = (
        "SELECT s.name, p.sku, p.name, snap.price_cents "
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
    products = {}
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) != 4:
            continue
        supplier, sku, name, price = parts
        products.setdefault(supplier, []).append((sku, name, int(price)))
    return products


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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=6, help="invoices per run")
    parser.add_argument("--seed", type=int, default=20260612)
    args = parser.parse_args()
    rng = random.Random(args.seed)

    catalog = load_products()
    suppliers = [name for name, rows in sorted(catalog.items()) if len(rows) >= 12]
    if not suppliers:
        raise SystemExit("No suppliers with priced products found in the database.")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    made = []
    for index in range(args.count):
        known_vendor = index < args.count - 1  # last one is an unknown vendor
        supplier = suppliers[index % len(suppliers)]
        pool = catalog[supplier]
        picks = rng.sample(pool, k=min(rng.randint(6, 12), len(pool)))

        items = []
        for sku, name, price in picks:
            qty = rng.choice([1, 2, 2, 3, 4, 5, 6, 8, 10, 12])
            markup = rng.uniform(1.05, 1.30)
            desc = re.sub(r"\s+", " ", name).strip()
            items.append((sku if known_vendor else "", desc, qty, rng.choice(UNITS), round(price * markup)))

        if known_vendor:
            vendor = supplier
        else:
            vendor = "Smile Source Distribution"

        slug = re.sub(r"[^a-z0-9]+", "-", vendor.lower()).strip("-")
        invoice_no = f"{slug[:3].upper()}-{rng.randint(10000, 99999)}"
        path = OUT_DIR / f"invoice-{slug}-{invoice_no.lower()}.pdf"
        total = build_invoice(path, vendor, items, invoice_no, rng.choice(["sku-first", "desc-first"]), rng)
        made.append((path.name, vendor, len(items), total))

    for name, vendor, count, total in made:
        print(f"{name}: {vendor} · {count} items · {money(total)}")


if __name__ == "__main__":
    main()
