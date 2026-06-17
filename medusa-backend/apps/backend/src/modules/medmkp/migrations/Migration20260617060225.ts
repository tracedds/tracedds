import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// Additive-only: structured pack normalization columns. All nullable so the
// migration is safe against the 143k existing supplier_product rows and 387k
// existing price snapshots. (Hand-written: db:generate mis-detected the schema
// snapshot and emitted full create-table/drop-table statements.)
export class Migration20260617060225 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "medmkp_supplier_product"
      add column if not exists "pack_quantity" numeric null,
      add column if not exists "base_unit" text null,
      add column if not exists "pack_basis" text null,
      add column if not exists "pack_parse_source" text null,
      add column if not exists "pack_parse_confidence" integer null;`);

    this.addSql(`alter table if exists "medmkp_supplier_price_snapshot"
      add column if not exists "unit_price_cents" integer null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "medmkp_supplier_product"
      drop column if exists "pack_quantity",
      drop column if exists "base_unit",
      drop column if exists "pack_basis",
      drop column if exists "pack_parse_source",
      drop column if exists "pack_parse_confidence";`);

    this.addSql(`alter table if exists "medmkp_supplier_price_snapshot"
      drop column if exists "unit_price_cents";`);
  }

}
