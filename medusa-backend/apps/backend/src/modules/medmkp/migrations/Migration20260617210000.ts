import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260617210000 extends Migration {

  override async up(): Promise<void> {
    // Denormalized blocking read-model for invoice line-item matching. Lets the
    // match endpoint retrieve candidates with indexed SQL instead of loading the
    // whole catalog into memory per request. Populated by refreshMatchIndex
    // (src/matching/match-index.ts), refreshed alongside the other read-models.
    this.addSql(`create table if not exists "medmkp_supplier_product_match_index" ("supplier_product_id" text not null, "supplier_id" text not null, "norm_sku" text not null default '', "norm_mfr_sku" text not null default '', "code_tokens" text[] not null default '{}', "core_tokens" text[] not null default '{}', constraint "medmkp_supplier_product_match_index_pkey" primary key ("supplier_product_id"));`);
    this.addSql(`create index if not exists "IDX_medmkp_spmi_supplier_norm_sku" on "medmkp_supplier_product_match_index" ("supplier_id", "norm_sku");`);
    this.addSql(`create index if not exists "IDX_medmkp_spmi_norm_mfr_sku" on "medmkp_supplier_product_match_index" ("norm_mfr_sku");`);
    this.addSql(`create index if not exists "IDX_medmkp_spmi_code_tokens" on "medmkp_supplier_product_match_index" using gin ("code_tokens");`);
    this.addSql(`create index if not exists "IDX_medmkp_spmi_core_tokens" on "medmkp_supplier_product_match_index" using gin ("core_tokens");`);

    // The offer/finalize lookups walk medmkp_canonical_product_match by
    // supplier_product_id and canonical_product_id; those columns are indexed by
    // Migration20260617190000 (deleted_at-partial), which this feature relies on.
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "medmkp_supplier_product_match_index" cascade;`);
  }

}
