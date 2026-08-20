'use strict';
/*
 * דוחות ראשיים: תזרים מזומנים (עם נייר עבודה) ושינויים בהון.
 *  - report_versions.prior_version_id: גרסת פתיחה/השוואה (override ידני).
 *  - cashflow_lines / cashflow_values: מבנה התזרים (per חברה) וערכים ידניים (per גרסה).
 *  - equity_rows / equity_values: שורות תנועה בהון וערכיהן.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('report_versions', (t) => {
    t.integer('prior_version_id').references('id').inTable('report_versions');
  });

  await knex.schema.createTable('cashflow_lines', (t) => {
    t.increments('id').primary();
    t.integer('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
    // section: operating_adj | operating_wc | operating_cash | investing | financing | fx | summary | noncash
    t.string('section', 20).notNullable();
    t.integer('sort_order').defaultTo(0);
    t.string('label', 250).notNullable();
    t.string('source_type', 12).notNullable().defaultTo('manual'); // manual | pnl | bs_move
    t.integer('source_fs_line_id').references('id').inTable('fs_lines').onDelete('SET NULL');
    t.integer('sign').notNullable().defaultTo(1); // כיוון תרומה לתזרים
    t.boolean('is_subtotal').notNullable().defaultTo(false);
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('cashflow_values', (t) => {
    t.increments('id').primary();
    t.integer('version_id').notNullable().references('id').inTable('report_versions').onDelete('CASCADE');
    t.integer('cashflow_line_id').notNullable().references('id').inTable('cashflow_lines').onDelete('CASCADE');
    t.decimal('amount', 24, 6).notNullable().defaultTo(0);
    t.integer('row_version').notNullable().defaultTo(1);
    t.unique(['version_id', 'cashflow_line_id']);
  });

  await knex.schema.createTable('equity_rows', (t) => {
    t.increments('id').primary();
    t.integer('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
    t.integer('sort_order').defaultTo(0);
    t.string('label', 200).notNullable();
    // kind: opening | profit | oci | movement | closing
    t.string('kind', 12).notNullable().defaultTo('movement');
  });

  await knex.schema.createTable('equity_values', (t) => {
    t.increments('id').primary();
    t.integer('version_id').notNullable().references('id').inTable('report_versions').onDelete('CASCADE');
    t.integer('equity_row_id').notNullable().references('id').inTable('equity_rows').onDelete('CASCADE');
    t.integer('fs_line_id').notNullable().references('id').inTable('fs_lines').onDelete('CASCADE'); // עמודת רכיב הון
    t.decimal('amount', 24, 6).notNullable().defaultTo(0);
    t.unique(['version_id', 'equity_row_id', 'fs_line_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('equity_values');
  await knex.schema.dropTableIfExists('equity_rows');
  await knex.schema.dropTableIfExists('cashflow_values');
  await knex.schema.dropTableIfExists('cashflow_lines');
  await knex.schema.alterTable('report_versions', (t) => { t.dropColumn('prior_version_id'); });
};
