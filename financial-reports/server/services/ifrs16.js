'use strict';
const knex = require('../db');
const { memberDetails } = require('./consolidation');

// חישוב סיכום IFRS16 לגרסה בודדת (חברה בת) — מצירוף הסכמיה
async function computeCompanyIFRS16(version) {
  const ags = await knex('ifrs16_agreements').where({ company_id: version.company_id, active: true });
  const moves = await knex('ifrs16_movements').where({ version_id: version.id });
  const byAg = {}; moves.forEach((m) => { byAg[m.agreement_id] = m; });

  const lines = ags.map((a) => {
    const m = byAg[a.id] || {};
    const n = (k) => Number(m[k]) || 0;
    const liabClosing = n('liab_open') + n('liab_add') + n('liab_disposal') + n('liab_payment') + n('liab_interest') + n('liab_fx');
    const assetClosing = n('asset_open') + n('asset_add') + n('asset_disposal') + n('asset_depreciation');
    return {
      agreement_id: a.id, name: a.name, currency: a.currency,
      liab_open: n('liab_open'), liab_add: n('liab_add'), liab_disposal: n('liab_disposal'),
      liab_payment: n('liab_payment'), liab_interest: n('liab_interest'), liab_fx: n('liab_fx'), liab_closing: liabClosing,
      asset_open: n('asset_open'), asset_add: n('asset_add'), asset_disposal: n('asset_disposal'),
      asset_depreciation: n('asset_depreciation'), asset_closing: assetClosing,
      current_portion: n('current_portion'),
      row_version: m.row_version || 1, movement_id: m.id || null,
    };
  });
  return lines;
}

function summarize(lines) {
  const s = { asset_closing: 0, liab_closing: 0, current_portion: 0, depreciation: 0, interest: 0, payments: 0, additions: 0, fx: 0 };
  lines.forEach((l) => {
    s.asset_closing += l.asset_closing;
    s.liab_closing += l.liab_closing;
    s.current_portion += l.current_portion;
    s.depreciation += -l.asset_depreciation; // הוצאה חיובית
    s.interest += l.liab_interest;
    s.payments += -l.liab_payment;
    s.additions += l.asset_add;
    s.fx += l.liab_fx;
  });
  s.long_term = s.liab_closing - s.current_portion;
  return s;
}

// סיכום מלא לגרסה: לחברה בודדת — הסכמיה; למאוחד — צירוף החברות המאוחדות איחוד מלא (לא אקוויטי)
async function computeIFRS16(version) {
  const company = await knex('companies').where({ id: version.company_id }).first();
  if (company && company.is_consolidated) {
    const members = await memberDetails(version.id); // {member_version_id, holding_pct, method}
    const full = members.filter((m) => m.method !== 'equity');
    const perCompany = [];
    let all = [];
    for (const m of full) {
      const mv = await knex('report_versions').where({ id: m.member_version_id }).first();
      if (!mv) continue;
      const lines = await computeCompanyIFRS16(mv);
      const c = await knex('companies').where({ id: mv.company_id }).first();
      perCompany.push({ company: c.name, summary: summarize(lines), count: lines.length });
      all = all.concat(lines.map((l) => ({ ...l, company: c.name })));
    }
    return { consolidated: true, lines: all, summary: summarize(all), perCompany, excludedEquity: members.filter((m) => m.method === 'equity').length };
  }
  const lines = await computeCompanyIFRS16(version);
  return { consolidated: false, lines, summary: summarize(lines) };
}

// בדיקת התאמה מול הדוח: זכות שימוש + התחייבות חכירה (מאזן), פחת + מימון (רו"ה)
async function reconcileIFRS16(version, report) {
  const { summary } = await computeIFRS16(version);
  const findLine = (rx, stmt) => (report[stmt] || []).filter((l) => l.kind === 'line' && rx.test(l.label));
  const sumLines = (arr) => arr.reduce((s, l) => s + Math.abs(l.amount), 0);
  const rouReport = sumLines(findLine(/זכות שימוש/, 'balance'));
  const leaseReport = sumLines(findLine(/חכירה/, 'balance'));
  return {
    rou: { module: summary.asset_closing, report: rouReport, diff: summary.asset_closing - rouReport },
    lease: { module: summary.liab_closing, report: leaseReport, diff: summary.liab_closing - leaseReport },
    depreciation: summary.depreciation, interest: summary.interest,
    current_portion: summary.current_portion, long_term: summary.long_term,
  };
}

