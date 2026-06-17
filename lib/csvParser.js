// Minimal CSV invoice parser. Expects a header row and maps common column
// aliases to the same line-item shape parseInvoicePdf produces, so uploads of
// a reorder sheet flow through the exact same matching pipeline as PDFs.

const COLUMN_ALIASES = {
  description: ["description", "item", "product", "name", "details"],
  sku: ["sku", "item #", "item#", "item number", "catalog", "catalog #", "part", "part #", "mfg #"],
  qty: ["qty", "quantity", "qty ordered", "ordered", "count"],
  unit: ["unit", "uom", "unit of measure", "pack"],
  price: ["unit price", "price", "unit cost", "cost", "each", "price ea"],
};

// Split a single CSV line, honoring double-quoted fields with embedded commas.
function splitRow(line) {
  const cells = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

function resolveColumns(header) {
  const lower = header.map((value) => value.toLowerCase());
  const index = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    index[field] = lower.findIndex((col) => aliases.includes(col));
  }
  return index;
}

function parseMoneyCents(value) {
  const cleaned = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(cleaned) ? Math.round(cleaned * 100) : null;
}

export function parseInvoiceCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { vendor: "", invoiceNumber: "", lineItems: [], rowCount: lines.length };
  }

  const header = splitRow(lines[0]);
  const cols = resolveColumns(header);
  if (cols.description < 0) {
    return { vendor: "", invoiceNumber: "", lineItems: [], rowCount: lines.length };
  }

  const lineItems = [];
  for (const line of lines.slice(1)) {
    const cells = splitRow(line);
    const description = (cells[cols.description] || "").trim();
    if (description.length < 3) continue;

    const qty = cols.qty >= 0 ? Number(String(cells[cols.qty]).replace(/[^\d.]/g, "")) : 1;
    const unitPriceCents = cols.price >= 0 ? parseMoneyCents(cells[cols.price]) : null;

    lineItems.push({
      sku: cols.sku >= 0 ? (cells[cols.sku] || "").trim() : "",
      description,
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      unit: (cols.unit >= 0 ? cells[cols.unit] : "") || "each",
      unit_price_cents: unitPriceCents,
      total_cents: unitPriceCents != null ? unitPriceCents * (qty || 1) : null,
    });
  }

  return { vendor: "", invoiceNumber: "", lineItems, rowCount: lines.length };
}
