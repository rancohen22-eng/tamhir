'use strict';
const knex = require('../db');

/*
 * מנוע חישוב הדוח הכספי לגרסה.
 * שלבים:
 *  1. בסיס = סכום יתרות מאזן בוחן לפי סעיף.
 *  2. + פקודות נוספות (adjustments) לפי סעיף.
 *  3. + פקודות מיון (reclassifications): הפחתה מסעיף המקור, הוספה לסעיף היעד.
 *  4. מיפוי סעיף -> שורת דוח דרך index_map.
 *  5. גלגול בעץ שורות הדוח (fs_lines).
 */

async function computeSectionTotals(version) {
  const versionId = version.id;

  const sections = {}; // code -> {code,name,mainHeader,subHeader, base, adj, reclass, prior}
  const ensure = (code, name) => {
    if (!sections[code]) {
      sections[code] = { code, name: name || code, mainHeader: null, subHeader: null, base: 0, adj: 0, reclass: 0, prior: 0 };
    }
    return sections[code];
  };

  const company = await knex('companies').where({ id: version.company_id }).first();
  if (company && company.is_consolidated) {
    // 1(מאוחד). בסיס = צירוף נטו-הסעיפים של גרסאות הבנות (כולל פקודות/מיונים שלהן)
    const { memberVersionIds } = require('./consolidation');
    const members = await memberVersionIds(versionId);
    for (const mid of members) {
      const memberVersion = await knex('report_versions').where({ id: mid }).first();
      if (!memberVersion) continue;
      const memberSections = await computeSectionTotals(memberVersion);
      Object.values(memberSections).forEach((ms) => {
        const s = ensure(ms.code, ms.name);
        s.base += ms.net; s.prior += ms.prior;
        s.mainHeader = ms.mainHeader; s.subHeader = ms.subHeader;
      });
    }
  } else {
    // 1. בסיס מאזן בוחן
    const base = await knex('trial_balance_rows').where({ version_id: versionId })
      .select('tb_section_code', 'tb_section_name', 'main_header', 'sub_header')
      .sum({ amount: 'amount' }).sum({ prior_amount: 'prior_amount' })
      .groupBy('tb_section_code', 'tb_section_name', 'main_header', 'sub_header');
    base.forEach((r) => {
      const s = ensure(r.tb_section_code || '(ללא סעיף)', r.tb_section_name);
      s.base += Number(r.amount) || 0;
      s.prior += Number(r.prior_amount) || 0;
      s.mainHeader = r.main_header; s.subHeader = r.sub_header;
      if (r.tb_section_name) s.name = r.tb_section_name;
    });
  }

  // 2. פקודות נוספות
  const adj = await knex('adjustments').where({ version_id: versionId })
    .select('tb_section_code', 'tb_section_name').sum({ amount: 'amount' })
    .groupBy('tb_section_code', 'tb_section_name');
  adj.forEach((r) => { ensure(r.tb_section_code || '(ללא סעיף)', r.tb_section_name).adj += Number(r.amount) || 0; });

  // 3. פקודות מיון
  const rc = await knex('reclassifications').where({ version_id: versionId });
  rc.forEach((r) => {
    const amt = Number(r.amount) || 0;
    if (r.from_section) ensure(r.from_section).reclass -= amt;
    if (r.to_section) ensure(r.to_section).reclass += amt;
  });

  // net לכל סעיף
  Object.values(sections).forEach((s) => { s.net = s.base + s.adj + s.reclass; });
  return sections;
}

// בניית הדוח המלא: שורות מאזן + רו"ה עם ערכים מגולגלים, ורשימת סעיפים לא ממופים
async function computeReport(version) {
  const companyId = version.company_id;
  const sections = await computeSectionTotals(version);

  // מיפוי סעיף -> fs_line
  const maps = await knex('index_map').where({ company_id: companyId });
  const sectionToLine = {};
  maps.forEach((m) => { if (m.fs_line_id) sectionToLine[m.tb_section_code] = m.fs_line_id; });

  const lines = await knex('fs_lines').where({ company_id: companyId }).orderBy(['statement', 'sort_order', 'id']);
  const byId = {}; lines.forEach((l) => { byId[l.id] = { ...l, direct: 0, direct_prior: 0, amount: 0, prior: 0, children: [] }; });
  lines.forEach((l) => { if (l.parent_id && byId[l.parent_id]) byId[l.parent_id].children.push(byId[l.id]); });

  // סכום ישיר לכל שורה מהסעיפים הממופים
  const unmapped = [];
  Object.values(sections).forEach((s) => {
    const lineId = sectionToLine[s.code];
    if (lineId && byId[lineId]) {
      byId[lineId].direct += s.net;
      byId[lineId].direct_prior += s.prior;
    } else {
      unmapped.push({ code: s.code, name: s.name, net: s.net, prior: s.prior });
    }
  });

  // גלגול רקורסיבי (amount = direct + סכום ילדים)
  const roll = (node) => {
    let amt = node.direct, pri = node.direct_prior;
    node.children.forEach((c) => { roll(c); amt += c.amount; pri += c.prior; });
    node.amount = amt; node.prior = pri;
  };
  const roots = lines.filter((l) => !l.parent_id).map((l) => byId[l.id]);
  roots.forEach(roll);

  const strip = (n) => ({
    id: n.id, statement: n.statement, parent_id: n.parent_id, sort_order: n.sort_order,
    label: n.label, note_ref: n.note_ref, kind: n.kind,
    direct: n.direct, amount: n.amount, prior: n.prior,
  });
  const flat = lines.map((l) => strip(byId[l.id]));

  return {
    version: { id: version.id, name: version.name, status: version.status },
    balance: flat.filter((l) => l.statement === 'balance'),
    pnl: flat.filter((l) => l.statement === 'pnl'),
    unmapped: unmapped.sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
    sectionCount: Object.keys(sections).length,
  };
}

/*
 * תחקור שורת דוח: מחזיר את הסעיפים הממופים לשורה, ולכל סעיף את החשבונות
 * (מתוך מאזן הבוחן) והפקודות/מיונים שהשפיעו — עד רמת החשבון.
 */
async function drillLine(version, fsLineId) {
  const companyId = version.company_id;
  const maps = await knex('index_map').where({ company_id: companyId, fs_line_id: fsLineId });
  const sectionCodes = maps.map((m) => m.tb_section_code);
  const line = await knex('fs_lines').where({ id: fsLineId }).first();

  const out = [];
  for (const m of maps) {
    const accounts = await knex('trial_balance_rows')
      .where({ version_id: version.id, tb_section_code: m.tb_section_code })
      .orderBy('account_no');
    const adjustments = await knex('adjustments')
      .where({ version_id: version.id, tb_section_code: m.tb_section_code });
    const reclassIn = await knex('reclassifications').where({ version_id: version.id, to_section: m.tb_section_code });
    const reclassOut = await knex('reclassifications').where({ version_id: version.id, from_section: m.tb_section_code });
    out.push({
      section_code: m.tb_section_code,
      section_name: m.tb_section_name,
      accounts, adjustments, reclassIn, reclassOut,
    });
  }
  return { line, sections: out, sectionCodes };
}

module.exports = { computeSectionTotals, computeReport, drillLine };
