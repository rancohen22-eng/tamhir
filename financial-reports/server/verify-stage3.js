'use strict';
/* אימות שלב 3: חוקי מיון אוטומטי + איחוד עם שיעור אחזקה (full/equity). */
const fs = require('fs');
const knex = require('./db');
const { parseStandard } = require('./services/standard-import');
const { buildFromVersion } = require('./services/build-structure');
const { computeReport } = require('./services/report-engine');
const { applyRules } = require('./services/reclass-rules');
const { ensureSyntheticLines } = require('./services/consolidation');
const { computeSectionTotals } = require('./services/report-engine');
const { ensureSectionMapped, parsePrefixed } = require('./services/build-structure');

const FILE = '/root/.claude/uploads/de62a35c-c66a-526c-921b-eb895f278ed0/738a6627-_____2.xlsx';
const totalAll = (rep) => [...rep.balance, ...rep.pnl].filter((l) => l.kind === 'line').reduce((s, l) => s + (Number(l.amount) || 0), 0);

async function loadCompany(g, periodId) {
  await knex('fs_lines').where({ company_id: g.matchedCompanyId }).del();
  await knex('index_map').where({ company_id: g.matchedCompanyId }).del();
  const [vid] = await knex('report_versions').insert({ company_id: g.matchedCompanyId, period_id: periodId, name: 'ייבוא', status: 'draft' });
  for (let i = 0; i < g.rows.length; i += 500) await knex('trial_balance_rows').insert(g.rows.slice(i, i + 500).map((r) => ({ ...r, version_id: vid })));
  const v = await knex('report_versions').where({ id: vid }).first();
  await buildFromVersion(v, {});
  return v;
}

(async () => {
  try {
    const companies = await knex('companies');
    const period = await knex('periods').first();
    const { groups } = await parseStandard(fs.readFileSync(FILE), companies);
    const gAir = groups.find((x) => x.matchedCompanyName.includes('קווי תעופה'));
    const gClk = groups.find((x) => x.matchedCompanyName.includes('קליק'));

    // ---- חוק מיון: יתרות שליליות במזומנים ושווי מזומנים -> משיכות יתר ----
    const air = await loadCompany(gAir, period.id);
    const before = await computeReport(air);
    const cashBefore = before.balance.find((l) => l.label.includes('מזומנים ושווי מזומנים') && l.kind === 'line');
    await knex('reclass_rules').insert({
      company_id: gAir.matchedCompanyId, name: 'משיכות יתר', active: true,
      source_scope_type: 'subheader', source_scope_value: 'מזומנים ושווי מזומנים',
      sign: 'negative', level: 'account', target_section_code: '__OVERDRAFT__', target_section_name: 'משיכות יתר',
    });
    const applied = await applyRules(air, {});
    const after = await computeReport(air);
    const cashAfter = after.balance.find((l) => l.label.includes('מזומנים ושווי מזומנים') && l.kind === 'line');
    console.log('=== חוק מיון: יתרות שליליות במזומנים → משיכות יתר ===');
    console.log(`נוצרו ${applied.generated} פקודות מיון אוטומטיות`);
    console.log(`מזומנים בדוח: לפני=${Math.round(cashBefore.amount).toLocaleString()} אחרי=${Math.round(cashAfter.amount).toLocaleString()} (אמור לגדול — הוצאו השליליים)`);
    console.log(`בדיקת ניטרליות (סך כל השורות): לפני=${totalAll(before).toFixed(2)} אחרי=${totalAll(after).toFixed(2)} (אמור להיות זהה)`);
    const reclassNeutral = Math.abs(totalAll(before) - totalAll(after)) < 1;
    const cashGrew = cashAfter.amount >= cashBefore.amount;

    // ---- איחוד עם אחזקה: קווי תעופה 100% (full) + קליק 50% (equity) ----
    const clk = await loadCompany(gClk, period.id);
    const grp = companies.find((c) => c.is_consolidated);
    await knex('fs_lines').where({ company_id: grp.id }).del();
    await knex('index_map').where({ company_id: grp.id }).del();
    const [cvid] = await knex('report_versions').insert({ company_id: grp.id, period_id: period.id, name: 'מאוחד', status: 'draft' });
    await knex('consolidation_members').insert([
      { consolidated_version_id: cvid, member_version_id: air.id, holding_pct: 100, method: 'full' },
      { consolidated_version_id: cvid, member_version_id: clk.id, holding_pct: 50, method: 'equity' },
    ]);
    const cversion = await knex('report_versions').where({ id: cvid }).first();
    await buildFromVersion(cversion, { sourceVersionIds: [air.id] }); // מבנה מהחברה המאוחדת (full)
    await ensureSyntheticLines(grp.id);
    // מיפוי סעיפים מצטברים לא-ממופים (כמו ב-route)
    const csecs = await computeSectionTotals(cversion);
    for (const s of Object.values(csecs)) {
      const n = parsePrefixed(s.mainHeader).num;
      await ensureSectionMapped(grp.id, s.code, s.name, (n != null && n <= 3) ? 'balance' : 'pnl');
    }
    const crep = await computeReport(cversion);
    const invLine = crep.balance.find((l) => l.label.includes('השקעות בחברות מוחזקות (שווי מאזני)'));
    const resLine = crep.pnl.find((l) => l.label.includes('חלק ברווחי'));
    console.log('\n=== איחוד: קווי תעופה 100% (full) + קליק 50% (equity) ===');
    console.log(`שורת "השקעות בחברות מוחזקות (אקוויטי)": ${invLine ? Math.round(invLine.amount).toLocaleString() : 'חסר'}`);
    console.log(`שורת "חלק ברווחי חברות מוחזקות": ${resLine ? Math.round(resLine.amount).toLocaleString() : 'חסר'}`);
    console.log(`סעיפים לא ממופים במאוחד: ${crep.unmapped.length}`);

    const equityOk = invLine && resLine && (invLine.amount !== 0 || resLine.amount !== 0);
    const ok = applied.generated > 0 && reclassNeutral && cashGrew && equityOk;
    console.log(ok ? '\n✓ אימות שלב 3 עבר.' : '\n✗ יש פער.');
    process.exitCode = ok ? 0 : 1;
  } catch (e) { console.error('שגיאה:', e); process.exitCode = 1; }
  finally { await knex.destroy(); }
})();
