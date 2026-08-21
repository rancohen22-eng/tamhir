'use strict';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, HeadingLevel, PageBreak,
} = require('docx');

const FONT = 'David';

// עיצוב מספר בסגנון הדוח (אלפי דולר): פסיקים, "-" לאפס, סוגריים לשלילי
function fmtU(v, units) {
  const n = Math.round((Number(v) || 0) / (units || 1));
  if (n === 0) return '-';
  const s = Math.abs(n).toLocaleString('en-US');
  return n < 0 ? `(${s})` : s;
}

function heDate(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split('-');
  const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  return `${Number(day)} ב${months[Number(m) - 1]} ${y}`;
}

function P(text, o = {}) {
  return new Paragraph({
    bidirectional: true, alignment: o.align || AlignmentType.RIGHT,
    spacing: o.spacing || { after: 60 }, heading: o.heading,
    children: [new TextRun({ text: text == null ? '' : String(text), bold: o.bold, size: o.size, color: o.color, italics: o.italics, font: FONT })],
  });
}

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const TOP_LINE = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const noBorders = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER };

function cell(children, opts = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    columnSpan: opts.span, verticalAlign: 'center',
    children: Array.isArray(children) ? children : [children],
  });
}
function numPara(text, opts = {}) {
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 },
    border: opts.top ? { top: TOP_LINE } : undefined,
    children: [new TextRun({ text: text || '', bold: opts.bold, font: FONT, size: 18 })] });
}

// עומק שורה בעץ
function depthMap(lines) {
  const byId = {}; lines.forEach((l) => { byId[l.id] = l; });
  const depth = {};
  const calc = (l) => { if (depth[l.id] != null) return depth[l.id]; depth[l.id] = l.parent_id && byId[l.parent_id] ? calc(byId[l.parent_id]) + 1 : 0; return depth[l.id]; };
  lines.forEach(calc); return depth;
}

// טבלת דוח מצב כספי / רו"ה: [תיאור | באור | שוטף | קודם]
function statementTable(lines, period, units, audited) {
  const depth = depthMap(lines);
  const header = new TableRow({ tableHeader: true, children: [
    cell(P('', { spacing: { after: 0 } }), { width: 46 }),
    cell(P('באור', { bold: true, align: AlignmentType.CENTER }), { width: 10 }),
    cell([P('ליום 31 בדצמבר', { bold: true, align: AlignmentType.CENTER, size: 18 }), numPara(String(period.fiscal_year), { bold: true }), P('אלפי דולר', { align: AlignmentType.CENTER, size: 16 }), P(audited ? 'מבוקר' : 'לא מבוקר', { align: AlignmentType.CENTER, size: 16 })], { width: 22 }),
    cell([P('ליום 31 בדצמבר', { bold: true, align: AlignmentType.CENTER, size: 18 }), numPara(String(period.fiscal_year - 1), { bold: true }), P('אלפי דולר', { align: AlignmentType.CENTER, size: 16 }), P('מבוקר', { align: AlignmentType.CENTER, size: 16 })], { width: 22 }),
  ] });
  const rows = [header];
  for (const l of lines) {
    const isHeader = l.kind === 'header'; const isTotal = l.kind === 'total';
    const indent = '  '.repeat(depth[l.id] || 0);
    rows.push(new TableRow({ children: [
      cell(new Paragraph({ bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { after: 20 }, children: [new TextRun({ text: indent + l.label, bold: isHeader || isTotal, font: FONT, size: 19 })] })),
      cell(P(l.note_ref || '', { align: AlignmentType.CENTER, size: 18 })),
      cell(numPara(isHeader ? '' : fmtU(l.amount, units), { bold: isTotal, top: isTotal })),
      cell(numPara(isHeader ? '' : fmtU(l.prior, units), { bold: isTotal, top: isTotal })),
    ] }));
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, visuallyRightToLeft: true, borders: noBorders, rows });
}

function cashflowTable(cashflow, period, units) {
  const rows = [new TableRow({ tableHeader: true, children: [
    cell(P('', { spacing: { after: 0 } }), { width: 74 }),
    cell([P(`לשנה שהסתיימה ${period.fiscal_year}`, { bold: true, align: AlignmentType.CENTER, size: 16 }), P('אלפי דולר', { align: AlignmentType.CENTER, size: 15 })], { width: 26 }),
  ] })];
  cashflow.sections.forEach((sec) => {
    if (!sec.lines.length) return;
    rows.push(new TableRow({ children: [cell(P(sec.label, { bold: true }), { span: 2 })] }));
    sec.lines.forEach((l) => rows.push(new TableRow({ children: [
      cell(P((l.is_subtotal ? '' : '   ') + l.label, { bold: l.is_subtotal, size: 19 })),
      cell(numPara(fmtU(l.value, units), { bold: l.is_subtotal, top: l.is_subtotal })),
    ] })));
  });
  const s = cashflow.subtotals; const c = cashflow.control;
  [['שינוי נטו במזומנים', s.netChange], ['יתרת מזומנים לתחילת השנה', c.openingCash], ['יתרת מזומנים לסוף השנה', c.closingCashActual]]
    .forEach(([lbl, v]) => rows.push(new TableRow({ children: [cell(P(lbl, { bold: true })), cell(numPara(fmtU(v, units), { bold: true, top: true }))] })));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, visuallyRightToLeft: true, borders: noBorders, rows });
}

