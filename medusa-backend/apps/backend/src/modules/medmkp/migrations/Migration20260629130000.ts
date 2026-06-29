import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// Compliance Redline CR-1: immutable evidence document versioning. A
// document (medmkp_evidence_document) keeps its identity while each captured
// file + extracted-field snapshot is recorded as a frozen version here. A
// document points at its current accepted version via current_version_id;
// the accepted version can also be derived (status = 'accepted'). Versions
// are immutable after creation except for review/status metadata.
export class Migration20260629130000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "medmkp_evidence_document_version" (
      "id" text not null,
      "evidence_document_id" text not null,
      "practice_id" text not null,
      "version_number" integer not null,
      "status" text check ("status" in ('pending', 'accepted', 'superseded', 'rejected')) not null default 'pending',
      "file_name" text null,
      "file_mime_type" text null,
      "file_extension" text null,
      "file_size_bytes" numeric null,
      "storage_key" text null,
      "file_hash" text null,
      "extracted_fields" jsonb null,
      "source_kind" text check ("source_kind" in ('upload', 'scan', 'email', 'import', 'api', 'manual', 'other')) not null default 'upload',
      "captured_by" text null,
      "captured_at" timestamptz null,
      "accepted_at" timestamptz null,
      "accepted_by" text null,
      "superseded_at" timestamptz null,
      "superseded_by_version_id" text null,
      "rejected_at" timestamptz null,
      "rejected_by" text null,
      "review_note" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "medmkp_evidence_document_version_pkey" primary key ("id")
    );`);
    // List/resolve a document's versions in order.
    this.addSql(`create index if not exists "IDX_medmkp_evidence_document_version_document" on "medmkp_evidence_document_version" ("evidence_document_id", "version_number") where deleted_at is null;`);
    // One accepted version per document (the current truth); also guards
    // against a second concurrent accept. Pending/superseded are unconstrained.
    this.addSql(`create unique index if not exists "UQ_medmkp_evidence_document_version_accepted" on "medmkp_evidence_document_version" ("evidence_document_id") where status = 'accepted' and deleted_at is null;`);
    // Monotonic version numbers per document.
    this.addSql(`create unique index if not exists "UQ_medmkp_evidence_document_version_number" on "medmkp_evidence_document_version" ("evidence_document_id", "version_number") where deleted_at is null;`);
    this.addSql(`create index if not exists "IDX_medmkp_evidence_document_version_practice_status" on "medmkp_evidence_document_version" ("practice_id", "status") where deleted_at is null;`);
    this.addSql(`create index if not exists "IDX_medmkp_evidence_document_version_deleted_at" on "medmkp_evidence_document_version" ("deleted_at") where deleted_at is null;`);

    // The document's explicit pointer to its current accepted version.
    this.addSql(`alter table if exists "medmkp_evidence_document" add column if not exists "current_version_id" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "medmkp_evidence_document" drop column if exists "current_version_id";`);
    this.addSql(`drop table if exists "medmkp_evidence_document_version";`);
  }

}
