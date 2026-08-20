'use strict';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, HeadingLevel,
} = require('docx');

// עיצוב מספר בסגנון הדוח: אלפים עם פסיקים, "-" לאפס, סוגריים לשלילי
function fmt(v) {
  const n = Math.round(Number(v) || 0);
  if (n === 0) return '-';
  const s = Math.abs(n).toLocaleString('en-US');
  return n < 0 ? `(${s})` : s;
}

function heIso(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split('-');
  const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  return `${Number(day)} ב${months[Number(m) - 1]} ${y}`;
}

function p(text, opts = {}) {
  return new Paragraph({
    bidirectional: true,
    alignment: opts.align || AlignmentType.RIGHT,
    spacing: opts.spacing || { after: 80 },
    heading: opts.heading,
    children: [new TextRun({ text: text || '', bold: opts.bold, size: opts.size, color: opts.color })],
  });
}

// חישוב עומק שורה בעץ (להזחה)
function depthMap(lines) {
  const byId = {}; lines.forEach((l) => { byId[l.id] = l; });
  const depth = {};
  const calc = (l) => {
    if (depth[l.id] != null) return depth[l.id];
    depth[l.id] = l.parent_id && byId[l.parent_id] ? calc(byId[l.parent_id]) + 1 : 0;
    return depth[l.id];
  };
  lines.forEach(calc);
  return depth;
}

function cell(children, width) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    children: Array.isArray(children) ? children : [children],
  });
}

function statementTable(lines, period) {
  const depth = depthMap(lines);
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const topBorder = { style: BorderStyle.SINGLE, size: 4, color: '000000' };

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cell(p('', { spacing: { after: 0 } }), 46),
      cell(p('באור', { bold: true, align: AlignmentType.CENTER }), 10),
      cell(p(`${period.fiscal_year}`, { bold: true, align: AlignmentType.CENTER }), 22),
      cell(p(`${period.fiscal_year - 1}`, { bold: true, align: AlignmentType.CENTER }), 22),
    ],
  });

  const rows = [headerRow];
  for (const l of lines) {
    const isHeader = l.kind === 'header';
    const isTotal = l.kind === 'total';
    const indent = '  '.repeat(depth[l.id] || 0);
    const labelPara = new Paragraph({
      bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { after: 40 },
      children: [new TextRun({ text: indent + l.label, bold: isHeader || isTotal })],
    });
    const numRun = (v) => new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 40 },
      children: [new TextRun({ text: isHeader ? '' : fmt(v), bold: isTotal })],
      border: isTotal ? { top: topBorder } : undefined,
    });
    rows.push(new TableRow({
      children: [
        cell(labelPara), cell(p(l.note_ref || '', { align: AlignmentType.CENTER })),
        cell(numRun(l.amount)), cell(numRun(l.prior)),
      ],
    }));
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    visuallyRightToLeft: true,
    borders: {
      top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
      insideHorizontal: noBorder, insideVertical: noBorder,
    },
    rows,
  });
}

// טבלת תזרים מזומנים פשוטה (תווית | סכום)
function cashflowTable(cashflow) {
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const topBorder = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  const rows = [];
  cashflow.sections.forEach((sec) => {
    if (!sec.lines.length) return;
    rows.push(new TableRow({ children: [
      new TableCell({ width: { size: 75, type: WidthType.PERCENTAGE }, children: [p(sec.label, { bold: true })] }),
      new TableCell({ children: [p('')] }),
    ] }));
    sec.lines.forEach((l) => rows.push(new TableRow({ children: [
      new TableCell({ children: [p((l.is_subtotal ? '' : '   ') + l.label, { bold: l.is_subtotal })] }),
      new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: fmt(l.value), bold: l.is_subtotal })], border: l.is_subtotal ? { top: topBorder } : undefined })] }),
    ] })));
  });
  const S = cashflow.subtotals;
  [['שינוי נטו במזומנים', S.netChange], ['יתרת מזומנים לתחילת התקופה', cashflow.control.openingCash], ['יתרת מזומנים לסוף התקופה', cashflow.control.closingCashActual]]
    .forEach(([lbl, val]) => rows.push(new TableRow({ children: [
      new TableCell({ children: [p(lbl, { bold: true })] }),
      new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: fmt(val), bold: true })], border: { top: topBorder } })] }),
    ] })));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, visuallyRightToLeft: true,
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder }, rows });
}

