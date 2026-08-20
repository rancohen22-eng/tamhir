'use strict';
const knex = require('../db');

// סעיפים סינתטיים שנוצרים באיחוד (אקוויטי / זכויות מיעוט)
const SYNTHETIC = {
  EQ_INVEST: { code: '__EQ_INVEST__', name: 'השקעות בחברות מוחזקות (שווי מאזני)', statement: 'balance' },
  EQ_RESULT: { code: '__EQ_RESULT__', name: 'חלק ברווחי (בהפסדי) חברות מוחזקות', statement: 'pnl' },
  MINORITY: { code: '__MINORITY__', name: 'זכויות שאינן מקנות שליטה', statement: 'balance' },
};

// מוודא שקיימות שורות דוח + מיפוי אינדקס לסעיפים הסינתטיים בחברת המאוחד
async function ensureSyntheticLines(companyId) {
  for (const key of Object.keys(SYNTHETIC)) {
    const s = SYNTHETIC[key];
    let line = await knex('fs_lines').where({ company_id: companyId, label: s.name, statement: s.statement }).first();
    if (!line) {
      const [id] = await knex('fs_lines').insert({ company_id: companyId, statement: s.statement, kind: 'line', label: s.name, sort_order: 900 });
      line = { id };
    }
    const map = await knex('index_map').where({ company_id: companyId, tb_section_code: s.code }).first();
    if (map) await knex('index_map').where({ id: map.id }).update({ fs_line_id: line.id, tb_section_name: s.name });
    else await knex('index_map').insert({ company_id: companyId, tb_section_code: s.code, tb_section_name: s.name, fs_line_id: line.id });
  }
}

// גרסאות הבנות המרכיבות גרסת מאוחד
async function memberVersionIds(consolidatedVersionId) {
  const rows = await knex('consolidation_members').where({ consolidated_version_id: consolidatedVersionId });
  return rows.map((r) => r.member_version_id);
}

// פרטי חברות (member_version_id, holding_pct, method) לצורך מנוע האיחוד
async function memberDetails(consolidatedVersionId) {
  return knex('consolidation_members').where({ consolidated_version_id: consolidatedVersionId })
    .select('member_version_id', 'holding_pct', 'method');
}

// פרטי הבנות (עם שם חברה) לתצוגה
async function memberVersions(consolidatedVersionId) {
  const rows = await knex('consolidation_members as m')
    .join('report_versions as v', 'v.id', 'm.member_version_id')
    .join('companies as c', 'c.id', 'v.company_id')
    .where('m.consolidated_version_id', consolidatedVersionId)
    .select('v.id', 'v.name', 'v.company_id', 'c.name as company_name', 'v.status', 'm.holding_pct', 'm.method');
  return rows;
}

// האם הגרסה שייכת לחברת איחוד
async function isConsolidatedVersion(version) {
  const c = await knex('companies').where({ id: version.company_id }).first();
  return !!(c && c.is_consolidated);
}

module.exports = { memberVersionIds, memberDetails, memberVersions, isConsolidatedVersion, SYNTHETIC, ensureSyntheticLines };
