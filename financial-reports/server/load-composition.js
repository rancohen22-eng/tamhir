'use strict';
/*
 * טעינת "ההרכבה" (קובץ V2, 47 גליונות) למערכת:
 *   מאזן בוחן (per חברה) + פקודות נוספות (4 גליונות) + מיונים → גרסאות + מבנה + מאוחד.
 *
 * שימוש:  node server/load-composition.js <path-to-V2.xlsx> [as_of_date]
 * ברירת מחדל לתאריך: 2025-12-31.
 */
const path = require('path');
const ExcelJS = require('exceljs');
const knex = require('./db');
const { cellText, cellNum } = require('./services/xlsx-import');
const { matchCompany } = require('./services/standard-import');
const { buildFromVersion } = require('./services/build-structure');
const { seedCashflow } = require('./services/seed-cashflow');

const FILE = process.argv[2];
const AS_OF = process.argv[3] || '2025-12-31';
const FYEAR = Number(AS_OF.slice(0, 4));

if (!FILE) { console.error('שימוש: node server/load-composition.js <path-to-V2.xlsx> [YYYY-MM-DD]'); process.exit(1); }

const TB_SHEET = 'מאזן בוחן-פ';
const ADJ_SHEETS = {
  'פקודות נוספות- ארקיע': 'ארקיע קווי תעופה',
  'פקודות נוספות- אינטרנשיונל': 'ארקיע אינטרנשיונל',
  'פקודות נוספות- א.מ': 'אחזקת מטוסים ושרותי תעופה',
  'פקודות נוספות- קליק': 'ארקיע קליק',
};
const RECLASS_SHEET = 'מיונים שמוליק 2023';
const RECLASS_COMPANY = 'ארקיע קווי תעופה';

// קריאה זורמת — אוספת רק את הגליונות הדרושים למערכי שורות
async function readSheets(file, names) {
  const want = new Set(names);
  const out = {};
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, { worksheets: 'emit', sharedStrings: 'cache', entries: 'emit' });
  for await (const ws of reader) {
    if (!want.has(ws.name)) { for await (const _ of ws) { /* drain */ } continue; } // eslint-disable-line no-unused-vars
    const rows = [];
    for await (const row of ws) rows.push(row.values); // 1-indexed array (index 0 ריק)
    out[ws.name] = rows;
  }
  return out;
}

// זיהוי עמודות מאזן בוחן לפי שורת כותרות
function detectTbColumns(rows) {
  const want = { main_header: ['כותרת ראשית'], sub_header: ['כותרת משנה'], tb_section_code: ['סעיף'],
    account_no: ['חשבון'], account_name: ['תאור החשבון', 'תיאור החשבון'], company: ['חברה'], amount: ['יתרה'] };
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const arr = Array.from(rows[r] || [], (v) => cellText(v));
    const map = {};
    for (const [k, opts] of Object.entries(want)) {
      const idx = arr.findIndex((t) => opts.some((o) => t.includes(o)));
      if (idx >= 0) map[k] = idx;
    }
    if (map.account_no != null && map.amount != null && map.company != null) return { headerRow: r, map };
  }
  return null;
}

