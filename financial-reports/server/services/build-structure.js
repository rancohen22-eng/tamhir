'use strict';
const knex = require('../db');

/*
 * בניית מבנה הדוח (fs_lines) והאינדקס (index_map) אוטומטית מהמאזן בוחן של גרסה.
 *
 * ההיררכיה מגיעה מהמאזן עצמו:
 *   כותרת ראשית (**1.נכסים)  → קבוצת דוח (kind=header)
 *   כותרת משנה (*11.מזומנים) → שורת דוח (kind=line)
 *   סעיף (111.בנקים...)       → ממופה ל-fs_line של כותרת המשנה שלו
 *
 * כותרת ראשית 1–3 = מאזן (balance), 4–9 = רווח והפסד (pnl).
 */

// חילוץ קידומת מספרית ותווית: "**1.נכסים" -> {num:1, label:'נכסים'}
function parsePrefixed(raw) {
  if (raw == null) return { num: null, label: '', key: '' };
  const s = String(raw).trim();
  const m = s.match(/^[*\s]*(\d+)\s*[.\-)]?\s*(.*)$/);
  if (m) return { num: Number(m[1]), label: (m[2] || '').trim() || s, key: s };
  return { num: null, label: s, key: s };
}

async function buildFromVersion(version, { rebuild = false, ctx, sourceVersionIds } = {}) {
  const companyId = version.company_id;
  // מקור השורות: הגרסה עצמה, או (למאוחד) גרסאות הבנות
  const sources = sourceVersionIds && sourceVersionIds.length ? sourceVersionIds : [version.id];
  const rows = await knex('trial_balance_rows').whereIn('version_id', sources)
    .distinct('main_header', 'sub_header', 'tb_section_code', 'tb_section_name');

  // איסוף כותרות ראשיות וכותרות משנה ייחודיות, עם קידומת מספרית לסדר
  const mains = new Map();   // mainKey -> {num,label,statement}
  const subs = new Map();    // subKey  -> {num,label,mainKey}
  const sectionToSub = new Map(); // sectionCode -> subKey

  for (const r of rows) {
    const mainKey = (r.main_header || '').trim();
    const subKey = (r.sub_header || '').trim();
    if (mainKey && !mains.has(mainKey)) {
      const p = parsePrefixed(mainKey);
      mains.set(mainKey, { num: p.num, label: p.label, statement: (p.num != null && p.num <= 3) ? 'balance' : 'pnl' });
    }
    if (subKey && !subs.has(subKey)) {
      const p = parsePrefixed(subKey);
      subs.set(subKey, { num: p.num, label: p.label, mainKey });
    }
    if (r.tb_section_code) sectionToSub.set(r.tb_section_code, subKey || null);
  }

  const result = await knex.transaction(async (trx) => {
    if (rebuild) {
      // מחיקת מבנה קודם שנבנה אוטומטית (וגם המיפוי) — מיפוי ידני יאבד ברי-בילד יזום
      await trx('index_map').where({ company_id: companyId }).update({ fs_line_id: null });
      await trx('fs_lines').where({ company_id: companyId }).del();
    }

    // מפה של שורות דוח קיימות לפי תווית+statement כדי לא לשכפל
    const existing = await trx('fs_lines').where({ company_id: companyId });
    const findLine = (label, statement, kind) => existing.find((l) => l.label === label && l.statement === statement && l.kind === kind);

    // יצירת כותרות ראשיות
    const mainLineId = {}; // mainKey -> fs_line id
    const mainsSorted = [...mains.entries()].sort((a, b) => (a[1].num || 999) - (b[1].num || 999));
    for (const [mainKey, mv] of mainsSorted) {
      let line = findLine(mv.label, mv.statement, 'header');
      if (!line) {
        const [id] = await trx('fs_lines').insert({
          company_id: companyId, statement: mv.statement, parent_id: null,
          sort_order: (mv.num || 0) * 100, label: mv.label, kind: 'header',
        });
        line = { id, label: mv.label, statement: mv.statement, kind: 'header' };
        existing.push(line);
      }
      mainLineId[mainKey] = line.id;
    }

    // יצירת שורות (כותרות משנה)
    const subLineId = {}; // subKey -> fs_line id
    const subsSorted = [...subs.entries()].sort((a, b) => (a[1].num || 999) - (b[1].num || 999));
    for (const [subKey, sv] of subsSorted) {
      const mv = mains.get(sv.mainKey) || { statement: 'balance' };
      let line = findLine(sv.label, mv.statement, 'line');
      if (!line) {
        const [id] = await trx('fs_lines').insert({
          company_id: companyId, statement: mv.statement, parent_id: mainLineId[sv.mainKey] || null,
          sort_order: (sv.num || 0), label: sv.label, kind: 'line',
        });
        line = { id, label: sv.label, statement: mv.statement, kind: 'line' };
        existing.push(line);
      }
      subLineId[subKey] = line.id;
    }

    // מילוי האינדקס: סעיף -> fs_line של כותרת המשנה
    let mapped = 0;
    const existingMaps = await trx('index_map').where({ company_id: companyId });
    for (const [sectionCode, subKey] of sectionToSub.entries()) {
      const fsId = subKey ? subLineId[subKey] : null;
      const secName = (rows.find((r) => r.tb_section_code === sectionCode) || {}).tb_section_name || null;
      const cur = existingMaps.find((m) => m.tb_section_code === sectionCode);
      if (cur) {
        // אידמפוטנטי: לא דורסים מיפוי ידני קיים אלא ב-rebuild
        if (fsId && (rebuild || !cur.fs_line_id)) {
          await trx('index_map').where({ id: cur.id }).update({ fs_line_id: fsId, tb_section_name: secName, row_version: cur.row_version + 1 });
          mapped++;
        }
      } else {
        await trx('index_map').insert({ company_id: companyId, tb_section_code: sectionCode, tb_section_name: secName, fs_line_id: fsId || null });
        if (fsId) mapped++;
      }
    }

    return { headers: mains.size, lines: subs.size, sections: sectionToSub.size, mapped };
  });

  if (ctx) {
    const { logChange } = require('./audit');
    await logChange({ user: ctx.user, companyId, versionId: version.id },
      { entity: 'structure', action: rebuild ? 'rebuild' : 'build', after: result });
  }
  return result;
}

module.exports = { buildFromVersion, parsePrefixed };
