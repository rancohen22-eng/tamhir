'use strict';
const knex = require('../db');
const { computeReport } = require('./report-engine');
const { resolveOpeningVersion } = require('./comparative');
const { findCashLine } = require('./cashflow-engine');

// דליי פעילות (עמודות נייר העבודה)
const BUCKETS = [
  { key: 'operating', label: 'פעילות שוטפת', cash: true },
  { key: 'interest_tax', label: 'ריבית ומיסים ששולמו', cash: true },
  { key: 'investing', label: 'פעילות השקעה', cash: true },
  { key: 'financing', label: 'פעילות מימון', cash: true },
  { key: 'fx', label: 'הפרשי שער על מזומנים', cash: true },
  { key: 'noncash', label: 'פעילות שלא במזומן', cash: false },
  { key: 'transfers', label: 'העברות/מיונים', cash: false },
  { key: 'translation', label: 'קרן הון מהפרשי תרגום', cash: false },
];
const CASH_BUCKETS = BUCKETS.filter((b) => b.cash).map((b) => b.key);

// דלי ברירת-מחדל לשורה (רק דליי מזומן — כדי שהבקרה תתלכד; המשתמש מעדן ל'שלא במזומן' וכו')
function defaultBucket(label) {
  if (/רכוש קבוע|מקדמות ע"ח רכוש/.test(label)) return 'investing';
  if (/הלוואות|אשראי|חכירה|הלוואה|הקצאת מניות/.test(label)) return 'financing';
  if (/הון מניות|פרמיה|קרן/.test(label)) return 'financing';
  return 'operating';
}

async function computeWorksheet(version) {
  const opening = await resolveOpeningVersion(version);
  const cur = await computeReport(version);
  const open = opening ? await computeReport(opening) : null;
  const openById = {}; if (open) open.balance.forEach((l) => { openById[l.id] = l.amount; });

  const cashLine = findCashLine(cur.balance);
  const cashId = cashLine ? cashLine.id : null;

  // סגירת רו"ה לעודפים: במאזן בוחן חשבונות הרו"ה נפרדים, ולכן המאזן אינו נסגר בגובה
  // הרווח. מוסיפים את הרווח הנקי לשורת העודפים (וגם לפתיחה שלה מהגרסה הקודמת) כך
  // שהמאזן מתאזן והרווח זורם דרך תנועת העודפים לפעילות השוטפת.
  const netProfit = -cur.pnl.filter((l) => l.kind === 'line').reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const retLine = cur.balance.find((l) => l.kind === 'line' && /(עודפים|יתרת רווח|גרעון)/.test(l.label));
  if (retLine) retLine.amount = (Number(retLine.amount) || 0) - netProfit;

  // הקצאות שמורות
  const allocRows = await knex('cashflow_allocations').where({ version_id: version.id });
  const alloc = {}; // fs_line_id -> { bucket: amount }
  allocRows.forEach((a) => { (alloc[a.fs_line_id] = alloc[a.fs_line_id] || {})[a.bucket] = Number(a.amount) || 0; });

  const lines = cur.balance.filter((l) => l.kind === 'line' && l.id !== cashId).map((l) => {
    const openv = Number(openById[l.id]) || 0;
    const closev = Number(l.amount) || 0;
    const movement = closev - openv;
    const a = alloc[l.id];
    let buckets;
    if (a && Object.keys(a).length) buckets = Object.fromEntries(BUCKETS.map((b) => [b.key, Number(a[b.key]) || 0]));
    else { buckets = Object.fromEntries(BUCKETS.map((b) => [b.key, 0])); buckets[defaultBucket(l.label)] = movement; } // ברירת מחדל: כל התנועה בדלי אחד
    const allocated = BUCKETS.reduce((s, b) => s + buckets[b.key], 0);
    return { id: l.id, label: l.label, opening: openv, closing: closev, movement, buckets, check: openv + allocated - closev, note_ref: l.note_ref };
  });

  // סיכום דלי על פני כל השורות
  const bucketTotals = Object.fromEntries(BUCKETS.map((b) => [b.key, lines.reduce((s, l) => s + l.buckets[b.key], 0)]));

  // תזרים = מינוס סכום הדלי (עליית נכס = תזרים שלילי)
  const cashOpening = cashLine ? (Number(openById[cashLine.id]) || 0) : 0;
  const cashClosing = cashLine ? (Number(cur.balance.find((l) => l.id === cashLine.id).amount) || 0) : 0;
  const cf = Object.fromEntries(CASH_BUCKETS.map((k) => [k, -bucketTotals[k]]));
  const netChange = CASH_BUCKETS.reduce((s, k) => s + cf[k], 0);
  const computedClosing = cashOpening + netChange;

  return {
    version: { id: version.id, name: version.name },
    opening: opening ? { id: opening.id, name: opening.name } : null,
    buckets: BUCKETS,
    lines,
    bucketTotals,
    cashflow: {
      operating: cf.operating + cf.interest_tax,
      operating_detail: { activity: cf.operating, interest_tax: cf.interest_tax },
      investing: cf.investing,
      financing: cf.financing,
      fx: cf.fx,
      netChange,
    },
    control: {
      cashOpening, cashClosing, computedClosing, diff: computedClosing - cashClosing,
      ok: Math.abs(computedClosing - cashClosing) < 1,
      // בקרות שלמות: דליים שאינם-מזומן אמורים להתאפס על פני כל השורות
      noncashSum: bucketTotals.noncash, transfersSum: bucketTotals.transfers, translationSum: bucketTotals.translation,
      lineChecks: lines.filter((l) => Math.abs(l.check) > 1).length,
      cashLineLabel: cashLine ? cashLine.label : null,
    },
  };
}

module.exports = { computeWorksheet, BUCKETS, CASH_BUCKETS };
