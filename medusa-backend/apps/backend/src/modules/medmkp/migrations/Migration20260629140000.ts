import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// Evidence Match Review persistence (#337). Two tables, both keyed to an
// evidence document:
//   - medmkp_evidence_extraction: the per-document extraction lifecycle
//     (queued/processing/extracted/failed/manual) and the structured fields
//     once pulled. Separate from evidence_document.status (the human-review
//     lifecycle). No OCR/provider is added here — only the persistence the
//     future drainer (#342) fills in.
//   - medmkp_evidence_match_candidate: ranked, explainable candidate matches a
//     reviewer confirms. internal_score is internal ranking math only — never a
//     user-facing confidence percentage.
export class Migration20260629140000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "medmkp_evidence_extraction" (
      "id" text not null,
      "evidence_document_id" text not null,
      "practice_id" text not null,
      "evidence_document_version_id" text null,
      "storage_key" text null,
      "status" text check ("status" in ('queued', 'processing', 'extracted', 'failed', 'manual')) not null default 'queued',
      "attempts" integer not null default 0,
      "extracted_fields" jsonb null,
      "extracted_by_model" text null,
      "error" text null,
      "claimed_at" timestamptz null,
      "finished_at" timestamptz null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "medmkp_evidence_extraction_pkey" primary key ("id")
    );`);
    // List/resolve a document's extraction record(s).
    this.addSql(`create index if not exists "IDX_medmkp_evidence_extraction_document" on "medmkp_evidence_extraction" ("evidence_document_id") where deleted_at is null;`);
    // The future drainer claims the oldest queued/processing row per practice.
    this.addSql(`create index if not exists "IDX_medmkp_evidence_extraction_status" on "medmkp_evidence_extraction" ("status", "created_at") where deleted_at is null;`);
    this.addSql(`create index if not exists "IDX_medmkp_evidence_extraction_practice" on "medmkp_evidence_extraction" ("practice_id") where deleted_at is null;`);
    this.addSql(`create index if not exists "IDX_medmkp_evidence_extraction_deleted_at" on "medmkp_evidence_extraction" ("deleted_at") where deleted_at is null;`);

    this.addSql(`create table if not exists "medmkp_evidence_match_candidate" (
      "id" text not null,
      "evidence_document_id" text not null,
      "practice_id" text not null,
      "evidence_extraction_id" text null,
      "candidate_type" text check ("candidate_type" in ('inventory_item', 'location', 'supplier_product', 'canonical_product')) not null,
      "candidate_id" text not null,
      "label" text null,
      "rank" integer not null,
      "strength" text check ("strength" in ('strong', 'possible', 'weak')) not null,
      "internal_score" numeric null,
      "reason_codes" jsonb null,
      "reasons" jsonb null,
      "status" text check ("status" in ('proposed', 'accepted', 'rejected', 'superseded')) not null default 'proposed',
      "decided_at" timestamptz null,
      "decided_by" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "medmkp_evidence_match_candidate_pkey" primary key ("id")
    );`);
    // Load a document's ranked shortlist in order.
    this.addSql(`create index if not exists "IDX_medmkp_evidence_match_candidate_document" on "medmkp_evidence_match_candidate" ("evidence_document_id", "rank") where deleted_at is null;`);
    // Navigate from a target row back to the evidence proposing it.
    this.addSql(`create index if not exists "IDX_medmkp_evidence_match_candidate_target" on "medmkp_evidence_match_candidate" ("candidate_type", "candidate_id") where deleted_at is null;`);
    this.addSql(`create index if not exists "IDX_medmkp_evidence_match_candidate_extraction" on "medmkp_evidence_match_candidate" ("evidence_extraction_id") where deleted_at is null;`);
    this.addSql(`create index if not exists "IDX_medmkp_evidence_match_candidate_practice" on "medmkp_evidence_match_candidate" ("practice_id") where deleted_at is null;`);
    this.addSql(`create index if not exists "IDX_medmkp_evidence_match_candidate_deleted_at" on "medmkp_evidence_match_candidate" ("deleted_at") where deleted_at is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "medmkp_evidence_match_candidate";`);
    this.addSql(`drop table if exists "medmkp_evidence_extraction";`);
  }

}
