# Evidence Extraction — Provider & Job Architecture (Phase 3a spike)

**Status:** Recommendation — 2026-06-28 · **Decision/spike only.** Gates [#342]
(extraction worker) and the [#309] Match Review epic. Follow-ups are *proposed*
at the end, not filed — file them only after this is approved.

This answers the two open questions blocking Evidence Match Review:

1. **What extracts fields from an uploaded SDS / IFU / lot / price document?**
2. **What job/worker pattern moves a document through
   `queued → processing → extracted → failed` with retry?**

It is the Evidence-side companion to [`PRODUCT_MATCHING.md`](PRODUCT_MATCHING.md)
and resolves Open Decision #1 in
[`TRACEDDS_PIVOT_PLAN.md`](TRACEDDS_PIVOT_PLAN.md) ("the OCR/classify/extract step
is a vision-LLM pipeline — net-new and the hardest new capability").

---

## TL;DR

- **Provider:** a **vision-LLM (Claude), not a dedicated OCR/doc-AI service.** One
  call classifies the document *and* extracts our domain fields *and* cites the
  source text for each — a dedicated OCR (Textract / Document AI / Azure DI)
  returns raw text + generic key/values and still needs an LLM layer on top to map
  to product/manufacturer/UDI/lot/expiry. One system beats two. Default model:
  **`claude-sonnet-4-6`** (vision + structured outputs, $3/$15 per MTok); **Haiku
  4.5** for cheap doc-type triage, **Opus 4.8** held in reserve for re-runs on
  failures. **≈ 2–5¢ per document.**
- **Job pattern:** reuse the **DB-backed job-queue** idiom already proven by
  `medmkp_cart_build_job` (queued → processing → done/failed, `claimed_at`
  stale-reaping, input/output JSON), but drained by an **in-process Medusa
  scheduled job** (`src/jobs/`) instead of an off-box runner — extraction is an
  API call, not a browser session, so it needs no NUC. New table:
  `medmkp_evidence_extraction_job`. No Redis/Bull (none in the stack).
- **Explainability:** every extracted field carries `{ value, source: {text, page} }`
  — a quoted snippet, **never a confidence %** ([`PRODUCT_MATCHING.md`](PRODUCT_MATCHING.md)
  and the product direction both require this). Results feed candidate generation
  by reusing `matching/normalize.ts` + `score.ts` unchanged.

---

## 1. Provider: vision-LLM (Claude) over dedicated OCR/doc-AI

### Why not a dedicated OCR / document-AI service

AWS Textract, Google Document AI, and Azure Document Intelligence are excellent at
turning a page into text + bounding boxes + generic key/value pairs. But Evidence
Match Review does not need generic key/values — it needs *our* fields
(`document_type`, manufacturer, catalog/REF, UDI/GTIN, lot, expiration, SDS
revision date) with a **source citation per field**. With a dedicated OCR you would
still bolt an LLM on top to do the classify-and-map step, the dental-domain
reasoning, and the source attribution — i.e. you'd run **two** systems, pay both,
and own the glue. A vision-LLM does OCR + classification + domain mapping +
citation in **one** call.

### Why this is heavier than `app/ocrLabel.js`

The existing scan-label OCR ([`app/ocrLabel.js`](../app/ocrLabel.js)) is Tesseract
(WASM) running **on-device**, deliberately **assistive and single-purpose**: it
reads a *lot* and an *expiry* off one captured camera frame and hands them to the
user as a suggestion to confirm. It is regex-over-OCR on a tiny, known target.

Evidence doc-AI is a different problem and cannot reuse that path:

| `ocrLabel.js` (keep as-is) | Evidence extraction (this spike) |
| --- | --- |
| One camera frame | Multi-page PDF/image from object storage |
| 2 fields (lot, expiry) | Classify type + ~10 fields + per-field source |
| Fixed label layout | SDS/IFU/lot/price — wildly different layouts |
| On-device, free, instant | Server-side, billed, seconds — runs in a worker |
| Regex over OCR text | Vision + reasoning over document structure |

A 16-section SDS or a multi-page IFU is a document-understanding task, not a
regex-over-OCR task — which is exactly why the pivot plan flags it as "the hardest
new capability."

### Model choice (within Claude)

Reuse the **exact precedent already in the backend**:
[`src/matching/llm.ts`](../medusa-backend/apps/backend/src/matching/llm.ts) (the
Tier-3 axis proposer) calls Claude through an **injectable `ModelRunner`** seam and
parses a JSON object out of the reply. Keep that seam (it makes the pipeline
testable without spawning a model) and add image/PDF input.

| Stage | Model | Why |
| --- | --- | --- |
| Doc-type triage (optional) | `claude-haiku-4-5` ($1/$5) | Cheap "is this an SDS/IFU/lot/price?" gate |
| **Field extraction (v1 default)** | **`claude-sonnet-4-6` ($3/$15)** | Vision + **structured outputs** (`output_config.format`), best cost/quality for semi-structured docs |
| Re-run on `failed` / low-signal | `claude-opus-4-8` ($5/$25) | High-resolution vision (2576px long edge) for dense or degraded scans |

**Structured outputs** (`output_config: { format: { type: "json_schema", … } }`,
supported on Sonnet 4.6 / Opus 4.8 / Haiku 4.5) guarantee the response matches our
field schema — no fenced-JSON scraping like `matching/llm.ts` has to do today.

### How the call is made (config — no hardcoded keys)

Two homes were considered:

- **(A) In-process Medusa scheduled job on the Render backend, via the Anthropic
  SDK + Files API.** Provision **`ANTHROPIC_API_KEY`** as a backend env var (same
  custody model as `SUPPLIER_CRED_KEY` / `CART_AGENT_TOKEN` — env only, never in
  the DB, never committed). The worker uploads the blob (Files API) and sends a
  `document`/image content block.
- **(B) Off-box NUC runner driving the `claude -p` subscription CLI** (no API key),
  the way `matching/llm.ts` and the eng-loop do it.

**Recommend (A).** Extraction is a core, unattended product feature; binding it to
an interactive subscription login on the NUC (B) makes a NUC outage a product
outage. (A) keeps it on the backend with one provisioned secret. Keep the
`ModelRunner` seam so (B) — or a local fixture — remains a drop-in for tests and
for a cost-free backfill path.

**Human must provision:** `ANTHROPIC_API_KEY` (backend env), object-storage
credentials + bucket (S3/R2 — blobs go there, **not** the 1 GB Render Postgres that
already OOMs), and optionally `EVIDENCE_EXTRACT_MODEL` / cron-cadence / concurrency
knobs.

---

## 2. Job/worker pattern: DB-backed queue + scheduled-job drainer

### Reuse the cart-build idiom, drop the off-box runner

`medmkp_cart_build_job`
([model](../medusa-backend/apps/backend/src/modules/medmkp/models/cart-build-job.ts),
[claim](../medusa-backend/apps/backend/src/api/medmkp/agent/claim/route.ts),
[result](../medusa-backend/apps/backend/src/api/medmkp/agent/result/route.ts))
already establishes the pattern we want:

- a job row with a `status` enum, an input snapshot (`lines`), an output (`results`),
  `claimed_at`, `finished_at`, and `error`;
- **atomic claim** of the oldest `queued` row;
- **stale reaping** — a job stuck `running` past `STALE_RUNNING_MS` (10 min) is
  re-claimed so a crashed worker can't wedge the queue;
- a terminal escape (`needs_auth`) when the job can't proceed and needs a human.

Cart-build needs an **off-box NUC runner** only because it drives a *browser*.
Extraction is a plain API call, so collapse the claim/result round-trip into an
**in-process Medusa scheduled job** (`src/jobs/extract-evidence.ts`,
[scheduled-jobs primitive](../medusa-backend/apps/backend/src/jobs/README.md), cron
e.g. `* * * * *`). No NUC, no token-gated claim/result routes, no Redis/Bull (the
stack has none — Medusa 2.15 + Postgres only).

### New model — separate from `evidence_document.status`

Do **not** overload `evidence_document.status`
([model](../medusa-backend/apps/backend/src/modules/medmkp/models/evidence-document.ts)):
that enum (`missing/captured/partial/verified/rejected/archived`) is the
**human-review / coverage** lifecycle. The **extraction** lifecycle is a different
axis and gets its own table, exactly as cart-build is a separate table from the
order it builds.

**Shipped in [#337]** as
[`medmkp_evidence_extraction`](../medusa-backend/apps/backend/src/modules/medmkp/models/evidence-extraction.ts)
(the persistence-only slice — no provider, no drainer). The status enum and the
claim/attempt/finish columns below are present; #342 only adds the in-process
drainer that fills them in:

```ts
// medmkp_evidence_extraction — one extraction record per document.
const EvidenceExtraction = model.define("medmkp_evidence_extraction", {
  id: model.id({ prefix: "evext" }).primaryKey(),
  evidence_document_id: model.text(),       // FK → medmkp_evidence_document
  practice_id: model.text(),
  storage_key: model.text().nullable(),     // the blob to read (object storage)
  status: model
    .enum(["queued", "processing", "extracted", "failed", "manual"])
    .default("queued"),
  attempts: model.number().default(0),      // bounded retry
  extracted_fields: model.json().nullable(), // the field schema below
  error: model.text().nullable(),
  claimed_at: model.dateTime().nullable(),  // stale-reaping, as in cart-build
  finished_at: model.dateTime().nullable(),
})
```

### State machine

```
            enqueue (on upload #308, or manual re-trigger)
                                │
                                ▼
   ┌────────┐  claim   ┌────────────┐  model ok   ┌───────────┐
   │ queued │ ───────▶ │ processing │ ──────────▶ │ extracted │ (feeds matching)
   └────────┘          └────────────┘             └───────────┘
        ▲                    │ model/parse error
        │ retry (attempts<N) ▼
        └──────────────── ┌────────┐  attempts≥N or refusal  ┌────────┐
   reap stale processing  │ failed │ ──────────────────────▶ │ manual │ (human links by hand)
   (claimed_at too old)   └────────┘                         └────────┘
```

- **`queued → processing`**: scheduled job atomically claims the oldest `queued`
  row (or reaps a `processing` row whose `claimed_at` is older than
  `STALE_PROCESSING_MS`), sets `claimed_at`.
- **`processing → extracted`**: model returned schema-valid fields → persist
  `extracted`, set `finished_at`.
- **`processing → failed`**: transient API error (429/5xx — SDK auto-retries
  first), unparseable reply, or `stop_reason: "refusal"`. Record `error`,
  increment `attempts`.
- **`failed → queued`**: retry while `attempts < N` (e.g. 3).
- **`failed → manual`** (terminal): retries exhausted or hard refusal → surfaces in
  Match Review for a human to link by hand (the `needs_auth` analogue, and the
  manual-link fallback #342 requires).

This satisfies #342's acceptance directly: queued/processing/extracted/failed
states, persisted failure detail, a retry + manual-link path, and config that is
documented and not hardcoded.

---

## 3. Extracted-field schema (what #342 produces, what #309 consumes)

Each field is **explainable**: a value plus the source text it came from — never a
confidence percentage. This mirrors `ocrLabel.js` ("never auto-commit an OCR
guess") and [`PRODUCT_MATCHING.md`](PRODUCT_MATCHING.md)'s trust rules.

```jsonc
{
  "document_type": { "value": "sds", "source": { "text": "SAFETY DATA SHEET", "page": 1 } },
  "manufacturer":  { "value": "Kerr", "source": { "text": "Manufacturer: Kerr Corp", "page": 1 } },
  "product_name":  { "value": "OptiBond eXTRa Universal", "source": { "text": "...", "page": 1 } },
  "catalog_ref":   { "value": "34669", "source": { "text": "REF 34669", "page": 1 } },
  "udi_gtin":      { "value": "00827229001234", "source": { "text": "(01)00827229001234", "page": 2 } },
  "lot_number":    { "value": "A00626", "source": { "text": "LOT A00626", "page": 2 } },
  "expiration_date": { "value": "2027-03-31", "source": { "text": "EXP 2027-03", "page": 2 } },
  "revision_date": { "value": "2025-08-01", "source": { "text": "Revision date: 2025-08-01", "page": 1 } }
}
```

- `document_type` is constrained to the existing `evidence_document.document_type`
  enum (`sds/ifu/expiration/lot/service/price/waterline/other`).
- **Dental SDS/IFU specifics:** SDS has a stable 16-section structure — anchor
  extraction on §1 (product identifier, manufacturer, REF) and the revision date
  (drives the Phase-5 redline feature). IFUs are layout-variable; rely on the
  vision model rather than positional rules. Lot/price docs are short and overlap
  with the on-device label OCR.
- Missing fields are allowed (partial extraction is useful — a lot with no expiry
  still pre-fills half the review form).

### Feeding candidate generation (#309)

An extracted document is "a supplier product description with worse data" — exactly
the case [`PRODUCT_MATCHING.md` § Line Item Matching](PRODUCT_MATCHING.md) already
designed. **Reuse `matching/normalize.ts` + `score.ts` unchanged:**

1. `normalizeProduct({ name: product_name, manufacturer_sku: catalog_ref, brand:
   manufacturer, … })` → normalized SKU, name tokens, brand, attributes.
2. Resolve by exact `catalog_ref` / `udi_gtin` first (highest precision); else
   block + `scorePair` against canonical products.
3. Carry the decision's status + **`match_reason`** (the explainable string, e.g.
   `auto:exact sku=0.75(mfr-sku) name=0.81 brand=match`) — **not** a percentage —
   as the ranked candidate list.
4. Match Review shows the extracted fields (with their source snippets) beside the
   ranked candidates; the human **accepts / rejects / edits** the link. Nothing is
   auto-committed.

---

## 4. Cost, reliability, data-rights

**Per-document cost (Claude vision).** PDF pages cost roughly 1.5–3K image tokens
each (up to ~4,784 at high resolution), plus ~1–2K output tokens for the schema:

| Doc | Pages | Model | ≈ cost |
| --- | --- | --- | --- |
| Lot / price slip | 1 | Sonnet 4.6 | ~$0.01 |
| IFU | 4 | Sonnet 4.6 | ~$0.02–0.04 |
| SDS | 8–16 | Sonnet 4.6 | ~$0.04–0.08 |
| SDS (hard re-run) | 8–16 | Opus 4.8 | ~$0.08–0.15 |

So **≈ 2–5¢ for a typical document**; a practice's initial few-hundred-doc backfill
is single-digit dollars one-time. The **Batches API halves** token cost for
non-urgent bulk backfill.

**Reliability/accuracy.** Structured outputs guarantee shape; source citations let
a human verify each field; the SDK auto-retries 429/5xx; bounded `attempts` then a
`manual` fallback means a bad document never wedges the queue. Trust rule (same as
matching): **never auto-link** — extraction populates a review queue, a human
confirms.

**Data-rights / privacy.** Blobs live in **object storage, not Postgres**
(Open Decision #1). SDS/IFU are public manufacturer compliance docs (low
sensitivity); service records may name staff — flag for review, no PHI expected.
Anthropic API default data retention (30 days) is acceptable; document it. Only the
bytes of the document being extracted are sent to the model.

---

## 5. Proposed follow-ups (do **not** file until approved)

0. **[#337] (done)** — persistence landed: `medmkp_evidence_extraction` and
   `medmkp_evidence_match_candidate` models + migration, plus the pure
   `matching/evidence-candidate-records.ts` bridge from the ranker to candidate
   rows. No provider/worker (that's #342). Build + unit tests cover the mapping.
1. **[#342] (already open)** — now unblocked: add the `src/jobs/extract-evidence.ts`
   scheduled drainer that claims/reaps/retries the `medmkp_evidence_extraction`
   rows from #337 (per §2) and enqueue-on-upload. Tests cover
   queued/processing/extracted/failed/retry/manual.
2. **Extraction module** — Claude vision call behind the `ModelRunner` seam from
   `matching/llm.ts`, with structured outputs + the §3 schema. Tests use a fixture
   runner (no live model).
3. **Candidate generation** — wire extracted fields into `normalize.ts`/`score.ts`
   to produce ranked, explainable candidates for #309, persisted via
   `toMatchCandidateRecords` (#337).
4. **Config/infra** — provision `ANTHROPIC_API_KEY` + object-storage bucket;
   depends on **[#308]** (real upload creating stored documents).
5. **[#309] Match Review UI** — consume extracted fields (with source snippets) +
   candidate list; accept/reject/edit. (Separate FE work; this spike only unblocks
   the BE contract.)

[#308]: https://github.com/tracedds/tracedds/issues/308
[#309]: https://github.com/tracedds/tracedds/issues/309
[#342]: https://github.com/tracedds/tracedds/issues/342
