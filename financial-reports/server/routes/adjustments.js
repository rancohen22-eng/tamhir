'use strict';
const router = require('express').Router();
const knex = require('../db');
const { requireAuth } = require('../middleware/auth');
const { resolveVersion } = require('../middleware/version');
const { logChange } = require('../services/audit');

// רשימת פקודות נוספות לגרסה
router.get('/', requireAuth, resolveVersion('view'), async (req, res) => {
  const rows = await knex('adjustments').where({ version_id: req.version.id }).orderBy(['entry_no', 'id']);
  res.json(rows);
});

// יצירת פקודה
router.post('/', requireAuth, resolveVersion('edit'), async (req, res) => {
  const b = req.body;
  const [id] = await knex('adjustments').insert({
    version_id: req.version.id,
    entry_no: b.entry_no || null,
    account_no: b.account_no || null,
    account_name: b.account_name || null,
    tb_section_code: b.tb_section_code || null,
    tb_section_name: b.tb_section_name || null,
    purpose: b.purpose || null,
    amount: Number(b.amount) || 0,
    created_by: req.user.id,
  });
  await logChange({ user: req.user, companyId: req.companyId, versionId: req.version.id },
    { entity: 'adjustment', entityId: id, action: 'create', after: b });
  res.json({ id });
});

// עדכון פקודה (optimistic lock)
router.patch('/:id', requireAuth, resolveVersion('edit'), async (req, res) => {
  const row = await knex('adjustments').where({ id: req.params.id, version_id: req.version.id }).first();
  if (!row) return res.status(404).json({ error: 'פקודה לא נמצאה' });
  if (req.body.row_version != null && Number(req.body.row_version) !== row.row_version) {
    return res.status(409).json({ error: 'הפקודה עודכנה על ידי משתמש אחר. רעננו ונסו שוב.', current: row });
  }
  const patch = { row_version: row.row_version + 1, updated_at: knex.fn.now() };
  ['entry_no', 'account_no', 'account_name', 'tb_section_code', 'tb_section_name', 'purpose'].forEach((k) => {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  });
  if (req.body.amount !== undefined) patch.amount = Number(req.body.amount) || 0;
  await knex('adjustments').where({ id: row.id }).update(patch);
  await logChange({ user: req.user, companyId: req.companyId, versionId: req.version.id },
    { entity: 'adjustment', entityId: row.id, action: 'update', before: row, after: patch });
  res.json({ ok: true });
});

// מחיקת פקודה
router.delete('/:id', requireAuth, resolveVersion('edit'), async (req, res) => {
  const row = await knex('adjustments').where({ id: req.params.id, version_id: req.version.id }).first();
  if (!row) return res.status(404).json({ error: 'פקודה לא נמצאה' });
  await knex('adjustments').where({ id: row.id }).del();
  await logChange({ user: req.user, companyId: req.companyId, versionId: req.version.id },
    { entity: 'adjustment', entityId: row.id, action: 'delete', before: row });
  res.json({ ok: true });
});

module.exports = router;
