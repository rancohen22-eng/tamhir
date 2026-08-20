'use strict';
/*
 * תמיכה בטוען מבנה סטנדרטי (מיפוי שמות חברות) ובמודול איחוד:
 *  - companies.aliases: שמות חלופיים (כפי שמופיעים בקובץ הייצוא של המערכת הפיננסית).
 *  - consolidation_members: קישור גרסת מאוחד -> גרסאות הבנות שמרכיבות אותה.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('companies', (t) => {
    t.text('aliases'); // רשימת שמות חלופיים מופרדת בשורות/פסיקים
  });

  await knex.schema.createTable('consolidation_members', (t) => {
    t.increments('id').primary();
    t.integer('consolidated_version_id').notNullable().references('id').inTable('report_versions').onDelete('CASCADE');
    t.integer('member_version_id').notNullable().references('id').inTable('report_versions').onDelete('CASCADE');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['consolidated_version_id', 'member_version_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('consolidation_members');
  await knex.schema.alterTable('companies', (t) => { t.dropColumn('aliases'); });
};
