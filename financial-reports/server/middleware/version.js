'use strict';
const knex = require('../db');
const { requireCompanyLevel } = require('./auth');

/*
 * טוען גרסה מ-body/query, קובע req.companyId ו-req.version,
 * ואוכף רמת הרשאה (view/edit) לחברת הגרסה.
 */
function resolveVersion(minLevel) {
  return async function (req, res, next) {
    const versionId = Number(req.body.version_id || req.query.version_id || 0);
    if (!versionId) return res.status(400).json({ error: 'חסר מזהה גרסה' });
    const v = await knex('report_versions').where({ id: versionId }).first();
    if (!v) return res.status(404).json({ error: 'גרסה לא נמצאה' });
    req.companyId = v.company_id;
    req.version = v;
    return requireCompanyLevel(minLevel)(req, res, next);
  };
}

module.exports = { resolveVersion };
