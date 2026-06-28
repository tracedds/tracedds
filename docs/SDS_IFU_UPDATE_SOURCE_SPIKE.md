# SDS/IFU Update Source Strategy — Decision Spike

**Issue:** #355 (parent epic #310, Phase 5 of `TRACEDDS_PIVOT_PLAN.md`)
**Status:** Proposed — awaiting approval. **Decision/spike only; no implementation in this PR.**
**Author:** drafted with Claude

## Question

How does TraceDDS learn that a manufacturer's SDS or IFU has changed, so the Compliance
Redline workflow (#310) has a *new version* to diff against the practice's stored evidence?

The epic's versioning model already reserves a `source_kind` enum
(`upload | supplier_monitor | manufacturer_monitor | manual_replace`). This spike decides which
of those we build first, what we defer, and the exact event shape the diff engine consumes — so
that #348 (versioning), #349 (manual replacement API), and #350 (diff generation) can be built
without guessing.

## TL;DR recommendation

- **v1 — Manual replace-on-receipt** (`source_kind = upload | manual_replace`), plus an
  honest, lightweight **"recheck assist"** (track SDS/IFU age + a per-product manufacturer
  document link the office manager can open). **No crawler, no licensed corpus.**
- **Later — Registry-first hybrid monitoring**: lean on **free authoritative feeds**
  (FDA **AccessGUDID / openFDA UDI** for device IFU/version metadata — *already integrated* for
  GTIN enrichment) for the device side, add **targeted manufacturer-page monitoring** for the
  practice's actual top SDS-bearing products, and license a commercial SDS database
  (e.g. SDS Manager API) **only for the residual gap** if/when crawl reliability proves
  insufficient. Build narrow on free feeds first; buy only the gap.

**Why this order:** OSHA's actual obligation is that the *employer keeps the most recently
**received** SDS* — manufacturers must supply an updated SDS with the next shipment or on
request, and are **not** required to proactively push revisions to customers
([OSHA 1910.1200(g)](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.1200)).
So the legal trigger to update a practice's binder is *"a new sheet arrived / was requested,"*
which manual replace-on-receipt models exactly. A "we detect every manufacturer revision"
claim requires an expensive, never-complete corpus and would violate the project's
no-overclaim rule (`DESIGN.md`, epic #310 non-goals). v1 should make redline **real and
honest**; broad detection is an earned, later capability.

## Options considered

Per-option: **cost · reliability · data rights · operational burden · compliance risk.**

### A. Manual-only / replace-on-receipt  ✅ v1
The office manager uploads a newer SDS/IFU (received with a shipment, or pulled from the
manufacturer site) and TraceDDS versions it and generates the redline.

- **Cost:** ~$0 net-new. Reuses #308 upload + #309 extraction + #350 diff.
- **Reliability:** 100% for what's uploaded; **0% proactive** — misses updates nobody fetches.
- **Data rights:** Clean. The practice owns/received the document; we store *their* copy.
- **Operational burden:** Low for us; recurring effort for the practice (the honest tradeoff).
- **Compliance risk:** **Lowest.** Matches the legal "retain most-recently-received" duty and
  makes no detection claim we can't back. The audit trail is genuine.

### B. Manufacturer-site monitoring (crawl)
Crawl each manufacturer's SDS/IFU page for the practice's products; diff on change.

- **Cost:** Engineering-heavy (per-site adapters, change detection, anti-bot) — the same cost
  curve we already hit in `SUPPLIER_INGESTION.md`. Scales with brand count, not customers.
- **Reliability:** Medium and brittle — layout changes, CF/anti-bot, PDFs behind portals. But
  **bounded**: a dental practice's SDS universe is small (dozens–low-hundreds of products,
  concentrated in a few dozen brands), so targeted monitoring of *their* top products is far
  more tractable than a general corpus.
- **Data rights:** Gray. Republishing scraped manufacturer PDFs as the practice's "master"
  has IP/ToS exposure; safer to store a **hash + link + extracted fields** and let the user
  fetch the actual file.
- **Operational burden:** High and ongoing (adapter rot).
- **Compliance risk:** Medium — partial coverage can read as false assurance unless the UI is
  explicit about which products are monitored vs. manual.

### C. Supplier feed
Get updated-SDS signals from the distributors we already ingest (Net32, DC Dental, Henry
Schein, etc.).

- **Cost:** Low-medium *if a feed exists* — but distributors generally surface a current SDS
  link per product, not a change/version event, and OSHA doesn't require them to push updates.
- **Reliability:** Low for *change detection* (no revision timestamps); fine as a **link source**.
- **Data rights:** Same gray area as crawling.
- **Operational burden:** Medium; piggybacks on existing ingestion adapters.
- **Compliance risk:** Medium — distributor copy may lag the manufacturer's current revision.
- **Verdict:** Not a standalone strategy; **folds into B** as a cheap link/identity source.

### D. Licensed SDS database (buy)
License a commercial corpus with versioned SDS + API (SDS Manager, VelocityEHS/MSDSonline,
Chemwatch, 3E).

- **Cost:** SDS Manager publishes transparent, library-sized pricing (~$468/yr @100 SDS →
  ~$2,064/yr @1,000); VelocityEHS / Chemwatch (≈150M SDS) are enterprise quote-only. Per-practice
  SDS counts are small, so *coverage* is cheap; the question is **redistribution licensing**.
- **Reliability:** High for covered chemicals; vendors maintain versions + change feeds.
- **Data rights:** **The crux.** Licenses typically permit *internal lookup*, not redistributing
  the vendor's SDS as the customer's stored compliance artifact or audit packet. Must be
  negotiated explicitly before this can back the binder.
- **Operational burden:** Low engineering, recurring license cost + vendor dependency.
- **Compliance risk:** Low on freshness; **legal/contractual risk on redistribution** is the
  blocker. Devices/IFUs are largely **out of scope** for chemical-SDS vendors anyway.
- **Verdict:** Best *later* fallback for the residual SDS gap — **not** v1, and only after a
  redistribution clause is confirmed.

### E. Registry feed (FDA GUDID / openFDA) — device IFU side
FDA **AccessGUDID** + **openFDA UDI** expose device identity, labeling metadata, and version
info via free API + RSS. **TraceDDS already integrates GUDID** for GTIN enrichment.

- **Cost:** ~$0 (public, already wired in).
- **Reliability:** High and authoritative *for devices* — but it's identity/labeling **metadata**
  (and pointers), not always the full IFU PDF; the actual IFU often lives on the manufacturer site.
- **Data rights:** Clean (public US-gov data).
- **Operational burden:** Low; extend the existing enrichment path.
- **Compliance risk:** Low. Covers only UDI-bearing devices, not chemical SDSs.
- **Verdict:** The **anchor of the later hybrid** for IFUs — pair with B for the file itself.

## Decision

| Phase | Strategy | `source_kind` | Rationale |
|---|---|---|---|
| **v1** | **A** manual replace-on-receipt + recheck assist | `upload`, `manual_replace` | Matches the real OSHA duty, $0, honest, unblocks #348/#349/#350 immediately |
| **Later** | **E + B** registry-first hybrid (GUDID for device IFU version metadata; targeted manufacturer monitoring for top SDS products), **D** licensed corpus only for the residual gap, **C** distributors as a link source | `manufacturer_monitor`, `supplier_monitor`, (`registry_monitor`) | Free authoritative feeds first; buy only the gap; coverage scoped to the practice's actual products |

**Build-vs-buy verdict:** *Neither, for v1.* Then **build narrow on free feeds** (E + targeted B)
before buying (D), and only buy if crawl reliability for the practice's real product set proves
insufficient and a redistribution license is obtainable.

### Honesty / UI guardrail (carries the recommendation)
Coverage must be visible per document: **Monitored** (we watch a source) vs. **Manual**
(you must recheck). v1 is Manual everywhere. Never render a global "up to date" badge that
implies detection we don't have. This keeps the audit-readiness claim truthful (epic #310
non-goal: *no claim we've detected every manufacturer update until the source strategy proves it*).

## Minimum update event shape (what the Redline workflow needs)

The diff engine (#350) and versioning model (#348) need a single normalized event regardless of
source. Proposed shape — a superset that degrades gracefully (manual fills only the top fields):

```text
EvidenceUpdateEvent
  evidence_document_id        # which stored document this updates (nullable = first-seen)
  product_id / location_id    # what it attaches to
  doc_type                    SDS | IFU | (later: service | waterline | price)
  source_kind                 upload | manual_replace | supplier_monitor
                              | manufacturer_monitor | registry_monitor
  detected_at

  observed_identity:
    manufacturer
    product_name
    version_label             nullable   # e.g. "Rev C", "v3"
    revision_date             nullable   # manufacturer's stated revision date
    effective_date            nullable

  artifact:
    storage_key                          # object storage (not Postgres) per pivot plan
    mime_type
    file_hash                 sha256      # the real change signal
    file_size_bytes

  prior_version_ref           nullable   # current accepted version, if any

  change_signal:
    kind                      first_seen | new_version | content_changed | unchanged
    basis                     revision_date | file_hash | extracted_field
                                         # WHY we think it changed (drives materiality)

  confidence                  high | medium | low      # provenance honesty → UI badge
  provenance:
    origin                    uploaded_by:<actor> | url:<…> | shipment:<id> | gudid:<di>
    retrieved_at
```

**Minimum fields to *open a redline*:** a stable `evidence_document_id` to attach to, a new
`artifact` with `file_hash`, and a `change_signal.basis`. Everything else enriches the review.

**Materiality rule (defer noise):** only `revision_date` change **or** `file_hash` change that
yields an extracted-field delta sets `pending_review` and requires re-acknowledgment. An
identical-hash re-fetch is `unchanged` and never creates work. This keeps Dashboard from
crying wolf and is the same gate the diff service (#350) applies.

This shape is a strict superset of epic #310's `medmkp_evidence_document_version.source_kind`
and adds `registry_monitor`, `file_hash`, `change_signal`, and `confidence` — recommend folding
those into #348's schema so provenance and materiality are first-class, not bolted on later.

## Proposed follow-up issues — DO NOT FILE until this decision is approved

Per the issue's acceptance criteria, implementation issues are produced *after* approval:

1. **#348 amendment** — add `file_hash`, `change_signal_*`, `confidence`, `provenance_*`, and the
   `registry_monitor` enum value to the versioning schema.
2. **v1 manual replace UX + API** (extends #349) — "Replace with newer version" on an evidence
   document → creates a `manual_replace` version → emits an `EvidenceUpdateEvent` → #350 diff.
3. **Recheck-assist** — store a per-product manufacturer SDS/IFU link + document age; surface
   "Recheck (last verified N days ago)" in Needs Attention/Dashboard. Honest, no crawler.
4. *(Later, gated)* **GUDID/openFDA IFU version watch** — extend existing GUDID enrichment to
   detect device labeling/version changes and emit `registry_monitor` events.
5. *(Later, gated)* **Targeted manufacturer-page monitor** — per-brand adapters for the practice's
   top SDS products; store hash + link + extracted fields, not republished PDFs.
6. *(Later, gated)* **Licensed-corpus spike** — only if 4+5 leave a material gap; must confirm a
   redistribution license before storing vendor SDS as the practice's artifact.

## Sources
- [OSHA 1910.1200 Hazard Communication (SDS update duty, paragraph (g))](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.1200)
- [OSHA interpretation — HazCom effective dates and SDSs](https://www.osha.gov/laws-regs/standardinterpretations/2015-07-27)
- [FDA — Global Unique Device Identification Database (GUDID)](https://www.fda.gov/medical-devices/unique-device-identification-system-udi-system/global-unique-device-identification-database-gudid)
- [AccessGUDID](https://accessgudid.nlm.nih.gov/) · [openFDA UDI API](https://open.fda.gov/apis/device/udi/)
- [SDS Manager pricing (transparent, API-enabled)](https://sdsmanager.com/us/pricing/)
- [Chemwatch SDS database + API services](https://chemwatch.net/services/api/)
- [VelocityEHS / MSDSonline](https://www.ehs.com/about-us/)
