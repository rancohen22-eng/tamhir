'use strict';
/* אימות דוחות ראשיים: תזרים (עם בקרה) ושינויים בהון, מול גרסת פתיחה שנתית. */
const fs = require('fs');
const knex = require('./db');
const { extractTrialBalance } = require('./services/xlsx-import');
const { buildFromVersion } = require('./services/build-structure');
const { computeReport } = require('./services/report-engine');
const { seedCashflow } = require('./services/seed-cashflow');
const { computeCashflow } = require('./services/cashflow-engine');
const { computeEquity } = require('./services/equity-engine');
const { resolveOpeningVersion } = require('./services/comparative');

const FILE = '/root/.claude/uploads/de62a35c-c66a-526c-921b-eb895f278ed0/738a6627-_____2.xlsx';

async function loadInto(companyId, periodId, name, status, rows) {
  const [vid] = await knex('report_versions').insert({ company_id: companyId, period_id: periodId, name, status });
  for (let i = 0; i < rows.length; i += 500) await knex('trial_balance_rows').insert(rows.slice(i, i + 500).map((r) => ({ ...r, version_id: vid })));
  const version = await knex('report_versions').where({ id: vid }).first();
  await buildFromVersion(version, {});
  return version;
}

(async () => {
  try {
    const companies = await knex('companies');
    const { parseStandard } = require('./services/standard-import');
    const { groups } = await parseStandard(fs.readFileSync(FILE), companies);
    // ניקח את החברה הגדולה (ארקיע קווי תעופה)
    const g = groups.find((x) => x.matchedCompanyName && x.matchedCompanyName.includes('קווי תעופה'));
    const companyId = g.matchedCompanyId;
    await knex('fs_lines').where({ company_id: companyId }).del();
    await knex('index_map').where({ company_id: companyId }).del();

    // תקופות
    const p2025 = await knex('periods').where({ as_of_date: '2025-12-31' }).first();
    const [p2026id] = await knex('periods').insert({ fiscal_year: 2026, as_of_date: '2026-06-30', label: 'רבעון 2 2026' });

    // גרסת פתיחה שנתית סופית 2025 + גרסה שוטפת 2026 (אותם נתונים)
    const opening = await loadInto(companyId, p2025.id, 'שנתי 2025 סופי', 'final', g.rows);
    const current = await loadInto(companyId, p2026id, 'Q2 2026', 'draft', g.rows);

    // פתרון גרסת פתיחה אוטומטי
    const resolved = await resolveOpeningVersion(current);
    console.log('גרסת פתיחה שנפתרה אוטומטית:', resolved ? resolved.name : 'none', '(מצופה: שנתי 2025 סופי)');

    // זריעת מבנה תזרים
    const seed = await seedCashflow(companyId);
    console.log('זריעת תזרים:', seed);

    // כדי לאמת את הבקרה: מוסיפים לסעיף המזומנים תנועה בגובה הרווח הנקי
    const cur = await computeReport(current);
    const netProfit = -cur.pnl.filter((l) => l.kind === 'line').reduce((s, l) => s + (Number(l.amount) || 0), 0);
    console.log('רווח נקי מחושב:', Math.round(netProfit).toLocaleString());
    // מציאת סעיף מזומנים (sub_header כולל "מזומנים ושווי מזומנים", לא מוגבל)
    const cashRow = await knex('trial_balance_rows').where({ version_id: current.id })
      .whereNotNull('tb_section_code').andWhere('sub_header', 'like', '%מזומנים ושווי מזומנים%')
      .andWhereNot('sub_header', 'like', '%מוגבל%').first();
    await knex('adjustments').insert({ version_id: current.id, tb_section_code: cashRow.tb_section_code, purpose: 'סימולציית תנועת מזומנים לאימות בקרה', amount: netProfit });

    const cf = await computeCashflow(current);
    console.log(`\nתזרים: שוטפת=${Math.round(cf.subtotals.operating).toLocaleString()} השקעה=${Math.round(cf.subtotals.investing).toLocaleString()} מימון=${Math.round(cf.subtotals.financing).toLocaleString()}`);
    console.log(`שינוי במזומנים=${Math.round(cf.subtotals.netChange).toLocaleString()}`);
    console.log(`בקרה: פתיחה=${Math.round(cf.control.openingCash).toLocaleString()} סגירה בפועל=${Math.round(cf.control.closingCashActual).toLocaleString()} סגירה מחושבת=${Math.round(cf.control.closingCashComputed).toLocaleString()} הפרש=${cf.control.diff.toFixed(2)} → ${cf.control.ok ? 'תקין ✓' : 'פער ✗'}`);

    const eq = await computeEquity(current);
    console.log(`\nשינויים בהון: ${eq.columns.length} עמודות רכיבי הון. סה"כ הון סגירה=${Math.round(eq.closing.values.total).toLocaleString()}`);

    // ייצוא Word מלא (4 דוחות)
    const { buildReportDocx } = require('./services/docx-export');
    const company = await knex('companies').where({ id: companyId }).first();
    const period = await knex('periods').where({ id: p2026id }).first();
    const buf = await buildReportDocx({ report: cur, cashflow: cf, equity: eq, company, period, version: current });
    const wordOk = Buffer.isBuffer(buf) && buf.length > 3000 && buf.slice(0, 2).toString() === 'PK';
    console.log(`ייצוא Word (4 דוחות): ${buf.length} bytes ${wordOk ? '✓' : '✗'}`);

    const ok = cf.control.ok && cf.sections.length === 7 && eq.columns.length > 0 && wordOk;
    console.log(ok ? '\n✓ אימות דוחות ראשיים עבר (בקרת תזרים מתלכדת).' : '\n✗ יש פער.');
    process.exitCode = ok ? 0 : 1;
  } catch (e) { console.error('שגיאה:', e); process.exitCode = 1; }
  finally { await knex.destroy(); }
})();
