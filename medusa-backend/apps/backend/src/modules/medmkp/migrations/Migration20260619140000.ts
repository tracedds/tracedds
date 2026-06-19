import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// GTIN enrichment from FDA GUDID (see scripts/ingest-gudid-gtin-reference.ts and
// enrich-barcodes-from-gudid.ts).
//
// 1. medmkp_gtin_reference: a normalized brand+model -> GTIN lookup distilled
//    from the GUDID full release (GS1 Primary DIs only). Keyed by (brand_norm,
//    model_norm) which is exactly how the enrichment join borrows a GTIN onto a
//    supplier product that ships without one (e.g. Henry Schein).
// 2. medmkp_supplier_product.barcode_source: records where a barcode came from
//    ("gudid" vs an ingested supplier upccode) so an enrichment re-run only ever
//    overwrites its own rows, never a supplier-provided one.
export class Migration20260619140000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "medmkp_gtin_reference" ("id" text not null, "gtin" text not null, "brand_norm" text not null, "model_norm" text not null, "brand_name" text null, "model_raw" text null, "company_name" text null, "issuing_agency" text null, "device_id_type" text null, "pkg_quantity" text null, constraint "medmkp_gtin_reference_pkey" primary key ("id"));`);
    this.addSql(`create index if not exists "IDX_medmkp_gtin_reference_brand_model" on "medmkp_gtin_reference" ("brand_norm", "model_norm");`);
    this.addSql(`create index if not exists "IDX_medmkp_gtin_reference_model" on "medmkp_gtin_reference" ("model_norm");`);

    this.addSql(`alter table if exists "medmkp_supplier_product" add column if not exists "barcode_source" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "medmkp_supplier_product" drop column if exists "barcode_source";`);
    this.addSql(`drop index if exists "IDX_medmkp_gtin_reference_model";`);
    this.addSql(`drop index if exists "IDX_medmkp_gtin_reference_brand_model";`);
    this.addSql(`drop table if exists "medmkp_gtin_reference";`);
  }

}
