'use strict';
const knex = require('../db');

// האם תקופה היא סגירה שנתית (31/12)
function isAnnualClose(asOf) {
  const s = String(asOf || '').slice(0, 10);
  return /-12-31$/.test(s);
}

/*
 * פתרון גרסת הפתיחה/השוואה עבור גרסה:
 *  1. אם הוגדר prior_version_id ידני — הוא גובר.
 *  2. אחרת: הגרסה הסופית (status='final') האחרונה של אותה חברה, שתקופתה סגירה שנתית
 *     (31/12) לפני תאריך תקופת הדוח הנוכחי. דוגמה: Q2 2026 → סופי שנתי 31/12/2025.
 *  3. נפילה חלופית: אותה בחירה גם ללא status=final (הכי מאוחר שקיים).
 * מחזיר את רשומת הגרסה או null.
 */
async function resolveOpeningVersion(version) {
  if (version.prior_version_id) {
    return knex('report_versions').where({ id: version.prior_version_id }).first();
  }
  const period = await knex('periods').where({ id: version.period_id }).first();
  if (!period) return null;

  const candidates = await knex('report_versions as v')
    .join('periods as p', 'p.id', 'v.period_id')
    .where('v.company_id', version.company_id)
    .andWhere('p.as_of_date', '<', period.as_of_date)
    .select('v.*', 'p.as_of_date as as_of_date')
    .orderBy('p.as_of_date', 'desc');

  const annual = candidates.filter((c) => isAnnualClose(c.as_of_date));
  const finalAnnual = annual.find((c) => c.status === 'final');
  return finalAnnual || annual[0] || null;
}

module.exports = { resolveOpeningVersion, isAnnualClose };
