import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// Follow-up to Migration20260619170000 (cart-build job + supplier credential):
// adds the ephemeral on-the-fly login columns to the cart-build job. A separate
// migration because 170000 is already merged — editing an applied migration
// won't re-run.
export class Migration20260619180000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "medmkp_cart_build_job" add column if not exists "credentials_encrypted" text null;`);
    this.addSql(`alter table if exists "medmkp_cart_build_job" add column if not exists "credentials_username" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "medmkp_cart_build_job" drop column if exists "credentials_encrypted";`);
    this.addSql(`alter table if exists "medmkp_cart_build_job" drop column if exists "credentials_username";`);
  }

}
