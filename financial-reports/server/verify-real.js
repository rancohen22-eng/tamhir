'use strict';
/* אימות מול קובץ העבודה האמיתי: ייבוא מאזן בוחן -> בניית מבנה+אינדקס -> חישוב דוח. */
const fs = require('fs');
const knex = require('./db');
const { extractTrialBalance } = require('./services/xlsx-import');
const { buildFromVersion } = require('./services/build-structure');
const { computeReport } = require('./services/report-engine');

const FILE = '/root/.claude/uploads/de62a35c-c66a-526c-921b-eb895f278ed0/31ec3d9f-___________V2_31.12.2025_18.5.2026.xlsx';

(async () => {
  try {
    const buf = fs.readFileSync(FILE);
    // מיפוי עמודות אמיתי מגליון 'מאזן בוחן-פ' (שורת כותרות 3, נתונים מ-4)
    const rows = await extractTrialBalance(buf, {
      sheetName: 'מאזן בוחן-פ', headerRow: 3, dataStartRow: 4,
      map: { main_header: 5, sub_header: 6, tb_section_code: 7, account_no: 8, account_name: 9, amount: 11 },
    });
    console.log('שורות מאזן בוחן שחולצו:', rows.length);

    const company = await knex('companies').first();
    const period = await knex('periods').first();
    const [versionId] = await knex('report_versions').insert({
      company_id: company.id, period_id: period.id, name: 'אימות נתונים אמיתיים', status: 'draft',
    });
    const version = await knex('report_versions').where({ id: versionId }).first();

    // ניקוי מבנה קודם לחברה (למקרה של הרצה חוזרת)
    await knex('index_map').where({ company_id: company.id }).del();
    await knex('fs_lines').where({ company_id: company.id }).del();

    for (let i = 0; i < rows.length; i += 500) {
      await knex('trial_balance_rows').insert(rows.slice(i, i + 500).map((r) => ({ ...r, version_id: versionId })));
    }

    const built = await buildFromVersion(version, {});
    console.log('בנייה אוטומטית:', built);

    const report = await computeReport(version);
    console.log('שורות מאזן:', report.balance.length, '| שורות רו"ה:', report.pnl.length);
    console.log('סעיפים לא ממופים:', report.unmapped.length);

    // בדיקת התלכדות: סכום שורות ה-line במאזן = סכום יתרות הנכסים/התח'/הון
    const balTotal = report.balance.filter((l) => l.kind === 'line').reduce((s, l) => s + Number(l.amount || 0), 0);
    const pnlTotal = report.pnl.filter((l) => l.kind === 'line').reduce((s, l) => s + Number(l.amount || 0), 0);
    const tbTotal = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    console.log('סכום כל המאזן בוחן:', tbTotal.toFixed(2));
    console.log('סכום שורות דוח (מאזן+רו"ה):', (balTotal + pnlTotal).toFixed(2));

    // הצגת מדגם שורות מאזן עם ערכים
    console.log('\nמדגם שורות מאזן:');
    report.balance.filter((l) => l.kind === 'line').slice(0, 8).forEach((l) => console.log(`  ${l.label}: ${Math.round(l.amount).toLocaleString()}`));

    const ok = report.unmapped.length === 0 && report.balance.length > 0 && Math.abs((balTotal + pnlTotal) - tbTotal) < 1;
    console.log(ok ? '\n✓ אימות עבר: כל הסעיפים מופו וסכומי הדוח מתלכדים עם המאזן.' : '\n✗ יש פערים — ראה לעיל.');
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    console.error('שגיאה:', e);
    process.exitCode = 1;
  } finally {
    await knex.destroy();
  }
})();
