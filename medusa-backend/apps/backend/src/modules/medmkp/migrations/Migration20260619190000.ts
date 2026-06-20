import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// Indexes for the scan-time GUDID reverse lookup (products/search/route.ts
// resolveByGtinReference). It normalizes sku / manufacturer_sku / brand / name
// (strip non-alphanumerics, lowercase) and matches them against the GUDID
// reference; without indexes on the normalized expressions each barcode miss
// seq-scans ~230k rows with per-row regexp (~80s, enough to crash a prod
// backend). Functional btree indexes serve the equality paths; trigram GIN
// indexes serve the product-line `LIKE '%' || model` / `LIKE '%' || brand || '%'`
// path. Plain CREATE INDEX (not CONCURRENTLY): CONCURRENTLY stalls on Render.
export class Migration20260619190000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create extension if not exists pg_trgm;`);
    this.addSql(`create index if not exists "idx_msp_norm_sku" on "medmkp_supplier_product" (lower(regexp_replace(sku, '[^a-z0-9]', '', 'gi'))) where deleted_at is null;`);
    this.addSql(`create index if not exists "idx_msp_norm_mfrsku" on "medmkp_supplier_product" (lower(regexp_replace(manufacturer_sku, '[^a-z0-9]', '', 'gi'))) where deleted_at is null;`);
    this.addSql(`create index if not exists "idx_msp_norm_brand" on "medmkp_supplier_product" (lower(regexp_replace(brand, '[^a-z0-9]', '', 'gi'))) where deleted_at is null;`);
    this.addSql(`create index if not exists "idx_msp_norm_mfrsku_trgm" on "medmkp_supplier_product" using gin (lower(regexp_replace(manufacturer_sku, '[^a-z0-9]', '', 'gi')) gin_trgm_ops) where deleted_at is null;`);
    this.addSql(`create index if not exists "idx_msp_norm_name_trgm" on "medmkp_supplier_product" using gin (lower(regexp_replace(name, '[^a-z0-9]', '', 'gi')) gin_trgm_ops) where deleted_at is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "idx_msp_norm_name_trgm";`);
    this.addSql(`drop index if exists "idx_msp_norm_mfrsku_trgm";`);
    this.addSql(`drop index if exists "idx_msp_norm_brand";`);
    this.addSql(`drop index if exists "idx_msp_norm_mfrsku";`);
    this.addSql(`drop index if exists "idx_msp_norm_sku";`);
  }

}
