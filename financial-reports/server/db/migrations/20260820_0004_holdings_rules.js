'use strict';
/*
 * שלב 3: שיעורי אחזקה לאיחוד/אקוויטי, וחוקי מיון אוטומטי.
 *  - consolidation_members: holding_pct + method (full/equity).
 *  - reclass_rules: הגדרות חוקי מיון per חברה.
 *  - reclassifications: source + rule_id (הבחנה ידני / מיוצר-אוטומטי).
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('consolidation_members', (t) => {
    t.decimal('holding_pct', 7, 4).notNullable().defaultTo(100);
    t.string('method', 10).notNullable().defaultTo('full'); // full | equity
  });

  await knex.schema.createTable('reclass_rules', (t) => {
    t.increments('id').primary();
    t.integer('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('sort_order').defaultTo(0);
    t.string('source_scope_type', 12).notNullable().defaultTo('subheader'); // section | subheader | all
    t.string('source_scope_value', 200); // קוד סעיף / טקסט כותרת-משנה
    t.string('sign', 10).notNullable().defaultTo('negative'); // negative | positive | all
    t.string('level', 10).notNullable().defaultTo('account'); // account | section
    t.string('target_section_code', 40);
    t.string('target_section_name', 200);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('reclassifications', (t) => {
    t.string('source', 12).notNullable().defaultTo('manual'); // manual | rule
    t.integer('rule_id').references('id').inTable('reclass_rules').onDelete('SET NULL');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('reclassifications', (t) => {
    t.dropColumn('source');
    t.dropColumn('rule_id');
  }).catch(() => {});
  await knex.schema.dropTableIfExists('reclass_rules');
  await knex.schema.alterTable('consolidation_members', (t) => {
    t.dropColumn('holding_pct');
    t.dropColumn('method');
  });
};
