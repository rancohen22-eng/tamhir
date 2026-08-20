'use strict';
const ExcelJS = require('exceljs');

// המרת ערך תא לטקסט נקי
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v);
}

function cellNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'object' && v.result != null) v = v.result;
  const n = Number(String(v).replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

async function loadWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

// תצוגה מקדימה: שמות גליונות + מספר שורות דוגמה מכל גליון
async function previewWorkbook(buffer, sampleRows = 8, maxCols = 30) {
  const wb = await loadWorkbook(buffer);
  const sheets = [];
  wb.eachSheet((ws) => {
    const rows = [];
    const rowCount = Math.min(ws.rowCount, sampleRows);
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const cells = [];
      const colCount = Math.min(ws.columnCount, maxCols);
      for (let c = 1; c <= colCount; c++) cells.push(cellText(row.getCell(c).value));
      rows.push(cells);
    }
    sheets.push({ name: ws.name, rowCount: ws.rowCount, colCount: Math.min(ws.columnCount, maxCols), sample: rows });
  });
  return { sheets };
}

/*
 * חילוץ שורות מאזן בוחן לפי מיפוי.
 * opts = {
 *   sheetName, headerRow (1-based, שורת הכותרות), dataStartRow,
 *   map: { account_no, account_name, tb_section_code, tb_section_name,
 *          main_header, sub_header, amount, prior_amount }  // ערכי index עמודה 1-based
 * }
 * מחזיר מערך אובייקטים מוכנים להכנסה (ללא version_id).
 */
async function extractTrialBalance(buffer, opts) {
  const wb = await loadWorkbook(buffer);
  const ws = wb.getWorksheet(opts.sheetName);
  if (!ws) throw new Error('גליון לא נמצא: ' + opts.sheetName);
  const map = opts.map || {};
  const start = opts.dataStartRow || (opts.headerRow ? opts.headerRow + 1 : 2);
  const get = (row, key) => (map[key] ? cellText(row.getCell(map[key]).value) : '');
  const getN = (row, key) => (map[key] ? cellNum(row.getCell(map[key]).value) : 0);

  const out = [];
  for (let r = start; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const account_no = get(row, 'account_no').trim();
    const amount = getN(row, 'amount');
    // דילוג על שורות ריקות
    if (!account_no && !amount) continue;
    out.push({
      account_no: account_no || null,
      account_name: get(row, 'account_name') || null,
      tb_section_code: get(row, 'tb_section_code') || null,
      tb_section_name: get(row, 'tb_section_name') || null,
      main_header: get(row, 'main_header') || null,
      sub_header: get(row, 'sub_header') || null,
      amount,
      prior_amount: getN(row, 'prior_amount'),
    });
  }
  return out;
}

module.exports = { previewWorkbook, extractTrialBalance, cellText, cellNum };
