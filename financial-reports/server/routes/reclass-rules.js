'use strict';
const router = require('express').Router();
const knex = require('../db');
const { requireAuth, requireCompanyLevel } = require('../middleware/auth');
const { logChange } = require('../services/audit');
const { applyRules } = require('../services/reclass-rules');

// רשימת חוקי מיון לחברה
router.get('/', requireAuth, requireCompanyLevel('view'), async (req, res) => {
  const rows = await knex('reclass_rules').where({ company_id: req.companyId }).orderBy('sort_order');
  res.json(rows);
});

// יצירת חוק
router.post('/', requireAuth, requireCompanyLevel('edit'), async (req, res) => {
  const b = req.body;
  if (!b.name || !b.target_section_code) return res.status(400).json({ error: 'חסרים שם או סעיף יעד' });
  const [id] = await knex('reclass_rules').insert({
    company_id: req.companyId, name: b.name, active: b.active !== false, sort_order: b.sort_order || 0,
    source_scope_type: b.source_scope_type || 'subheader', source_scope_value: b.source_scope_value || null,
    sign: b.sign || 'negative', level: b.level || 'account',
    target_section_code: b.target_section_code, target_section_name: b.target_section_name || null,
  });
  await logChange({ user: req.user, companyId: req.companyId }, { entity: 'reclass_rule', entityId: id, action: 'create', after: { name: b.name } });
  res.json({ id });
});

// עדכון חוק
router.patch('/:id', requireAuth, requireCompanyLevel('edit'), async (req, res) => {
  const rule = await knex('reclass_rules').where({ id: req.params.id, company_id: req.companyId }).first();
  if (!rule) return res.status(404).json({ error: 'חוק לא נמצא' });
  const patch = {};
  ['name', 'active', 'sort_order', 'source_scope_type', 'source_scope_value', 'sign', 'level', 'target_section_code', 'target_section_name'].forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  await knex('reclass_rules').where({ id: rule.id }).update(patch);
  await logChange({ user: req.user, companyId: req.companyId }, { entity: 'reclass_rule', entityId: rule.id, action: 'update', after: patch });
  res.json({ ok: true });
});

// מחיקת חוק (וגם המיונים שהוא ייצר)
router.delete('/:id', requireAuth, requireCompanyLevel('edit'), async (req, res) => {
  const rule = await knex('reclass_rules').where({ id: req.params.id, company_id: req.companyId }).first();
  if (!rule) return res.status(404).json({ error: 'חוק לא נמצא' });
  await knex('reclassifications').where({ rule_id: rule.id }).del();
  await knex('reclass_rules').where({ id: rule.id }).del();
  await logChange({ user: req.user, companyId: req.companyId }, { entity: 'reclass_rule', entityId: rule.id, action: 'delete', before: rule });
  res.json({ ok: true });
});

// החלת החוקים על גרסה (מחולל פקודות מיון אוטומטיות)
router.post('/apply', requireAuth, async (req, res) => {
  const v = await knex('report_versions').where({ id: req.body.version_id }).first();
  if (!v) return res.status(404).json({ error: 'גרסה לא נמצאה' });
  req.companyId = v.company_id;
  return requireCompanyLevel('edit')(req, res, async () => {
    const r = await applyRules(v, { user: req.user });
    res.json(r);
  });
});

module.exports = router;
