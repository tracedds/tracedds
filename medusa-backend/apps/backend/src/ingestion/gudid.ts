// Distills the FDA GUDID full release (AccessGUDID monthly XML) into a compact
// brand+model -> GTIN reference. We keep every GS1 Device Identifier (the
// deviceId is a GTIN), regardless of Primary vs Package type: in practice many
// devices carry a HIBCC *Primary* DI (the HIBC barcode, handled by our separate
// HIBC bridge) while the scannable GTIN lives on the GS1 *Package* identifiers.
// Non-GS1 agencies (HIBCC/ICCBBA — not GTINs) are dropped here.
//
// Records are flat `<device>...</device>` blocks with simple `<tag>value</tag>`
// fields, so targeted extraction avoids pulling in a streaming-XML dependency.

export type GtinReferenceRow = {
  id: string
  gtin: string
  brand_norm: string
  model_norm: string
  brand_name: string
  model_raw: string
  company_name: string
  issuing_agency: string
  device_id_type: string
  pkg_quantity: string
}

// Normalize an identifier/brand for joining: lowercase, strip everything that
// isn't a letter or digit. Mirrors the normalization the enrichment join does
// in SQL so a row written here matches a supplier product's brand/MPN.
export function normalizeGudidKey(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
}

// Reads the text of a flat element. Returns "" for an xsi:nil or absent element.
function tagText(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  if (!match) return ""
  if (/xsi:nil="true"/.test(match[1] ?? "")) return ""
  return decodeEntities(match[2] ?? "").trim()
}

// The minimum normalized model length we will index. Short codes ("1", "42",
// "co2") collide with thousands of unrelated devices and would attach a wrong
// GTIN; the enrichment also enforces this, but dropping them here keeps the
// reference table lean.
export const MIN_MODEL_LEN = 4

type Gs1Identifier = { gtin: string; deviceIdType: string; pkgQuantity: string }

/**
 * Extract the GTIN reference rows from one GUDID <device> block. Emits one row
 * per (GS1 GTIN x distinct model key), where the model keys are the normalized
 * versionModelNumber and catalogNumber and the GTINs are every GS1 identifier
 * on the device (Primary or Package). Returns [] when the device carries no GS1
 * identifier or no usable model key.
 */
export function extractGudidReferenceRows(deviceBlock: string): GtinReferenceRow[] {
  const identifiersBlock = deviceBlock.match(/<identifiers>([\s\S]*?)<\/identifiers>/)?.[1] ?? ""

  const gs1: Gs1Identifier[] = []
  for (const idMatch of identifiersBlock.matchAll(/<identifier>([\s\S]*?)<\/identifier>/g)) {
    const idBlock = idMatch[1]
    if (tagText(idBlock, "deviceIdIssuingAgency") !== "GS1") continue
    const gtin = tagText(idBlock, "deviceId").replace(/\D/g, "")
    if (!gtin) continue
    gs1.push({
      gtin,
      deviceIdType: tagText(idBlock, "deviceIdType"),
      pkgQuantity: tagText(idBlock, "pkgQuantity"),
    })
  }
  if (!gs1.length) return []

  const brandRaw = tagText(deviceBlock, "brandName")
  const companyName = tagText(deviceBlock, "companyName")
  const brandNorm = normalizeGudidKey(brandRaw) || normalizeGudidKey(companyName)
  if (!brandNorm) return []

  const versionModel = tagText(deviceBlock, "versionModelNumber")
  const catalog = tagText(deviceBlock, "catalogNumber")
  const modelNorms: string[] = []
  for (const modelRaw of [versionModel, catalog]) {
    const modelNorm = normalizeGudidKey(modelRaw)
    if (modelNorm.length < MIN_MODEL_LEN) continue
    if (modelNorms.includes(modelNorm)) continue
    modelNorms.push(modelNorm)
  }

  const rows: GtinReferenceRow[] = []
  for (const modelNorm of modelNorms) {
    const modelRaw = normalizeGudidKey(versionModel) === modelNorm ? versionModel : catalog
    for (const id of gs1) {
      rows.push({
        id: `${id.gtin}:${brandNorm}:${modelNorm}`,
        gtin: id.gtin,
        brand_norm: brandNorm,
        model_norm: modelNorm,
        brand_name: brandRaw,
        model_raw: modelRaw.trim(),
        company_name: companyName,
        issuing_agency: "GS1",
        device_id_type: id.deviceIdType,
        pkg_quantity: id.pkgQuantity,
      })
    }
  }
  return rows
}
