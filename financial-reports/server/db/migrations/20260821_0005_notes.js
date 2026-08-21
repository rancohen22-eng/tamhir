'use strict';
// ביאורים מילוליים לדוחות — טקסט חופשי per גרסה, מוזרם לייצוא ה-Word.
exports.up = async function up(knex) {
  await knex.schema.createTable('report_notes', (t) => {
    t.increments('id').primary();
    t.integer('version_id').notNullable().references('id').inTable('report_versions').onDelete('CASCADE');
    t.string('note_ref', 20).notNullable(); // מספר ביאור (מקושר ל-note_ref בשורות הדוח)
    t.string('title', 250);
    t.text('body');
    t.integer('sort_order').defaultTo(0);
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.unique(['version_id', 'note_ref']);
  });
};
exports.down = async function down(knex) { await knex.schema.dropTableIfExists('report_notes'); };
