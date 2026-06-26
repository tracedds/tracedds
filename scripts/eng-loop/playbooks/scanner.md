### Playbook: scanner correctness (barcode / lot / expiry)

Goal: fix ONE defect in the scan pipeline — barcode/GTIN/GS1/HIBC parsing, lot/expiry
capture, scan dedup, or the scan-result UI — verified with a **unit test and/or
before/after screenshots**. Scoped to what's testable **headless** (no live camera).

#### Where things live
- Parsers + specs: `medusa-backend/apps/backend/src/matching/__tests__/` —
  `gtin.unit.spec.ts`, `gs1.unit.spec.ts`, `hibc.unit.spec.ts` (and the modules they test).
  Run: `npm run test:unit` (from `medusa-backend/apps/backend`).
- Lot/expiry parsing: `app/ocrLabel.js` (+ `scripts/eng-loop/ocr/check-parser.mjs`). The
  `ocr` lane owns parsing *depth*; here focus on the **scan → identify → capture** flow and
  symbology handling.
- Scanner UI + barcode-lookup route: the scan views (`app/scan*.jsx`) and the `?barcode=`/`?code=` lookup.

#### 1. Find one defect (two headless-testable angles)
- **Parser/logic (preferred):** find a real barcode / GS1 / HIBC / GTIN string that parses
  wrong — wrong GTIN/check-digit, missed or mis-read lot/expiry, mis-routed symbology, or a
  dedup miss (same item scanned twice → two lines). The unit specs above are the harness; a
  failing assertion is your "before".
- **Scan UI:** `npm run dev` + `/browse` to drive the scanner's **manual code-entry** path
  (not the camera) — enter a code, confirm the result card resolves correctly (right product
  match, lot/expiry surfaced, repeat scans dedup). Screenshot before/after.

#### 2. Capture BEFORE
- Logic: the failing unit assertion / wrong parse output. UI: a screenshot of the wrong result.

#### 3. Fix it
- Minimal change to the parser/normalizer or scan-flow code. **Add or extend a unit test**
  capturing the case (`npm run test:unit` must pass).

#### 4. Verify (AFTER)
- `npm run test:unit` green (including the new case); for a UI fix, re-enter the code and
  screenshot the corrected scan result.

#### 5. Open the PR
- Commit code + test (+ UI evidence if applicable); push; `gh pr create`. "Verification" =
  the passing test (before→after) and/or before/after scan-result screenshots. No evidence → no PR.

#### Note
- The live **camera** decode path is not testable headless — stick to manual code entry + the
  parser specs. Don't attempt camera-based verification.