// טבלת שינויים בהון (עמודות רכיבים)
function equityTable(equity) {
  const border = { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' };
  const cols = equity.columns;
  const headCells = [new TableCell({ children: [p('תנועה', { bold: true })] })];
  cols.forEach((c) => headCells.push(new TableCell({ children: [p(c.label, { bold: true, align: AlignmentType.CENTER, size: 16 })] })));
  headCells.push(new TableCell({ children: [p('סה"כ', { bold: true, align: AlignmentType.CENTER })] }));
  const rows = [new TableRow({ tableHeader: true, children: headCells })];
  const mkRow = (r, bold) => {
    const cells = [new TableCell({ children: [p(r.label, { bold })] })];
    cols.forEach((c) => cells.push(new TableCell({ children: [p(fmt(r.values[c.id]), { align: AlignmentType.CENTER, bold })] })));
    cells.push(new TableCell({ children: [p(fmt(r.values.total), { align: AlignmentType.CENTER, bold })] }));
    return new TableRow({ children: cells });
  };
  rows.push(mkRow(equity.rows[0], true));
  equity.rows.slice(1).forEach((r) => rows.push(mkRow(r, false)));
  rows.push(mkRow(equity.closing, true));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, visuallyRightToLeft: true,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border }, rows });
}

async function buildReportDocx({ report, cashflow, equity, company, period, version }) {
  const children = [];

  // ---- שער ----
  children.push(p(company.name, { bold: true, size: 32, align: AlignmentType.CENTER, spacing: { after: 200, before: 400 } }));
  children.push(p('דוחות כספיים' + (company.is_consolidated ? ' מאוחדים' : ''), { bold: true, size: 28, align: AlignmentType.CENTER }));
  children.push(p(`ליום ${heIso(period.as_of_date)}`, { size: 24, align: AlignmentType.CENTER, spacing: { after: 400 } }));
  children.push(p(`גרסה: ${version.name} (${version.status === 'final' ? 'סופי' : 'טיוטה'})`, { align: AlignmentType.CENTER, color: '666666' }));
  children.push(p(`הופק ב-${new Date().toLocaleDateString('he-IL')} · המספרים באלפי דולר`, { align: AlignmentType.CENTER, color: '666666', spacing: { after: 400 } }));

  // ---- דוח על המצב הכספי ----
  children.push(p('דוח על המצב הכספי', { bold: true, size: 26, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 } }));
  if (report.balance.length) children.push(statementTable(report.balance, period));
  else children.push(p('(לא הוגדרו שורות מאזן)', { color: '999999' }));

  // ---- דוח רווח והפסד ----
  children.push(p('דוח על רווח או הפסד', { bold: true, size: 26, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 120 } }));
  if (report.pnl.length) children.push(statementTable(report.pnl, period));
  else children.push(p('(לא הוגדרו שורות רווח והפסד)', { color: '999999' }));

  // ---- דוח על השינויים בהון ----
  if (equity && equity.columns && equity.columns.length) {
    children.push(p('דוח על השינויים בהון', { bold: true, size: 26, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 120 } }));
    children.push(equityTable(equity));
  }

  // ---- דוח על תזרימי המזומנים ----
  if (cashflow && cashflow.sections && cashflow.sections.some((s) => s.lines.length)) {
    children.push(p('דוח על תזרימי המזומנים', { bold: true, size: 26, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 120 } }));
    children.push(cashflowTable(cashflow));
    if (!cashflow.control.ok) children.push(p(`⚠ בקרת תזרים: הפרש ${fmt(cashflow.control.diff)} אלפי דולר`, { color: 'B3261E', size: 18 }));
  }

  // ---- סעיפים לא ממופים (אזהרה) ----
  if (report.unmapped && report.unmapped.length) {
    children.push(p('סעיפי מאזן בוחן שאינם ממופים לשורת דוח:', { bold: true, color: 'B3261E', spacing: { before: 400, after: 80 } }));
    report.unmapped.slice(0, 40).forEach((u) => {
      children.push(p(`${u.code} — ${u.name}: ${fmt(u.net)}`, { color: 'B3261E', size: 18 }));
    });
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: 'David', size: 22 } } } },
    sections: [{
      properties: { page: { size: {}, margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildReportDocx, fmt };
