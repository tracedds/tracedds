import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260615223000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create index if not exists "IDX_medmkp_supplier_product_category_active" on "medmkp_supplier_product" ("category", "supplier_id") where "deleted_at" is null and "category" <> '';`);
    this.addSql(`create index if not exists "IDX_medmkp_supplier_price_snapshot_product_latest_active" on "medmkp_supplier_price_snapshot" ("supplier_product_id", "captured_at" desc) include ("price_cents") where "deleted_at" is null;`);
    this.addSql(`create index if not exists "IDX_medmkp_supplier_lower_name_active" on "medmkp_supplier" (lower("name")) where "deleted_at" is null;`);
    this.addSql(`create materialized view if not exists "medmkp_supplier_current_price" as select distinct on ("supplier_product_id") "supplier_product_id", "price_cents", "captured_at" from "medmkp_supplier_price_snapshot" where "deleted_at" is null order by "supplier_product_id", "captured_at" desc;`);
    this.addSql(`create unique index if not exists "IDX_medmkp_supplier_current_price_product" on "medmkp_supplier_current_price" ("supplier_product_id");`);
    this.addSql(`create index if not exists "IDX_medmkp_supplier_current_price_amount" on "medmkp_supplier_current_price" ("price_cents") where "price_cents" > 0;`);
    this.addSql(`create materialized view if not exists "medmkp_supplier_category_summary" as select "category", count(*) as "product_count", count(distinct "supplier_id") as "supplier_count" from "medmkp_supplier_product" where "deleted_at" is null and "category" <> '' and lower("category") <> 'dental supplies' and lower("category") not in (select lower("name") from "medmkp_supplier" where "deleted_at" is null) group by "category";`);
    this.addSql(`create unique index if not exists "IDX_medmkp_supplier_category_summary_category" on "medmkp_supplier_category_summary" ("category");`);
    this.addSql(`create index if not exists "IDX_medmkp_supplier_category_summary_product_count" on "medmkp_supplier_category_summary" ("product_count" desc);`);
    this.addSql(`create materialized view if not exists "medmkp_supplier_product_current_offer" as select p."category", p."name", p."sku", p."supplier_id", p."id" as "supplier_product_id", price."price_cents" from "medmkp_supplier_product" p join "medmkp_supplier_current_price" price on price."supplier_product_id" = p."id" and price."price_cents" > 0 where p."deleted_at" is null and p."category" <> '' and lower(p."category") <> 'dental supplies' and lower(p."category") not in (select lower("name") from "medmkp_supplier" where "deleted_at" is null);`);
    this.addSql(`create unique index if not exists "IDX_medmkp_supplier_product_current_offer_product" on "medmkp_supplier_product_current_offer" ("supplier_product_id");`);
    this.addSql(`create index if not exists "IDX_medmkp_supplier_product_current_offer_category_price" on "medmkp_supplier_product_current_offer" ("category", "price_cents");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop materialized view if exists "medmkp_supplier_product_current_offer";`);
    this.addSql(`drop materialized view if exists "medmkp_supplier_category_summary";`);
    this.addSql(`drop materialized view if exists "medmkp_supplier_current_price";`);
    this.addSql(`drop index if exists "IDX_medmkp_supplier_lower_name_active";`);
    this.addSql(`drop index if exists "IDX_medmkp_supplier_price_snapshot_product_latest_active";`);
    this.addSql(`drop index if exists "IDX_medmkp_supplier_product_category_active";`);
  }

}
