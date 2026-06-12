import { getDocumentProxy } from "unpdf";

const MONEY_RE = /\$?\d{1,3}(?:,\d{3})*\.\d{2}\b/g;
const SKU_RE = /^[A-Z0-9][A-Z0-9\-./]{2,19}$/;
const NON_ITEM_KEYWORDS = /\b(subtotal|sub-total|total|tax|shipping|freight|balance|amount due|payment|invoice|terms|thank you|page \d)\b/i;
const UNIT_WORDS = new Set([
  "each", "ea", "box", "boxes", "bx", "case", "cases", "cs", "pack", "packs",
  "pk", "pkg", "roll", "rolls", "bag", "bags", "bottle", "bottles", "btl",
  "kit", "kits", "tube", "tubes", "unit", "units", "sleeve", "carton", "ct",
]);

function parseMoney(token) {
  return Math.round(Number(token.replace(/[$,]/g, "")) * 100);
}

/**
 * Rebuild visual rows from pdf.js positioned text items: group by y
 * coordinate (2pt tolerance), order by x, and insert column gaps where
 * the horizontal distance between items is large.
 */
async function extractRows(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const rows = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const positioned = content.items
      .filter((item) => item.str && item.str.trim())
      .map((item) => ({ x: item.transform[4], y: item.transform[5], width: item.width || 0, text: item.str }))
      .sort((a, b) => b.y - a.y);

    // Cluster items into visual lines: cells in the same table row can sit
    // at slightly different baselines (e.g. wrapped paragraph cells), so
    // group anything within 3pt of the line's running y.
    const lines = [];
    for (const item of positioned) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(item.y - line.y) <= 3) {
        line.parts.push(item);
      } else {
        lines.push({ y: item.y, parts: [item] });
      }
    }

    for (const { parts: unsorted } of lines) {
      const parts = unsorted.sort((a, b) => a.x - b.x);
      let text = "";
      let lastEnd = null;
      const cells = [];
      let cell = "";
      for (const part of parts) {
        const gap = lastEnd === null ? 0 : part.x - lastEnd;
        if (lastEnd !== null && gap > 8) {
          cells.push(cell.trim());
          cell = part.text;
        } else {
          cell += (cell && !cell.endsWith(" ") && !part.text.startsWith(" ") ? " " : "") + part.text;
        }
        text += (text ? " " : "") + part.text;
        lastEnd = part.x + part.width;
      }
      if (cell.trim()) cells.push(cell.trim());
      rows.push({ text: text.replace(/\s+/g, " ").trim(), cells });
    }
  }

  return rows;
}

/**
 * A line item row has an integer quantity and at least one money value,
 * where qty * unit price ≈ line total (when two money values are present).
 */
function parseItemRow(row) {
  const moneyTokens = row.text.match(MONEY_RE) || [];
  if (!moneyTokens.length || NON_ITEM_KEYWORDS.test(row.text)) return null;

  const prices = moneyTokens.map(parseMoney);
  let unitPriceCents = null;
  let totalCents = null;
  let qty = null;

  const intTokens = (row.text.match(/\b\d{1,5}\b/g) || [])
    .map(Number)
    .filter((value) => value > 0 && value < 100000);

  if (prices.length >= 2) {
    const total = prices[prices.length - 1];
    const unit = prices[prices.length - 2];
    for (const candidate of intTokens) {
      if (Math.abs(unit * candidate - total) <= Math.max(2, total * 0.01)) {
        qty = candidate;
        unitPriceCents = unit;
        totalCents = total;
        break;
      }
    }
    // qty 1 often isn't printed as a standalone token
    if (qty === null && Math.abs(unit - total) <= 2) {
      qty = 1;
      unitPriceCents = unit;
      totalCents = total;
    }
  }

  if (qty === null && prices.length === 1) {
    // Single money value: treat it as the unit price if a plausible qty exists
    if (intTokens.length) {
      qty = intTokens[intTokens.length - 1];
      unitPriceCents = prices[0];
    }
  }

  if (qty === null || unitPriceCents === null) return null;

  // Strip qty/unit/price tokens off the text to isolate sku + description
  let remainder = row.text;
  for (const token of moneyTokens) {
    remainder = remainder.replace(token, " ");
  }
  remainder = remainder
    .replace(new RegExp(`\\b${qty}\\b`), " ")
    .replace(/\s+/g, " ")
    .trim();

  let unit = "";
  const words = remainder.split(" ");
  const trailing = words[words.length - 1]?.toLowerCase();
  if (UNIT_WORDS.has(trailing)) {
    unit = words.pop();
    remainder = words.join(" ");
  }

  let sku = "";
  const first = remainder.split(" ")[0] || "";
  if (SKU_RE.test(first) && /\d/.test(first) && remainder.split(" ").length > 1) {
    sku = first;
    remainder = remainder.slice(first.length).trim();
  }

  const description = remainder.replace(/^[-–—•#]\s*/, "").trim();
  if (description.length < 3) return null;

  return {
    sku,
    description,
    qty,
    unit: unit || "each",
    unit_price_cents: unitPriceCents,
    total_cents: totalCents ?? unitPriceCents * qty,
  };
}

function parseVendor(rows) {
  for (const row of rows.slice(0, 6)) {
    const text = row.text.trim();
    if (!text || /^invoice\b/i.test(text)) continue;
    if (/\d{3,}/.test(text) && !/[a-z]{3,}/i.test(text)) continue;
    return text;
  }
  return "";
}

function parseInvoiceNumber(rows) {
  for (const row of rows) {
    const match = row.text.match(/invoice\s*(?:#|no\.?|number)?\s*:?\s*([A-Z0-9-]{3,})/i);
    if (match && /\d/.test(match[1])) return match[1];
  }
  return "";
}

export async function parseInvoicePdf(buffer) {
  const rows = await extractRows(buffer);
  const lineItems = [];

  for (const row of rows) {
    const item = parseItemRow(row);
    if (item) lineItems.push(item);
  }

  return {
    vendor: parseVendor(rows),
    invoiceNumber: parseInvoiceNumber(rows),
    lineItems,
    rowCount: rows.length,
  };
}
