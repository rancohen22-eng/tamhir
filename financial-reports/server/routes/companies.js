'use strict';
const router = require('express').Router();
const knex = require('../db');
const { requireAuth, requireAdmin, permissionLevel } = require('../middleware/auth');
const { logChange } = require('../services/audit');

// רשימת חברות שהמשתמש רשאי לראות (עם רמת ההרשאה)
router.get('/', requireAuth, async (req, res) => {
  const all = await knex('companies').orderBy('sort_order');
  const out = [];
  for (const c of all) {
    const level = await permissionLevel(req.user, c.id);
    if (level) out.push({ ...c, level });
  }
  res.json(out);
});

// יצירת חברה (מנהל)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, code, is_consolidated, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'חסר שם חברה' });
  const [id] = await knex('companies').insert({
    name, code: code || null, is_consolidated: !!is_consolidated, sort_order: sort_order || 0,
  });
  await logChange({ user: req.user, companyId: id }, { entity: 'company', entityId: id, action: 'create', after: { name } });
  res.json({ id });
});

module.exports = router;
