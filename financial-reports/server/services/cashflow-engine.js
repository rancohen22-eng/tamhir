'use strict';
const knex = require('../db');
const { computeReport } = require('./report-engine');
const { resolveOpeningVersion } = require('./comparative');

const SECTIONS = [
  { key: 'operating_adj', label: 'התאמות הדרושות להצגת תזרימי המזומנים מפעילות שוטפת' },
  { key: 'operating_wc', label: 'שינויים בסעיפי נכסים והתחייבויות' },
  { key: 'operating_cash', label: 'מזומנים ששולמו והתקבלו במהלך השנה' },
  { key: 'investing', label: 'תזרימי מזומנים מפעילות השקעה' },
  { key: 'financing', label: 'תזרימי מזומנים מפעילות מימון' },
  { key: 'fx', label: 'הפרשי שער בגין יתרות מזומנים ושווי מזומנים' },
  { key: 'noncash', label: 'פעילויות מהותיות שלא במזומן' },
];

// מציאת שורת מזומנים ושווי מזומנים במאזן (ללא מוגבלים)
function findCashLine(balanceLines) {
  return balanceLines.find((l) => l.kind === 'line' && /מזומנים ושווי מזומנים/.test(l.label) && !/מוגבל/.test(l.label))
    || balanceLines.find((l) => /מזומנים/.test(l.label) && l.kind === 'line');
}

async function computeCashflow(version) {
  const companyId = version.company_id;
  const opening = await resolveOpeningVersion(version);

  const cur = await computeReport(version);
  const open = opening ? await computeReport(opening) : null;

  const curById = {}; [...cur.balance, ...cur.pnl].forEach((l) => { curById[l.id] = l.amount; });
  const openById = {}; if (open) [...open.balance, ...open.pnl].forEach((l) => { openById[l.id] = l.amount; });

  const lines = await knex('cashflow_lines').where({ company_id: companyId }).orderBy(['section', 'sort_order', 'id']);
  const valRows = await knex('cashflow_values').where({ version_id: version.id });
  const manualVal = {}; valRows.forEach((v) => { manualVal[v.cashflow_line_id] = Number(v.amount) || 0; });

  // רווח נקי = -(סכום שורות רו"ה)
  const netProfit = -cur.pnl.filter((l) => l.kind === 'line').reduce((s, l) => s + (Number(l.amount) || 0), 0);

  const computeLine = (l) => {
    if (l.source_type === 'netprofit') return netProfit * (l.sign || 1);
    if (l.source_type === 'pnl' && l.source_fs_line_id) {
      return (Number(curById[l.source_fs_line_id]) || 0) * (l.sign || 1);
    }
    if (l.source_type === 'bs_move' && l.source_fs_line_id) {
      const move = (Number(curById[l.source_fs_line_id]) || 0) - (Number(openById[l.source_fs_line_id]) || 0);
      return move * (l.sign || 1);
    }
    return manualVal[l.id] || 0; // manual
  };

  const sections = SECTIONS.map((sec) => {
    const secLines = lines.filter((l) => l.section === sec.key).map((l) => ({
      id: l.id, label: l.label, source_type: l.source_type, source_fs_line_id: l.source_fs_line_id,
      sign: l.sign, is_subtotal: !!l.is_subtotal,
      cur: l.source_fs_line_id ? (Number(curById[l.source_fs_line_id]) || 0) : null,
      open: l.source_fs_line_id ? (Number(openById[l.source_fs_line_id]) || 0) : null,
      value: l.is_subtotal ? 0 : computeLine(l),
    }));
    const total = secLines.filter((l) => !l.is_subtotal).reduce((s, l) => s + l.value, 0);
    secLines.filter((l) => l.is_subtotal).forEach((l) => { l.value = total; });
    return { key: sec.key, label: sec.label, lines: secLines, total };
  });

  const totalOf = (k) => (sections.find((s) => s.key === k) || { total: 0 }).total;
  const operating = totalOf('operating_adj') + totalOf('operating_wc') + totalOf('operating_cash');
  const investing = totalOf('investing');
  const financing = totalOf('financing');
  const fx = totalOf('fx');
  const netChange = operating + investing + financing + fx;

  // בקרה מול תנועת סעיף המזומנים בפועל
  const cashLine = findCashLine(cur.balance);
  const openingCash = cashLine ? (Number(openById[cashLine.id]) || 0) : 0;
  const closingCashActual = cashLine ? (Number(curById[cashLine.id]) || 0) : 0;
  const closingCashComputed = openingCash + netChange;
  const control = closingCashComputed - closingCashActual;

  return {
    version: { id: version.id, name: version.name },
    opening: opening ? { id: opening.id, name: opening.name } : null,
    sections,
    subtotals: { operating, investing, financing, fx, netChange },
    control: {
      openingCash, closingCashActual, closingCashComputed, diff: control,
      ok: Math.abs(control) < 1,
      cashLineLabel: cashLine ? cashLine.label : null,
    },
  };
}

module.exports = { computeCashflow, SECTIONS, findCashLine };
