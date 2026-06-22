import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// The /medmkp/categories landing computed, on every request, the number of
// priced canonical families per category — a join over the full match +
// current-price tables with a DISTINCT/GROUP BY. On the memory-constrained prod
// instance (work_mem=64kB) that spilled to disk and took 16-34s, so the request
// timed out and the catalog rendered "unavailable". Materialize that count here
// (same set, counted the same way as the drill-down) so the request path does a
// trivial read; the heavy aggregation runs once per read-model refresh.
//
// Parallel workers each allocate work_mem, so we disable parallelism and give a
// single bounded budget — fast enough to populate at deploy time without OOMing.
export class Migration20260621130000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`SET LOCAL max_parallel_workers_per_gather = 0;`);
    this.addSql(`SET LOCAL work_mem = '64MB';`);
    this.addSql(`create materialized view if not exists "medmkp_category_priced_count" as
      with "priced_canon" as (
        select distinct m."canonical_product_id" as "id"
        from "medmkp_canonical_product_match" m
        join "medmkp_supplier_current_price" cp on cp."supplier_product_id" = m."supplier_product_id"
        where m."match_status" <> 'unmatched' and m."deleted_at" is null
      )
      select lower(btrim(p."category")) as "category",
             count(distinct coalesce(p."family_id", p."id"))::int as "product_count"
      from "priced_canon" pc
      join "medmkp_canonical_product" p on p."id" = pc."id"
      where p."category" <> '' and p."deleted_at" is null
      group by lower(btrim(p."category"));`);
    // Unique index doubles as the key required by REFRESH ... CONCURRENTLY.
    this.addSql(`create unique index if not exists "IDX_medmkp_category_priced_count_category" on "medmkp_category_priced_count" ("category");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop materialized view if exists "medmkp_category_priced_count";`);
  }

}
