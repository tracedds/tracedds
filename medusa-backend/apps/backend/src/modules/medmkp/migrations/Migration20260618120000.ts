import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260618120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "medmkp_reorder_list" ("id" text not null, "practice_id" text not null, "state" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "medmkp_reorder_list_pkey" primary key ("id"));`);
    this.addSql(`create unique index if not exists "IDX_medmkp_reorder_list_practice_id_unique" on "medmkp_reorder_list" ("practice_id") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "medmkp_reorder_list" cascade;`);
  }

}
