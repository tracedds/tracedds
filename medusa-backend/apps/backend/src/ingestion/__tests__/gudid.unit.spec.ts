import { extractGudidReferenceRows, normalizeGudidKey } from "../gudid"

// A faithful GS1 device block (one Primary GS1 DI, brand, model, catalog).
const GS1_DEVICE = `<device xmlns="http://www.fda.gov/cdrh/gudid">
  <identifiers>
    <identifier>
      <deviceId>00616784430225</deviceId>
      <deviceIdType>Primary</deviceIdType>
      <deviceIdIssuingAgency>GS1</deviceIdIssuingAgency>
      <pkgQuantity>200</pkgQuantity>
    </identifier>
  </identifiers>
  <brandName>Syngauze</brandName>
  <versionModelNumber>2100-HS </versionModelNumber>
  <catalogNumber xsi:nil="true"></catalogNumber>
  <companyName>Medicom Inc.</companyName>
</device>`

// HIBCC-only device: the Primary DI is the model number, not a GTIN, and there
// is no GS1 identifier — must be dropped.
const HIBCC_DEVICE = `<device>
  <identifiers>
    <identifier>
      <deviceId>ZBAC1401</deviceId>
      <deviceIdType>Primary</deviceIdType>
      <deviceIdIssuingAgency>HIBCC</deviceIdIssuingAgency>
    </identifier>
  </identifiers>
  <brandName>Dongle</brandName>
  <versionModelNumber>ZBAC1401</versionModelNumber>
  <companyName>ZIRKONZAHN SRL</companyName>
</device>`

// The common real shape: HIBCC Primary DI (HIBC barcode) plus the scannable
// GTIN on a GS1 Package identifier. We must capture the GS1 Package GTIN.
const HIBCC_PRIMARY_GS1_PACKAGE = `<device>
  <identifiers>
    <identifier>
      <deviceId>N75240748JGSR11</deviceId>
      <deviceIdType>Primary</deviceIdType>
      <deviceIdIssuingAgency>HIBCC</deviceIdIssuingAgency>
    </identifier>
    <identifier>
      <deviceId>10885403123456</deviceId>
      <deviceIdType>Package</deviceIdType>
      <deviceIdIssuingAgency>GS1</deviceIdIssuingAgency>
      <pkgQuantity>12</pkgQuantity>
    </identifier>
  </identifiers>
  <brandName>Hu-Friedy</brandName>
  <versionModelNumber>SDCM12</versionModelNumber>
  <companyName>Hu-Friedy Mfg</companyName>
</device>`

// Short model code that would collide with thousands of devices — dropped.
const SHORT_MODEL_DEVICE = `<device>
  <identifiers>
    <identifier>
      <deviceId>00012345678905</deviceId>
      <deviceIdType>Primary</deviceIdType>
      <deviceIdIssuingAgency>GS1</deviceIdIssuingAgency>
    </identifier>
  </identifiers>
  <brandName>Acme</brandName>
  <versionModelNumber>42</versionModelNumber>
  <companyName>Acme</companyName>
</device>`

describe("extractGudidReferenceRows", () => {
  it("emits a GS1 row keyed by normalized brand + model", () => {
    const rows = extractGudidReferenceRows(GS1_DEVICE)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      gtin: "00616784430225",
      brand_norm: "syngauze",
      model_norm: "2100hs",
      issuing_agency: "GS1",
      device_id_type: "Primary",
      pkg_quantity: "200",
    })
    // id is unique per gtin+brand+model so the loader can dedupe.
    expect(rows[0].id).toBe("00616784430225:syngauze:2100hs")
  })

  it("ignores the nil catalogNumber and does not emit a duplicate", () => {
    const rows = extractGudidReferenceRows(GS1_DEVICE)
    expect(rows.map((r) => r.model_norm)).toEqual(["2100hs"])
  })

  it("drops HIBCC-only devices (no GS1 identifier)", () => {
    expect(extractGudidReferenceRows(HIBCC_DEVICE)).toEqual([])
  })

  it("captures the GS1 Package GTIN even when the Primary DI is HIBCC", () => {
    const rows = extractGudidReferenceRows(HIBCC_PRIMARY_GS1_PACKAGE)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      gtin: "10885403123456",
      brand_norm: "hufriedy",
      model_norm: "sdcm12",
      device_id_type: "Package",
      pkg_quantity: "12",
    })
  })

  it("drops models shorter than the minimum length (collision guard)", () => {
    expect(extractGudidReferenceRows(SHORT_MODEL_DEVICE)).toEqual([])
  })

  it("normalizeGudidKey strips punctuation and lowercases", () => {
    expect(normalizeGudidKey("2100-HS ")).toBe("2100hs")
    expect(normalizeGudidKey("3M™ Unitek™")).toBe("3munitek")
    expect(normalizeGudidKey(undefined)).toBe("")
  })
})
