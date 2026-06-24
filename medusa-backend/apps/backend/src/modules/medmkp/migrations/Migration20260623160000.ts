import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// Scanner-first compliance model, step 1 — evolve inventory_item from a census
// row into an append-only lot-at-location EVIDENCE record, and tag scan sessions
// with how they capture.
//   medmkp_inventory_item.is_estimated   — quantity is an estimate, not a count
//   medmkp_inventory_item.capture_type   — receiving | shelf_audit (provenance)
//   medmkp_inventory_item.pulled_at      — human-confirmed physical removal
//   medmkp_inventory_item.pulled_reason  — expiry | recall | manual
//   medmkp_scan_session.capture_type     — receiving | shelf_audit
// Purely additive (ADD COLUMN IF NOT EXISTS); existing rows keep working
// (is_estimated defaults true, capture_type defaults shelf_audit). The new
// expiration_date index serves the expiring/expired "pull now" worklist.
export class Migration20260623160000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "medmkp_inventory_item" add column if not exists "is_estimated" boolean not null default true;`);
    this.addSql(`alter table if exists "medmkp_inventory_item" add column if not exists "capture_type" text null;`);
    this.addSql(`alter table if exists "medmkp_inventory_item" add column if not exists "pulled_at" timestamptz null;`);
    this.addSql(`alter table if exists "medmkp_inventory_item" add column if not exists "pulled_reason" text null;`);
    this.addSql(`create index if not exists "IDX_medmkp_inventory_item_expiration_date" on "medmkp_inventory_item" ("expiration_date") where "deleted_at" is null;`);

    this.addSql(`alter table if exists "medmkp_scan_session" add column if not exists "capture_type" text not null default 'shelf_audit';`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_medmkp_inventory_item_expiration_date";`);
    this.addSql(`alter table if exists "medmkp_inventory_item" drop column if exists "is_estimated";`);
    this.addSql(`alter table if exists "medmkp_inventory_item" drop column if exists "capture_type";`);
    this.addSql(`alter table if exists "medmkp_inventory_item" drop column if exists "pulled_at";`);
    this.addSql(`alter table if exists "medmkp_inventory_item" drop column if exists "pulled_reason";`);
    this.addSql(`alter table if exists "medmkp_scan_session" drop column if exists "capture_type";`);
  }

}
