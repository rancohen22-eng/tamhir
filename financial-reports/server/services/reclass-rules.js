'use strict';
const knex = require('../db');

/*
 * החלת חוקי מיון אוטומטי על גרסה: מחוללת פקודות מיון (reclassifications)
 * מתויגות source='rule'. אידמפוטנטי — מוחקת קודם את המיוצרות ומחוללת מחדש.
 * פקודות ידניות (source='manual') אינן נפגעות.
 *
 * דוגמה: "מיין את כל היתרות השליליות בסעיף המזומנים ושווי מזומנים לסעיף משיכות יתר".
 */
async function applyRules(version, ctx) {
  const companyId = version.company_id;
  const rules = await knex('reclass_rules').where({ company_id: companyId, active: true }).orderBy('sort_order');
  const generated = [];

  for (const rule of rules) {
    // איסוף שורות המאזן לפי scope
    const q = knex('trial_balance_rows').where({ version_id: version.id });
    if (rule.source_scope_type === 'section') q.andWhere('tb_section_code', rule.source_scope_value);
    else if (rule.source_scope_type === 'subheader') q.andWhere('sub_header', 'like', `%${rule.source_scope_value || ''}%`);
    const rows = await q;

    const matchSign = (v) => rule.sign === 'all' ? v !== 0 : (rule.sign === 'negative' ? v < 0 : v > 0);

    if (rule.level === 'section') {
      // נטו per סעיף מקור
      const bySec = {};
      rows.forEach((r) => { const k = r.tb_section_code; if (!bySec[k]) bySec[k] = { name: r.tb_section_name, net: 0 }; bySec[k].net += Number(r.amount) || 0; });
      Object.entries(bySec).forEach(([sec, o]) => {
        if (matchSign(o.net)) generated.push({
          version_id: version.id, from_section: sec, to_section: rule.target_section_code,
          account_no: null, account_name: null, note: `[חוק] ${rule.name}`,
          amount: o.net, source: 'rule', rule_id: rule.id, created_by: ctx && ctx.user ? ctx.user.id : null,
        });
      });
    } else {
      // רמת חשבון: נטו per חשבון
      const byAcc = {};
      rows.forEach((r) => {
        const k = r.account_no + '|' + r.tb_section_code;
        if (!byAcc[k]) byAcc[k] = { account_no: r.account_no, account_name: r.account_name, section: r.tb_section_code, net: 0 };
        byAcc[k].net += Number(r.amount) || 0;
      });
      Object.values(byAcc).forEach((a) => {
        if (matchSign(a.net)) generated.push({
          version_id: version.id, from_section: a.section, to_section: rule.target_section_code,
          account_no: a.account_no, account_name: a.account_name, note: `[חוק] ${rule.name}`,
          amount: a.net, source: 'rule', rule_id: rule.id, created_by: ctx && ctx.user ? ctx.user.id : null,
        });
      });
    }
  }

  const count = await knex.transaction(async (trx) => {
    await trx('reclassifications').where({ version_id: version.id, source: 'rule' }).del();
    for (let i = 0; i < generated.length; i += 500) await trx('reclassifications').insert(generated.slice(i, i + 500));
    return generated.length;
  });

  // מוודא שסעיפי היעד ממופים לשורת דוח (כדי שהמיון יופיע בדוח ויישאר ניטרלי)
  const { ensureSectionMapped } = require('./build-structure');
  for (const rule of rules) {
    if (rule.target_section_code) await ensureSectionMapped(companyId, rule.target_section_code, rule.target_section_name || rule.target_section_code, 'balance');
  }

  if (ctx) {
    const { logChange } = require('./audit');
    await logChange({ user: ctx.user, companyId, versionId: version.id }, { entity: 'reclass_rules', action: 'apply', after: { generated: count } });
  }
  return { generated: count, rules: rules.length };
}

module.exports = { applyRules };
