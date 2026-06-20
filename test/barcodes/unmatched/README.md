# Unmatched barcode images

Real dental-supply barcodes that the scanner decodes correctly but that **do
NOT resolve to any catalog product** — i.e. catalog coverage gaps. Use these to
analyze what we're missing and to test the scanner's "Not found" path.

## How these were gathered

1. ~536 dental-device GTINs pulled from the openFDA UDI/GUDID API
   (`api.fda.gov/device/udi.json`) across major dental manufacturers
   (3M, Dentsply, Kerr, GC America, Premier, Ultradent, Hu-Friedy, Coltene,
   Septodont, Young Dental).
2. Each was screened against the prod scanner
   `GET /medmkp/products/search?barcode=<gtin>`. 356 returned **no match**.
3. Deduped to distinct trade items (zero-stripped GTIN core, dropping GTIN-14
   pack variants), then for a batch of 80: rendered a real linear barcode image
   (`barcodeapi.org`), **verified** it decodes with `zbarimg` AND re-confirmed
   the decoded value still returns count 0 from the scanner. Only decode-AND-
   no-match images are kept.

All images are **linear** symbologies the scanner supports
(UPC-A / EAN-13 for GTIN-12/13, Code-128 for GTIN-14) — never QR.

## Contents

- 80 PNG barcode images, named `<gtin>.png`.
- `MANIFEST.csv` — file, GTIN, company name, brand, device description (from
  openFDA), so each unmatched barcode is traceable to the real product it
  represents.

## Re-check against the scanner

```bash
../scan-and-match.sh <image.png>   # expect:  NOMATCH <file> <code> -
```
