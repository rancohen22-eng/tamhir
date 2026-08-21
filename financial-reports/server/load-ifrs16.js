'use strict';
/*
 * טעינת הסכמי IFRS 16 מגליון "IFRS 16-2025" בקובץ ההרכבה (V3) לחברת ארקיע קווי תעופה.
 * שימוש: node server/load-ifrs16.js <path-to-V3.xlsx>
 */
const ExcelJS = require('exceljs');
const knex = require('./db');
const { cellNum, cellText } = require('./services/xlsx-import');

const FILE = process.argv[2];
if (!FILE) { console.error('שימוש: node server/load-ifrs16.js <path-to-V3.xlsx>'); process.exit(1); }
const SHEET = 'IFRS 16-2025';
const COMPANY = 'ארקיע קווי תעופה';

async function readSheet(file, name) {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, { worksheets: 'emit', sharedStrings: 'cache', entries: 'emit' });
  let rows = null;
  for await (const ws of reader) {
    if (ws.name === name) { rows = []; for await (const row of ws) rows.push(row.values); }
    else { for await (const _ of ws) { /* drain */ } } // eslint-disable-line no-unused-vars
  }
  return rows || [];
}

(async () => {
  try {
    const rows = await readSheet(FILE, SHEET);
    const comp = await knex('companies').where({ name: COMPANY }).first();
    const version = await knex('report_versions').where({ company_id: comp.id, name: 'הרכבה' }).orderBy('id', 'desc').first();
    if (!version) throw new Error('אין גרסת "הרכבה" לארקיע — הרץ קודם load-composition.js');

    await knex('ifrs16_movements').where({ version_id: version.id }).del();
    await knex('ifrs16_agreements').where({ company_id: comp.id }).del();

    // איתור שורת הכותרת (מכילה "התחייבות י.פ"), וקריאת בלוק ההסכמים עד שורת הסה"כ
    let headerIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const line = Array.from(rows[i] || [], (v) => cellText(v)).join('|');
      if (line.includes('התחייבות י.פ')) { headerIdx = i; break; }
    }
    if (headerIdx < 0) throw new Error('לא נמצאה שורת כותרת IFRS16');

    let count = 0; let started = false;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const arr = rows[i]; if (!arr) { if (started) break; continue; }
      const name = cellText(arr[2]).trim();
      const liabOpen = cellNum(arr[3]); const assetOpen = cellNum(arr[12]);
      // סוף הבלוק: שורה ללא שם-הסכם (טקסט) — שורת הסה"כ/בקרה
      if (!name || /^[\d,.\-]+$/.test(name) || /התחייבות|סה"כ|בקרת|הפרש|הרכב/.test(name)) { if (started) break; else continue; }
      if (liabOpen === 0 && assetOpen === 0 && cellNum(arr[4]) === 0 && cellNum(arr[13]) === 0) continue;
      started = true;
      const [agId] = await knex('ifrs16_agreements').insert({ company_id: comp.id, name, currency: 'USD' });
      await knex('ifrs16_movements').insert({
        agreement_id: agId, version_id: version.id,
        liab_open: liabOpen, liab_add: cellNum(arr[4]), liab_disposal: cellNum(arr[5]),
        liab_payment: cellNum(arr[6]), liab_interest: cellNum(arr[7]), liab_fx: cellNum(arr[8]),
        asset_open: assetOpen, asset_add: cellNum(arr[13]), asset_disposal: cellNum(arr[14]),
        asset_depreciation: cellNum(arr[15]),
        current_portion: 0,
      });
      count++;
    }
    console.log(`✓ נטענו ${count} הסכמי IFRS 16 לחברת ${COMPANY}`);

    const { computeIFRS16 } = require('./services/ifrs16');
    const s = (await computeIFRS16(version)).summary;
    const K = (x) => Math.round(x).toLocaleString();
    console.log(`  נכס זכות שימוש (סגירה): ${K(s.asset_closing)}  (מצופה 78,408,743)`);
    console.log(`  התחייבות חכירה (סגירה): ${K(s.liab_closing)}  (מצופה 102,395,908)`);
    console.log(`  פחת: ${K(s.depreciation)}  (מצופה 10,171,323) · הוצ' מימון: ${K(s.interest)}  (מצופה 5,685,212)`);
  } catch (e) { console.error('שגיאה:', e); process.exitCode = 1; }
  finally { await knex.destroy(); }
})();
