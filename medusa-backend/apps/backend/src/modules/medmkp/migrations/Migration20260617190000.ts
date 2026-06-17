import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// Performance: index the hot search / scan paths. The live product search
// (api/medmkp/products/search -> enrichWithOffers) filters
// medmkp_canonical_product_match by canonical_product_id / supplier_product_id
// on every request, and those columns were unindexed -> full seq scans of the
// ~150k-row / 225 MB match table (~23 s cold). The scanner's exact-SKU path
// seq-scanned the ~141k-row supplier_product table the same way, and the fuzzy
// text search ran an unindexable ILIKE '%term%' over canonical
// name/handle/category.
//
// On prod these are applied out-of-band with CREATE INDEX CONCURRENTLY (can't
// run inside a migration transaction), so this migration is a no-op there;
// IF NOT EXISTS makes it build them only on fresh DBs. All partial on
// "deleted_at" is null to match the soft-delete query pattern + existing style.
export class Migration20260617190000 extends Migration {

  override async up(): Promise<void> {
    // Join keys used by enrichWithOffers (fuzzy search) and the SKU scan path.
    this.addSql(`create index if not exists "IDX_medmkp_canonical_product_match_canonical_product_id" on "medmkp_canonical_product_match" ("canonical_product_id") where "deleted_at" is null;`);
    this.addSql(`create index if not exists "IDX_medmkp_canonical_product_match_supplier_product_id" on "medmkp_canonical_product_match" ("supplier_product_id") where "deleted_at" is null;`);

    // Fuzzy text search: trigram GIN so ILIKE '%term%' becomes index-driven.
    this.addSql(`create extension if not exists pg_trgm;`);
    this.addSql(`create index if not exists "IDX_medmkp_canonical_product_name_trgm" on "medmkp_canonical_product" using gin ("name" gin_trgm_ops) where "deleted_at" is null;`);
    this.addSql(`create index if not exists "IDX_medmkp_canonical_product_handle_trgm" on "medmkp_canonical_product" using gin ("handle" gin_trgm_ops) where "deleted_at" is null;`);
    this.addSql(`create index if not exists "IDX_medmkp_canonical_product_category_trgm" on "medmkp_canonical_product" using gin ("category" gin_trgm_ops) where "deleted_at" is null;`);

    // Barcode / exact-SKU scanner lookups (code= path).
    this.addSql(`create index if not exists "IDX_medmkp_supplier_product_sku" on "medmkp_supplier_product" ("sku") where "deleted_at" is null;`);
    this.addSql(`create index if not exists "IDX_medmkp_supplier_product_manufacturer_sku" on "medmkp_supplier_product" ("manufacturer_sku") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_medmkp_canonical_product_match_canonical_product_id";`);
    this.addSql(`drop index if exists "IDX_medmkp_canonical_product_match_supplier_product_id";`);
    this.addSql(`drop index if exists "IDX_medmkp_canonical_product_name_trgm";`);
    this.addSql(`drop index if exists "IDX_medmkp_canonical_product_handle_trgm";`);
    this.addSql(`drop index if exists "IDX_medmkp_canonical_product_category_trgm";`);
    this.addSql(`drop index if exists "IDX_medmkp_supplier_product_sku";`);
    this.addSql(`drop index if exists "IDX_medmkp_supplier_product_manufacturer_sku";`);
    // pg_trgm is left installed; dropping a shared extension on rollback is unsafe.
  }

}
