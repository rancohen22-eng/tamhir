'use strict';
const knex = require('../db');

// גרסאות הבנות המרכיבות גרסת מאוחד
async function memberVersionIds(consolidatedVersionId) {
  const rows = await knex('consolidation_members').where({ consolidated_version_id: consolidatedVersionId });
  return rows.map((r) => r.member_version_id);
}

// פרטי הבנות (עם שם חברה) לתצוגה
async function memberVersions(consolidatedVersionId) {
  const ids = await memberVersionIds(consolidatedVersionId);
  if (!ids.length) return [];
  return knex('report_versions as v')
    .join('companies as c', 'c.id', 'v.company_id')
    .whereIn('v.id', ids)
    .select('v.id', 'v.name', 'v.company_id', 'c.name as company_name', 'v.status');
}

// האם הגרסה שייכת לחברת איחוד
async function isConsolidatedVersion(version) {
  const c = await knex('companies').where({ id: version.company_id }).first();
  return !!(c && c.is_consolidated);
}

module.exports = { memberVersionIds, memberVersions, isConsolidatedVersion };