async function main() {
  console.log(`טוען הרכבה מ: ${path.basename(FILE)}  (ליום ${AS_OF})\n`);
  const sheets = await readSheets(FILE, [TB_SHEET, RECLASS_SHEET, ...Object.keys(ADJ_SHEETS)]);

  const companies = await knex('companies');
  const period = await knex('periods').where({ as_of_date: AS_OF }).first()
    || (await knex('periods').where({ id: (await knex('periods').insert({ fiscal_year: FYEAR, as_of_date: AS_OF, label: `שנתי ${FYEAR}` }))[0] }).first());

  // ---------- ניקוי טעינה קודמת (רק גרסאות "הרכבה" לתקופה זו) ----------
  const oldVers = await knex('report_versions').where({ period_id: period.id, name: 'הרכבה' });
  for (const v of oldVers) {
    await knex('trial_balance_rows').where({ version_id: v.id }).del();
    await knex('adjustments').where({ version_id: v.id }).del();
    await knex('reclassifications').where({ version_id: v.id }).del();
    await knex('consolidation_members').where({ consolidated_version_id: v.id }).orWhere({ member_version_id: v.id }).del();
    await knex('cashflow_values').where({ version_id: v.id }).del();
    await knex('report_versions').where({ id: v.id }).del();
  }

  // ---------- מאזן בוחן → פיצול לחברות ----------
  const tbRows = sheets[TB_SHEET] || [];
  const det = detectTbColumns(tbRows);
  if (!det) throw new Error(`לא זוהו עמודות בגליון ${TB_SHEET}`);
  const M = det.map;
  const groups = new Map(); // companyId -> rows[]
  const acctSection = new Map(); // companyId -> Map(account -> section)
  for (let r = det.headerRow + 1; r < tbRows.length; r++) {
    const arr = tbRows[r] || [];
    const account_no = cellText(arr[M.account_no]).trim();
    const amount = cellNum(arr[M.amount]);
    if (!account_no && !amount) continue;
    const compName = cellText(arr[M.company]).trim();
    const comp = matchCompany(compName, companies);
    if (!comp) continue;
    const section = M.tb_section_code != null ? cellText(arr[M.tb_section_code]).trim() : '';
    const rec = {
      account_no: account_no || null,
      account_name: M.account_name != null ? cellText(arr[M.account_name]) : null,
      tb_section_code: section || null,
      main_header: M.main_header != null ? cellText(arr[M.main_header]) : null,
      sub_header: M.sub_header != null ? cellText(arr[M.sub_header]) : null,
      amount, prior_amount: 0,
    };
    if (!groups.has(comp.id)) { groups.set(comp.id, []); acctSection.set(comp.id, new Map()); }
    groups.get(comp.id).push(rec);
    if (account_no && section) acctSection.get(comp.id).set(account_no, { code: section, name: rec.sub_header });
  }

  const versionByCompany = new Map();
  for (const [companyId, rows] of groups.entries()) {
    await knex('fs_lines').where({ company_id: companyId }).del();
    await knex('index_map').where({ company_id: companyId }).del();
    const [vid] = await knex('report_versions').insert({ company_id: companyId, period_id: period.id, name: 'הרכבה', status: 'final' });
    for (let i = 0; i < rows.length; i += 500) await knex('trial_balance_rows').insert(rows.slice(i, i + 500).map((x) => ({ ...x, version_id: vid })));
    const version = await knex('report_versions').where({ id: vid }).first();
    const st = await buildFromVersion(version, {});
    versionByCompany.set(companyId, vid);
    const cname = companies.find((c) => c.id === companyId).name;
    console.log(`  ✓ מאזן בוחן: ${cname} — ${rows.length} שורות, מבנה ${st.lines} שורות, מופו ${st.mapped}/${st.sections}`);
  }

  // ---------- פקודות נוספות ----------
  for (const [sheetName, compName] of Object.entries(ADJ_SHEETS)) {
    const rows = sheets[sheetName];
    if (!rows) continue;
    const comp = matchCompany(compName, companies);
    const vid = comp && versionByCompany.get(comp.id);
    if (!vid) { console.log(`  — דילוג פקודות ${sheetName} (אין גרסה)`); continue; }
    const secMap = acctSection.get(comp.id) || new Map();
    // עמודות: entry_no=1 card=2 name=3 section=4 secname=5 purpose=6 amount=7 (1-indexed)
    let count = 0; const batch = [];
    for (const arr of rows) {
      if (!arr) continue;
      const amount = cellNum(arr[7]);
      const card = cellText(arr[2]).trim();
      if (!card || !amount) continue;
      if (cellText(arr[3]).includes('כרטיס')) continue; // שורת כותרת
      let section = cellText(arr[4]).trim();
      let secName = cellText(arr[5]).trim();
      if (!section || section === '#N/A') { const s = secMap.get(card); if (s) { section = s.code; secName = s.name; } else { section = '999.התאמות לא מסווגות'; secName = 'התאמות לא מסווגות'; } }
      batch.push({ version_id: vid, entry_no: cellNum(arr[1]) || null, account_no: card,
        account_name: cellText(arr[3]) || null, tb_section_code: section || null, tb_section_name: secName || null,
        purpose: cellText(arr[6]) || null, amount });
      count++;
    }
    for (let i = 0; i < batch.length; i += 500) await knex('adjustments').insert(batch.slice(i, i + 500));
    // פקודת איזון: פקודות יומן חייבות להסתכם ל-0. אם הפענוח השמיט צד — משלימים plug.
    const sum = batch.reduce((s, b) => s + b.amount, 0);
    if (Math.abs(sum) > 1) {
      await knex('adjustments').insert({ version_id: vid, account_no: null, account_name: 'הפרש איזון פקודות (בדוק בהרכבה)',
        tb_section_code: '998.הפרשי איזון פקודות', tb_section_name: 'הפרשי איזון פקודות', purpose: 'איזון אוטומטי', amount: -sum });
      console.log(`  ✓ פקודות נוספות: ${compName} — ${count} פקודות (+ פקודת איזון ${Math.round(-sum).toLocaleString()})`);
    } else { console.log(`  ✓ פקודות נוספות: ${compName} — ${count} פקודות`); }
  }

  // ---------- מיונים ----------
  const rc = sheets[RECLASS_SHEET];
  if (rc) {
    const comp = matchCompany(RECLASS_COMPANY, companies);
    const vid = comp && versionByCompany.get(comp.id);
    const secMap = acctSection.get(comp && comp.id) || new Map();
    const targetAcct = cellText((rc[0] || [])[2]).trim(); // "חשבון לטעינה" בשורה 1 עמ' 2
    const targetSec = secMap.get(targetAcct);
    if (vid && targetSec) {
      let count = 0; const batch = [];
      for (const arr of rc) {
        if (!arr) continue;
        const acct = cellText(arr[1]).trim();
        const amount = cellNum(arr[3]);
        if (!acct || !amount) continue;
        if (acct.includes('סכום') || acct.includes('חשבון')) continue;
        const src = secMap.get(acct);
        if (!src) continue;
        batch.push({ version_id: vid, account_no: acct, account_name: cellText(arr[2]) || null,
          from_section: src.code, to_section: targetSec.code, note: 'מיון מההרכבה', amount });
        count++;
      }
      for (let i = 0; i < batch.length; i += 500) await knex('reclassifications').insert(batch.slice(i, i + 500));
      console.log(`  ✓ מיונים: ${RECLASS_COMPANY} — ${count} מיונים (יעד סעיף ${targetSec.code})`);
    } else { console.log('  — דילוג מיונים (חשבון יעד לא נמצא במאזן)'); }
  }

  // ---------- מאוחד ----------
  const grp = companies.find((c) => c.is_consolidated);
  if (grp) {
    await knex('fs_lines').where({ company_id: grp.id }).del();
    await knex('index_map').where({ company_id: grp.id }).del();
    const [cvid] = await knex('report_versions').insert({ company_id: grp.id, period_id: period.id, name: 'הרכבה', status: 'final' });
    for (const vid of versionByCompany.values()) await knex('consolidation_members').insert({ consolidated_version_id: cvid, member_version_id: vid, holding_pct: 100, method: 'full' });
    const cversion = await knex('report_versions').where({ id: cvid }).first();
    const cst = await buildFromVersion(cversion, { sourceVersionIds: [...versionByCompany.values()] });
    await seedCashflow(grp.id).catch(() => {});
    console.log(`  ✓ מאוחד: ${versionByCompany.size} בנות, מבנה ${cst.lines} שורות, ${cst.mapped}/${cst.sections} סעיפים`);
  }

  // ---------- מעבר מיפוי סופי: כל סעיף שמופיע בחישוב (כולל פקודות/מיונים) ----------
  const { computeSectionTotals } = require('./services/report-engine');
  const { ensureSectionMapped, parsePrefixed } = require('./services/build-structure');
  const mapAll = async (version) => {
    const sections = await computeSectionTotals(version);
    for (const s of Object.values(sections)) {
      const n = parsePrefixed(s.mainHeader).num;
      await ensureSectionMapped(version.company_id, s.code, s.name, (n != null && n <= 3) ? 'balance' : 'pnl');
    }
  };
  for (const vid of versionByCompany.values()) await mapAll(await knex('report_versions').where({ id: vid }).first());
  const consVer = await knex('report_versions').where({ company_id: grp.id, name: 'הרכבה' }).orderBy('id', 'desc').first();
  if (consVer) await mapAll(consVer);

  // זריעת תזרים לכל חברה
  for (const companyId of versionByCompany.keys()) await seedCashflow(companyId).catch(() => {});

  console.log('\n✓ הטעינה הושלמה. הפעל "npm start" וראה את הנתונים.');
}

main().then(() => knex.destroy()).catch((e) => { console.error('שגיאה:', e); knex.destroy(); process.exit(1); });
