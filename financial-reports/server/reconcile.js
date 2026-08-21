'use strict';
/*
 * בדיקת התאמה: משווה את המאזן המאוחד המחושב (באלפי דולר) מול גליון "דוחות כספיים"
 * בקובץ ההרכבה (V2). שימוש: node server/reconcile.js <path-to-V2.xlsx>
 */
const ExcelJS = require('exceljs');
const knex = require('./db');
const { cellText, cellNum } = require('./services/xlsx-import');
const { computeReport } = require('./services/report-engine');
const { parsePrefixed } = require('./services/build-structure');

const FILE = process.argv[2];
if (!FILE) { console.error('שימוש: node server/reconcile.js <path-to-V2.xlsx>'); process.exit(1); }
const TARGET_SHEET = 'דוחות כספיים  ';
const K = (v) => Math.round((Number(v) || 0) / 1000); // דולר → אלפי דולר

async function readTarget(file) {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, { worksheets: 'emit', sharedStrings: 'cache', entries: 'emit' });
  let rows = null;
  for await (const ws of reader) {
    if (ws.name === TARGET_SHEET) { rows = []; for await (const row of ws) rows.push(row.values); }
    else { for await (const _ of ws) { /* drain */ } } // eslint-disable-line no-unused-vars
  }
  return rows || [];
}
function findTarget(rows, keyword, exclude) {
  for (const arr of rows) {
    if (!arr) continue;
    const label = cellText(arr[2]);
    if (label && label.includes(keyword) && !(exclude && label.includes(exclude))) return cellNum(arr[4]); // עמ' 4 = 2025
  }
  return null;
}

async function main() {
  const grp = await knex('companies').where({ is_consolidated: true }).first();
  const cv = await knex('report_versions').where({ company_id: grp.id, name: 'הרכבה' }).orderBy('id', 'desc').first();
  if (!cv) throw new Error('לא נמצאה גרסת מאוחד "הרכבה". הרץ קודם load-composition.js');
  const rep = await computeReport(cv);

  // סכומי המערכת לפי כותרת ראשית (1=נכסים, 2=התחייבויות, 3=הון)
  const byMain = { assets: 0, liab: 0, equity: 0, pnl: 0 };
  const lineMain = {}; // fs_line id -> main num (דרך שרשור הורים)
  const byId = {}; [...rep.balance, ...rep.pnl].forEach((l) => { byId[l.id] = l; });
  const rootLabel = (l) => { let cur = l; while (cur && cur.parent_id && byId[cur.parent_id]) cur = byId[cur.parent_id]; return cur ? cur.label : ''; };
  rep.balance.filter((l) => l.kind === 'line').forEach((l) => {
    const root = rootLabel(l);
    if (/נכס/.test(root)) byMain.assets += l.amount;
    else if (/התחייב/.test(root)) byMain.liab += l.amount;
    else if (/הון/.test(root)) byMain.equity += l.amount;
  });
  rep.pnl.filter((l) => l.kind === 'line').forEach((l) => { byMain.pnl += l.amount; });

  const targetRows = await readTarget(FILE);
  const tAssets = findTarget(targetRows, 'סה"כ נכסים', 'שוטפים');
  const tLiabEquity = findTarget(targetRows, 'סה"כ התחייבויות והון');
  const tEquity = findTarget(targetRows, 'סה"כ הון עצמי');

  const line = (label, sys, tgt) => {
    const s = K(sys); const t = tgt == null ? null : Math.round(tgt);
    const d = t == null ? '' : (s - t);
    const ok = t == null ? '' : (Math.abs(s - t) <= Math.max(50, Math.abs(t) * 0.02) ? '✓' : '✗');
    console.log(`  ${label.padEnd(28)} | מחושב: ${String(s).padStart(12)} | יעד: ${String(t ?? '—').padStart(12)} | הפרש: ${String(d).padStart(10)} ${ok}`);
  };

  console.log('\n=== בדיקת התאמה — מאוחד (אלפי דולר) ===\n');
  line('סה"כ נכסים', Math.abs(byMain.assets), tAssets);
  line('סה"כ התחייבויות + הון', Math.abs(byMain.liab) + Math.abs(byMain.equity), tLiabEquity);
  line('סה"כ הון עצמי', -byMain.equity, tEquity);
  console.log(`\n  רווח (הפסד) נקי מחושב: ${K(-byMain.pnl).toLocaleString()} אלפי דולר`);

  // בדיקת מאזן פנימית: המאזן בוחן מאוזן (סכום=0)
  const allBal = rep.balance.filter((l) => l.kind === 'line').reduce((s, l) => s + l.amount, 0);
  const allPnl = rep.pnl.filter((l) => l.kind === 'line').reduce((s, l) => s + l.amount, 0);
  console.log(`\n  בדיקת איזון (סכום כל הסעיפים, אמור ≈0): ${K(allBal + allPnl).toLocaleString()} אלפי דולר`);
  console.log(`  סעיפים לא ממופים: ${rep.unmapped.length}`);

  console.log('\n  הערה: פערים מול היעד נובעים ממודולים שטרם נבנו (IFRS16, הלוואות,');
  console.log('  שיטת האקוויטי) שמשפיעים על המאוחד הסופי — ייסגרו עם בניית המודולים.');
}

main().then(() => knex.destroy()).catch((e) => { console.error('שגיאה:', e); knex.destroy(); process.exit(1); });
