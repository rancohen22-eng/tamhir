'use strict';
const knex = require('../db');
const { computeReport } = require('./report-engine');
const { resolveOpeningVersion } = require('./comparative');

// עמודות ההון = שורות המאזן תחת כותרת "הון"
function equityColumns(balanceLines) {
  const headers = balanceLines.filter((l) => l.kind === 'header' && /הון/.test(l.label));
  const headerIds = new Set(headers.map((h) => h.id));
  let cols = balanceLines.filter((l) => l.kind === 'line' && headerIds.has(l.parent_id));
  // נפילה חלופית: שורות שכותרתן מרמזת על רכיב הון
  if (!cols.length) cols = balanceLines.filter((l) => l.kind === 'line' && /(הון|פרמיה|עודפים|קרן|גרעון)/.test(l.label));
  return cols;
}
const retainedCol = (cols) => cols.find((c) => /(עודפים|יתרת רווח|גרעון|הפסד)/.test(c.label)) || cols[cols.length - 1];

async function computeEquity(version) {
  const companyId = version.company_id;
  const opening = await resolveOpeningVersion(version);
  const cur = await computeReport(version);
  const open = opening ? await computeReport(opening) : null;

  const curById = {}; cur.balance.forEach((l) => { curById[l.id] = l.amount; });
  const openById = {}; if (open) open.balance.forEach((l) => { openById[l.id] = l.amount; });

  const cols = equityColumns(cur.balance).map((c) => ({ id: c.id, label: c.label }));
  const retId = cols.length ? retainedCol(cols).id : null;

  // רווח נקי = -(סכום שורות רו"ה) [הכנסות שליליות, הוצאות חיוביות במאזן בוחן]
  const netProfit = -cur.pnl.filter((l) => l.kind === 'line').reduce((s, l) => s + (Number(l.amount) || 0), 0);

  // שורות תנועה ידניות
  const rowsDef = await knex('equity_rows').where({ company_id: companyId }).orderBy(['sort_order', 'id']);
  const valRows = await knex('equity_values').where({ version_id: version.id });
  const valOf = (rowId, colId) => { const v = valRows.find((x) => x.equity_row_id === rowId && x.fs_line_id === colId); return v ? Number(v.amount) || 0 : 0; };

  const colVal = (fn) => { const o = {}; cols.forEach((c) => { o[c.id] = fn(c.id); }); o.total = cols.reduce((s, c) => s + o[c.id], 0); return o; };

  const openingRow = { label: 'יתרה לתחילת התקופה', kind: 'opening', values: colVal((cid) => Number(openById[cid]) || 0) };
  const profitRow = { label: 'רווח (הפסד) לתקופה', kind: 'profit', values: colVal((cid) => (cid === retId ? netProfit : 0)) };
  const manualRows = rowsDef.map((r) => ({ id: r.id, label: r.label, kind: r.kind, values: colVal((cid) => valOf(r.id, cid)) }));
  const closingRow = { label: 'יתרה לסוף התקופה', kind: 'closing', values: colVal((cid) => Number(curById[cid]) || 0) };

  // פלאג/בלתי-מוסבר per עמודה = סגירה − פתיחה − רווח − תנועות ידניות
  const explained = colVal((cid) => openingRow.values[cid] + profitRow.values[cid] + manualRows.reduce((s, r) => s + r.values[cid], 0));
  const unexplained = colVal((cid) => (Number(curById[cid]) || 0) - explained[cid]);

  return {
    version: { id: version.id, name: version.name },
    opening: opening ? { id: opening.id, name: opening.name } : null,
    columns: cols,
    rows: [openingRow, profitRow, ...manualRows],
    closing: closingRow,
    unexplained,
    control: { ok: Math.abs(unexplained.total) < 1, diff: unexplained.total },
    netProfit,
  };
}

module.exports = { computeEquity, equityColumns };
