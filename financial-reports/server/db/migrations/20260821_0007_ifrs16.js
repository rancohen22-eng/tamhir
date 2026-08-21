'use strict';
/*
 * מודול IFRS 16: הסכמי חכירה per חברה, עם תנועות התחייבות ונכס זכות-שימוש per גרסה.
 * המאוחד = צירוף החברות המאוחדות איחוד מלא (לא אקוויטי).
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('ifrs16_agreements', (t) => {
    t.increments('id').primary();
    t.integer('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.string('currency', 8).defaultTo('USD');
    t.string('notes', 400);
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // תנועה per הסכם per גרסה (סגירה מחושבת)
  await knex.schema.createTable('ifrs16_movements', (t) => {
    t.increments('id').primary();
    t.integer('agreement_id').notNullable().references('id').inTable('ifrs16_agreements').onDelete('CASCADE');
    t.integer('version_id').notNullable().references('id').inTable('report_versions').onDelete('CASCADE');
    // התחייבות
    t.decimal('liab_open', 24, 6).defaultTo(0);
    t.decimal('liab_add', 24, 6).defaultTo(0);
    t.decimal('liab_disposal', 24, 6).defaultTo(0);
    t.decimal('liab_payment', 24, 6).defaultTo(0);
    t.decimal('liab_interest', 24, 6).defaultTo(0);
    t.decimal('liab_fx', 24, 6).defaultTo(0);
    // נכס זכות שימוש
    t.decimal('asset_open', 24, 6).defaultTo(0);
    t.decimal('asset_add', 24, 6).defaultTo(0);
    t.decimal('asset_disposal', 24, 6).defaultTo(0);
    t.decimal('asset_depreciation', 24, 6).defaultTo(0);
    // חלות שוטפת (פרעונות 12 חודשים הבאים)
    t.decimal('current_portion', 24, 6).defaultTo(0);
    t.integer('row_version').notNullable().defaultTo(1);
    t.unique(['agreement_id', 'version_id']);
  });
};
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('ifrs16_movements');
  await knex.schema.dropTableIfExists('ifrs16_agreements');
};
