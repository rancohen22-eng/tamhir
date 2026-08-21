'use strict';
// תיוג מקור פקודות נוספות (ידני / מיוצר ממודול), לצורך ייצור אידמפוטנטי.
exports.up = async function up(knex) {
  await knex.schema.alterTable('adjustments', (t) => {
    t.string('source', 20).defaultTo('manual'); // manual | ifrs16 | ...
    t.string('source_ref', 40); // מזהה מקור (למשל agreement id / 'ifrs16')
  });
};
exports.down = async function down(knex) {
  await knex.schema.alterTable('adjustments', (t) => { t.dropColumn('source'); t.dropColumn('source_ref'); });
};
