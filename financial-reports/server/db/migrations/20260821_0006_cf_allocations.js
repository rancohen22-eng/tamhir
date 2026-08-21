'use strict';
/*
 * נייר עבודה לתזרים לפי סעיף (מבנה "נייר עבודה-מאוחד" בהרכבה):
 * לכל שורת מאזן, התנועה (סגירה − פתיחה) מוקצית לדליי פעילות:
 *   operating | interest_tax | investing | financing | noncash | transfers | translation | fx
 * סכום הדליים על פני כל השורות = תזרים המזומנים. בקרה per שורה: פתיחה + Σהקצאות = סגירה.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('cashflow_allocations', (t) => {
    t.increments('id').primary();
    t.integer('version_id').notNullable().references('id').inTable('report_versions').onDelete('CASCADE');
    t.integer('fs_line_id').notNullable().references('id').inTable('fs_lines').onDelete('CASCADE');
    t.string('bucket', 16).notNullable(); // operating|interest_tax|investing|financing|noncash|transfers|translation|fx
    t.decimal('amount', 24, 6).notNullable().defaultTo(0);
    t.unique(['version_id', 'fs_line_id', 'bucket']);
  });
};
exports.down = async function down(knex) { await knex.schema.dropTableIfExists('cashflow_allocations'); };
