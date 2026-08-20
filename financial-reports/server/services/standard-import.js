'use strict';
const ExcelJS = require('exceljs');
const { cellText, cellNum } = require('./xlsx-import');

/*
 * טוען מבנה סטנדרטי — קובץ הייצוא של המערכת הפיננסית:
 * עמודות קבועות: כותרת ראשית | כותרת משנה | סעיף | חשבון | תאור החשבון | חברה | יתרה
 * מפצל את השורות לפי החברה (עמודת "חברה").
 */

const HEADERS = {
  main_header: ['כותרת ראשית'],
  sub_header: ['כותרת משנה'],
  tb_section_code: ['סעיף'],
  account_no: ['חשבון'],
  account_name: ['תאור החשבון', 'תיאור החשבון', 'שם החשבון'],
  company: ['חברה'],
  amount: ['יתרה'],
};

function normalizeName(s) {
  return String(s || '')
    .replace(/בע["'`׳״מ]*מ/g, '')
    .replace(/בע"מ|בעמ/g, '')
    .replace(/ישראליים|ישראלים/g, '')
    .replace(/["'`׳״.\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// מציאת החברה במערכת לפי שם/כינוי (התאמה מנורמלת)
function matchCompany(rawName, companies) {
  const target = normalizeName(rawName);
  if (!target) return null;
  for (const c of companies) {
    const names = [c.name, ...String(c.aliases || '').split(/[\n,]/)].map(normalizeName).filter(Boolean);
    if (names.some((n) => n === target || n.includes(target) || target.includes(n))) return c;
  }
  return null;
}

// זיהוי שורת הכותרות ומיפוי העמודות
function detectColumns(ws) {
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    const row = ws.getRow(r);
    const texts = [];
    for (let c = 1; c <= Math.min(ws.columnCount, 20); c++) texts.push(cellText(row.getCell(c).value));
    const map = {};
    for (const [key, options] of Object.entries(HEADERS)) {
      const idx = texts.findIndex((t) => options.some((o) => t.includes(o)));
      if (idx >= 0) map[key] = idx + 1;
    }
    // צריך לפחות חשבון + יתרה + חברה כדי להחשיב את זה כשורת כותרות תקינה
    if (map.account_no && map.amount && map.company) return { headerRow: r, map };
  }
  return null;
}

async function parseStandard(buffer, companies) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  // בוחרים את הגליון הראשון שבו מזוהה מבנה סטנדרטי
  let ws = null; let det = null;
  wb.eachSheet((sheet) => { if (!det) { const d = detectColumns(sheet); if (d) { ws = sheet; det = d; } } });
  if (!det) throw new Error('לא זוהה מבנה סטנדרטי (נדרשות עמודות: חשבון, חברה, יתרה)');

  const { headerRow, map } = det;
  const groups = new Map(); // companyName -> rows[]
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const account_no = cellText(row.getCell(map.account_no).value).trim();
    const amount = cellNum(row.getCell(map.amount).value);
    if (!account_no && !amount) continue;
    const company = cellText(row.getCell(map.company).value).trim() || '(ללא חברה)';
    const rec = {
      main_header: map.main_header ? cellText(row.getCell(map.main_header).value) : null,
      sub_header: map.sub_header ? cellText(row.getCell(map.sub_header).value) : null,
      tb_section_code: map.tb_section_code ? cellText(row.getCell(map.tb_section_code).value) : null,
      account_no,
      account_name: map.account_name ? cellText(row.getCell(map.account_name).value) : null,
      amount,
      prior_amount: 0,
    };
    if (!groups.has(company)) groups.set(company, []);
    groups.get(company).push(rec);
  }

  const result = [];
  for (const [name, rows] of groups.entries()) {
    const matched = matchCompany(name, companies);
    result.push({ fileCompany: name, count: rows.length, matchedCompanyId: matched ? matched.id : null, matchedCompanyName: matched ? matched.name : null, rows });
  }
  return { sheetName: ws.name, groups: result };
}

module.exports = { parseStandard, matchCompany, normalizeName };
