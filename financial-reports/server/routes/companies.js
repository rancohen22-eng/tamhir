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
    aliases: req.body.aliases || null,
  });
  await logChange({ user: req.user, companyId: id }, { entity: 'company', entityId: id, action: 'create', after: { name } });
  res.json({ id });
});

// עדכון חברה (מנהל)
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const company = await knex('companies').where({ id: req.params.id }).first();
  if (!company) return res.status(404).json({ error: 'חברה לא נמצאה' });
  const patch = {};
  ['name', 'code', 'is_consolidated', 'sort_order', 'aliases'].forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  await knex('companies').where({ id: company.id }).update(patch);
  await logChange({ user: req.user, companyId: company.id }, { entity: 'company', entityId: company.id, action: 'update', before: company, after: patch });
  res.json({ ok: true });
});

module.exports = router;
