'use strict';
const bcrypt = require('bcryptjs');

/*
 * זריעת נתוני בסיס: משתמש מנהל, חברות הקבוצה, ותקופת דוח לדוגמה.
 * ריצה חוזרת בטוחה — מדלגת על רשומות שכבר קיימות.
 */
exports.seed = async function seed(knex) {
  // --- משתמש מנהל ---
  const existingAdmin = await knex('users').where({ username: 'admin' }).first();
  if (!existingAdmin) {
    await knex('users').insert({
      username: 'admin',
      full_name: 'מנהל מערכת',
      password_hash: bcrypt.hashSync('Arkia2026!', 10),
      is_admin: true,
      is_active: true,
    });
  }

  // --- חברות הקבוצה ---
  const companies = [
    { name: 'ארקיע קווי תעופה', code: 'ARK', is_consolidated: false, sort_order: 1 },
    { name: 'ארקיע אינטרנשיונל', code: 'INT', is_consolidated: false, sort_order: 2 },
    { name: 'ארקיע קליק', code: 'CLK', is_consolidated: false, sort_order: 3 },
    { name: 'אחזקת מטוסים ושרותי תעופה', code: 'AMT', is_consolidated: false, sort_order: 4 },
    { name: 'קבוצת ארקיע - מאוחד', code: 'GRP', is_consolidated: true, sort_order: 9 },
  ];
  for (const c of companies) {
    const exists = await knex('companies').where({ name: c.name }).first();
    if (!exists) await knex('companies').insert(c);
  }

  // --- תקופת דוח לדוגמה ---
  const period = { fiscal_year: 2025, as_of_date: '2025-12-31', label: 'שנתי 2025' };
  const existsPeriod = await knex('periods')
    .where({ fiscal_year: period.fiscal_year, as_of_date: period.as_of_date }).first();
  if (!existsPeriod) await knex('periods').insert(period);
};
