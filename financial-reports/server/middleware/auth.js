'use strict';
const knex = require('../db');

// דורש התחברות
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'נדרשת התחברות' });
  }
  next();
}

// דורש הרשאת מנהל
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'נדרשת הרשאת מנהל' });
  }
  next();
}

// טוען את המשתמש הנוכחי ל-req.user (אם מחובר)
async function loadUser(req, res, next) {
  if (req.session && req.session.userId) {
    req.user = await knex('users').where({ id: req.session.userId, is_active: true }).first();
    if (!req.user) { req.session.userId = null; }
  }
  next();
}

/*
 * בדיקת רמת הרשאה לחברה נתונה.
 * מנהל = תמיד edit. אחרת מחפשים ב-permissions (company_id ספציפי או כללי null).
 * מחזיר 'edit' | 'view' | null.
 */
async function permissionLevel(user, companyId) {
  if (!user) return null;
  if (user.is_admin) return 'edit';
  const rows = await knex('permissions')
    .where({ user_id: user.id })
    .andWhere(function () { this.where('company_id', companyId).orWhereNull('company_id'); });
  if (rows.some((r) => r.level === 'edit')) return 'edit';
  if (rows.some((r) => r.level === 'view')) return 'view';
  return null;
}

// middleware factory: דורש רמה מינימלית ('view'/'edit') לחברה שנשלחה בבקשה.
// מזהה את החברה מ-req.body.company_id / req.query.company_id / req.companyId.
function requireCompanyLevel(minLevel) {
  return async function (req, res, next) {
    const companyId = Number(
      req.companyId || req.body.company_id || req.query.company_id || 0
    );
    if (!companyId) return res.status(400).json({ error: 'חסר מזהה חברה' });
    const level = await permissionLevel(req.user, companyId);
    if (!level) return res.status(403).json({ error: 'אין הרשאה לחברה זו' });
    if (minLevel === 'edit' && level !== 'edit') {
      return res.status(403).json({ error: 'נדרשת הרשאת עריכה' });
    }
    req.companyId = companyId;
    req.permLevel = level;
    next();
  };
}

module.exports = {
  requireAuth, requireAdmin, loadUser, permissionLevel, requireCompanyLevel,
};
