'use strict';
const router = require('express').Router();
const knex = require('../db');
const { requireAuth, requireCompanyLevel } = require('../middleware/auth');
const { logChange } = require('../services/audit');

// עץ שורות הדוח לחברה (company_id בשאילתה)
router.get('/', requireAuth, requireCompanyLevel('view'), async (req, res) => {
  const rows = await knex('fs_lines').where({ company_id: req.companyId })
    .orderBy(['statement', 'sort_order', 'id']);
  res.json(rows);
});

// יצירת שורת דוח
router.post('/', requireAuth, requireCompanyLevel('edit'), async (req, res) => {
  const { statement, parent_id, sort_order, label, note_ref, kind } = req.body;
  if (!statement || !label) return res.status(400).json({ error: 'חסרים סוג דוח / תיאור' });
  const [id] = await knex('fs_lines').insert({
    company_id: req.companyId, statement, parent_id: parent_id || null,
    sort_order: sort_order || 0, label, note_ref: note_ref || null, kind: kind || 'line',
  });
  await logChange({ user: req.user, companyId: req.companyId }, { entity: 'fs_line', entityId: id, action: 'create', after: { label } });
  res.json({ id });
});

// עדכון שורת דוח
router.patch('/:id', requireAuth, requireCompanyLevel('edit'), async (req, res) => {
  const line = await knex('fs_lines').where({ id: req.params.id, company_id: req.companyId }).first();
  if (!line) return res.status(404).json({ error: 'שורה לא נמצאה' });
  const patch = {};
  ['parent_id', 'sort_order', 'label', 'note_ref', 'kind', 'statement'].forEach((k) => {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  });
  await knex('fs_lines').where({ id: line.id }).update(patch);
  await logChange({ user: req.user, companyId: req.companyId }, { entity: 'fs_line', entityId: line.id, action: 'update', before: line, after: patch });
  res.json({ ok: true });
});

// מחיקת שורת דוח
router.delete('/:id', requireAuth, requireCompanyLevel('edit'), async (req, res) => {
  const line = await knex('fs_lines').where({ id: req.params.id, company_id: req.companyId }).first();
  if (!line) return res.status(404).json({ error: 'שורה לא נמצאה' });
  await knex('fs_lines').where({ id: line.id }).del();
  await logChange({ user: req.user, companyId: req.companyId }, { entity: 'fs_line', entityId: line.id, action: 'delete', before: line });
  res.json({ ok: true });
});

module.exports = router;
