'use strict';
/* אימות: טעינה סטנדרטית מפוצלת לפי חברה + בניית מבנה + איחוד. */
const fs = require('fs');
const knex = require('./db');
const { parseStandard } = require('./services/standard-import');
const { buildFromVersion } = require('./services/build-structure');
const { computeReport, computeSectionTotals } = require('./services/report-engine');

const FILE = '/root/.claude/uploads/de62a35c-c66a-526c-921b-eb895f278ed0/738a6627-_____2.xlsx';

(async () => {
  try {
    const companies = await knex('companies');
    const period = await knex('periods').first();
    const buf = fs.readFileSync(FILE);
    const { groups } = await parseStandard(buf, companies);

    console.log('=== זיהוי חברות בקובץ ===');
    groups.forEach((g) => console.log(`  ${g.fileCompany}  → ${g.matchedCompanyName || '❌ לא זוהה'}  (${g.count} שורות)`));

    const memberVersionIds = [];
    for (const g of groups) {
      if (!g.matchedCompanyId) { console.log('דילוג על', g.fileCompany); continue; }
      // ניקוי מבנה קודם לחברה
      await knex('index_map').where({ company_id: g.matchedCompanyId }).del();
      await knex('fs_lines').where({ company_id: g.matchedCompanyId }).del();
      const [vid] = await knex('report_versions').insert({ company_id: g.matchedCompanyId, period_id: period.id, name: 'ייבוא סטנדרטי', status: 'draft' });
      const rows = g.rows.map((r) => ({ ...r, version_id: vid }));
      for (let i = 0; i < rows.length; i += 500) await knex('trial_balance_rows').insert(rows.slice(i, i + 500));
      const version = await knex('report_versions').where({ id: vid }).first();
      const st = await buildFromVersion(version, {});
      console.log(`  ✓ ${g.matchedCompanyName}: יובאו ${g.count}, מבנה ${st.lines} שורות, מופו ${st.mapped}/${st.sections}`);
      memberVersionIds.push(vid);
    }

    // === איחוד ===
    const grp = companies.find((c) => c.is_consolidated);
    await knex('index_map').where({ company_id: grp.id }).del();
    await knex('fs_lines').where({ company_id: grp.id }).del();
    const [cvid] = await knex('report_versions').insert({ company_id: grp.id, period_id: period.id, name: 'מאוחד', status: 'draft' });
    for (const mid of memberVersionIds) await knex('consolidation_members').insert({ consolidated_version_id: cvid, member_version_id: mid });
    const cversion = await knex('report_versions').where({ id: cvid }).first();
    const cst = await buildFromVersion(cversion, { sourceVersionIds: memberVersionIds });
    console.log(`\n=== מאוחד: ${memberVersionIds.length} בנות, מבנה ${cst.lines} שורות, ${cst.mapped}/${cst.sections} סעיפים ===`);

    const creport = await computeReport(cversion);
    console.log('שורות מאזן מאוחד:', creport.balance.length, '| רו"ה:', creport.pnl.length, '| לא ממופים:', creport.unmapped.length);

    // בדיקת אגרגציה: מזומנים מאוחד = סכום מזומנים של הבנות
    const cashLineC = creport.balance.find((l) => l.label.includes('מזומנים ושווי מזומנים') && l.kind === 'line');
    let sumMembers = 0;
    for (const mid of memberVersionIds) {
      const mv = await knex('report_versions').where({ id: mid }).first();
      const secs = await computeSectionTotals(mv);
      Object.values(secs).forEach((s) => { if (s.subHeader && s.subHeader.includes('מזומנים ושווי מזומנים') && !s.subHeader.includes('מוגבל')) sumMembers += s.net; });
    }
    console.log(`מזומנים מאוחד (שורת דוח): ${cashLineC ? Math.round(cashLineC.amount).toLocaleString() : 'n/a'}`);
    console.log(`סכום מזומנים של הבנות:   ${Math.round(sumMembers).toLocaleString()}`);
    const ok = cashLineC && Math.abs(cashLineC.amount - sumMembers) < 1 && creport.unmapped.length === 0;
    console.log(ok ? '\n✓ אימות איחוד עבר: הדוח המאוחד מצרף נכון את הבנות.' : '\n✗ פער באיחוד.');
    process.exitCode = ok ? 0 : 1;
  } catch (e) { console.error('שגיאה:', e); process.exitCode = 1; }
  finally { await knex.destroy(); }
})();