function equityTable(equity, units) {
  const cols = equity.columns;
  const grey = { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' };
  const head = [cell(P('', {}))];
  cols.forEach((c) => head.push(cell(P(c.label, { bold: true, align: AlignmentType.CENTER, size: 15 }))));
  head.push(cell(P('סה"כ', { bold: true, align: AlignmentType.CENTER })));
  const rows = [new TableRow({ tableHeader: true, children: head })];
  const mk = (r, bold) => new TableRow({ children: [cell(P(r.label, { bold, size: 18 })), ...cols.map((c) => cell(numPara(fmtU(r.values[c.id], units), { bold }))), cell(numPara(fmtU(r.values.total, units), { bold }))] });
  rows.push(mk(equity.rows[0], true));
  equity.rows.slice(1).forEach((r) => rows.push(mk(r, false)));
  rows.push(mk(equity.closing, true));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, visuallyRightToLeft: true,
    borders: { top: grey, bottom: grey, left: grey, right: grey, insideHorizontal: grey, insideVertical: grey }, rows });
}

async function buildReportDocx({ report, cashflow, equity, company, period, version, units = 1000, notes = [] }) {
  const audited = version && version.status === 'final';
  const consolidated = company && company.is_consolidated;
  const children = [];

  // ---- שער ----
  children.push(P(company.name, { bold: true, size: 36, align: AlignmentType.CENTER, spacing: { before: 1200, after: 200 } }));
  children.push(P('דוחות כספיים' + (consolidated ? ' מאוחדים' : ''), { bold: true, size: 30, align: AlignmentType.CENTER, spacing: { after: 100 } }));
  children.push(P(`ליום ${heDate(period.as_of_date)}`, { size: 26, align: AlignmentType.CENTER, spacing: { after: 100 } }));
  children.push(P(`(${audited ? 'מבוקר' : 'לא מבוקר'} · אלפי דולר · גרסה: ${version.name})`, { size: 20, align: AlignmentType.CENTER, color: '666666' }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ---- תוכן עניינים ----
  children.push(P('תוכן העניינים', { bold: true, size: 24, spacing: { after: 120 } }));
  ['דוח על המצב הכספי', 'דוח על רווח או הפסד', 'דוח על השינויים בהון', 'דוח על תזרימי המזומנים', 'ביאורים לדוחות הכספיים']
    .forEach((t, i) => children.push(P(`${i + 1}.  ${t}`, { size: 22 })));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  const section = (title, node) => {
    children.push(P(title, { bold: true, size: 26, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 140 } }));
    if (node) children.push(node); else children.push(P('(לא הוגדרו שורות)', { color: '999999' }));
  };

  section('דוח על המצב הכספי', report.balance.length ? statementTable(report.balance, period, units, audited) : null);
  children.push(new Paragraph({ children: [new PageBreak()] }));
  section('דוח על רווח או הפסד', report.pnl.length ? statementTable(report.pnl, period, units, audited) : null);
  if (equity && equity.columns && equity.columns.length) { children.push(new Paragraph({ children: [new PageBreak()] })); section('דוח על השינויים בהון', equityTable(equity, units)); }
  if (cashflow && cashflow.sections && cashflow.sections.some((s) => s.lines.length)) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    section('דוח על תזרימי המזומנים', cashflowTable(cashflow, period, units));
    if (!cashflow.control.ok) children.push(P(`⚠ בקרת תזרים: הפרש ${fmtU(cashflow.control.diff, units)} אלפי דולר`, { color: 'B3261E', size: 18 }));
  }

  // ---- ביאורים מילוליים ----
  if (notes && notes.length) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(P('ביאורים לדוחות הכספיים', { bold: true, size: 26, heading: HeadingLevel.HEADING_1, spacing: { after: 140 } }));
    notes.filter((n) => (n.title || n.body)).sort((a, b) => String(a.note_ref).localeCompare(String(b.note_ref), 'he', { numeric: true }))
      .forEach((n) => {
        children.push(P(`באור ${n.note_ref}${n.title ? ' — ' + n.title : ''}`, { bold: true, size: 22, spacing: { before: 160, after: 60 } }));
        String(n.body || '').split(/\r?\n/).forEach((line) => { if (line.trim()) children.push(P(line, { size: 20, spacing: { after: 40 } })); });
      });
  }

  // ---- סעיפים לא ממופים ----
  if (report.unmapped && report.unmapped.length) {
    children.push(P('סעיפי מאזן בוחן שאינם ממופים לשורת דוח:', { bold: true, color: 'B3261E', spacing: { before: 300, after: 60 } }));
    report.unmapped.slice(0, 40).forEach((u) => children.push(P(`${u.code} — ${u.name}: ${fmtU(u.net, units)}`, { color: 'B3261E', size: 16 })));
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildReportDocx, fmtU };
