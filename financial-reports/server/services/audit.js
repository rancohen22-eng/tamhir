'use strict';
const knex = require('../db');

/*
 * רישום שינוי בלוג. נקרא מכל route שמבצע mutation.
 * ctx = { user, companyId, versionId }
 */
async function logChange(ctx, { entity, entityId, action, before, after }) {
  try {
    await knex('audit_log').insert({
      user_id: ctx.user ? ctx.user.id : null,
      username: ctx.user ? ctx.user.username : null,
      entity,
      entity_id: entityId != null ? String(entityId) : null,
      action,
      company_id: ctx.companyId || null,
      version_id: ctx.versionId || null,
      before_json: before != null ? JSON.stringify(before) : null,
      after_json: after != null ? JSON.stringify(after) : null,
    });
  } catch (e) {
    // לוג לא אמור להפיל פעולה עסקית
    console.error('audit log failed:', e.message);
  }
}

module.exports = { logChange };