// סעיפים סינתטיים לפקודת IFRS16
const IFRS_SECTIONS = {
  ROU: { code: '__IFRS_ROU__', name: 'זכות שימוש בנכס (IFRS 16)', statement: 'balance' },
  LEASE_CUR: { code: '__IFRS_LEASE_CUR__', name: 'חלויות שוטפות בגין חכירה', statement: 'balance' },
  LEASE_LT: { code: '__IFRS_LEASE_LT__', name: 'התחייבות לזמן ארוך בגין חכירה', statement: 'balance' },
  DEP: { code: '__IFRS_DEP__', name: 'הוצאות פחת בגין זכות שימוש', statement: 'pnl' },
  FIN: { code: '__IFRS_FIN__', name: 'הוצאות מימון בגין חכירה', statement: 'pnl' },
  EFFECT: { code: '__IFRS_EFFECT__', name: 'IFRS 16 - השפעה מצטברת על העודפים', statement: 'balance' },
};

async function ensureIFRS16Lines(companyId) {
  const { ensureSectionMapped } = require('./build-structure');
  for (const s of Object.values(IFRS_SECTIONS)) {
    await ensureSectionMapped(companyId, s.code, s.name, s.statement);
  }
}

// ייצור פקודת יומן מהסכמי IFRS16 (אידמפוטנטי) — לחברה בודדת
async function generateForCompany(version, userId) {
  await ensureIFRS16Lines(version.company_id);
  const lines = await computeCompanyIFRS16(version);
  const s = summarize(lines);
  // מחיקת פקודות IFRS16 קודמות לגרסה
  await knex('adjustments').where({ version_id: version.id, source: 'ifrs16' }).del();

  const rows = [];
  const add = (sec, amount, purpose) => { if (Math.abs(amount) > 0.5) rows.push({ version_id: version.id, tb_section_code: sec.code, tb_section_name: sec.name, purpose, amount, source: 'ifrs16', source_ref: 'ifrs16', created_by: userId }); };
  // סימני מאזן בוחן: נכס +, התחייבות −, הוצאה +
  add(IFRS_SECTIONS.ROU, s.asset_closing, 'IFRS16: זכות שימוש בנכס');
  add(IFRS_SECTIONS.LEASE_CUR, -s.current_portion, 'IFRS16: חלות שוטפת חכירה');
  add(IFRS_SECTIONS.LEASE_LT, -s.long_term, 'IFRS16: התחייבות חכירה ז"א');
  add(IFRS_SECTIONS.DEP, s.depreciation, 'IFRS16: הוצאות פחת');
  add(IFRS_SECTIONS.FIN, s.interest, 'IFRS16: הוצאות מימון');
  const sum = rows.reduce((t, r) => t + r.amount, 0);
  add(IFRS_SECTIONS.EFFECT, -sum, 'IFRS16: השפעה מצטברת (איזון)');

  if (rows.length) await knex('adjustments').insert(rows);
  return { company_id: version.company_id, entries: rows.length, balanced: Math.abs(rows.reduce((t, r) => t + r.amount, 0)) < 1, summary: s };
}

// ייצור פקודה: לחברה בודדת — עליה; למאוחד — על כל חברה בת באיחוד מלא
async function generateIFRS16Entries(version, userId) {
  const company = await knex('companies').where({ id: version.company_id }).first();
  if (company && company.is_consolidated) {
    const members = await memberDetails(version.id);
    const results = [];
    for (const m of members.filter((x) => x.method !== 'equity')) {
      const mv = await knex('report_versions').where({ id: m.member_version_id }).first();
      if (mv) results.push(await generateForCompany(mv, userId));
    }
    await ensureIFRS16Lines(version.company_id); // מיפוי הסעיפים הסינתטיים גם למאוחד
    return { consolidated: true, results };
  }
  return { consolidated: false, ...(await generateForCompany(version, userId)) };
}

module.exports = { computeIFRS16, computeCompanyIFRS16, reconcileIFRS16, summarize, generateIFRS16Entries, ensureIFRS16Lines, IFRS_SECTIONS };
