'use strict';
const router = require('express').Router();
const knex = require('../db');
const { requireAuth } = require('../middleware/auth');
const { resolveVersion } = require('../middleware/version');
const { logChange } = require('../services/audit');

// רשימת פקודות מיון לגרסה
router.get('/', requireAuth, resolveVersion('view'), async (req, res) => {
  const rows = await knex('reclassifications').where({ version_id: req.version.id }).orderBy('id');
  res.json(rows);
});

// יצירת מיון
router.post('/', requireAuth, resolveVersion('edit'), async (req, res) => {
  const b = req.body;
  const [id] = await knex('reclassifications').insert({
    version_id: req.version.id,
    account_no: b.account_no || null,
    account_name: b.account_name || null,
    from_section: b.from_section || null,
    to_section: b.to_section || null,
    note: b.note || null,
    amount: Number(b.amount) || 0,
    created_by: req.user.id,
  });
  await logChange({ user: req.user, companyId: req.companyId, versionId: req.version.id },
    { entity: 'reclass', entityId: id, action: 'create', after: b });
  res.json({ id });
});

// עדכון מיון (optimistic lock)
router.patch('/:id', requireAuth, resolveVersion('edit'), async (req, res) => {
  const row = await knex('reclassifications').where({ id: req.params.id, version_id: req.version.id }).first();
  if (!row) return res.status(404).json({ error: 'מיון לא נמצא' });
  if (req.body.row_version != null && Number(req.body.row_version) !== row.row_version) {
    return res.status(409).json({ error: 'המיון עודכן על ידי משתמש אחר. רעננו ונסו שוב.', current: row });
  }
  const patch = { row_version: row.row_version + 1, updated_at: knex.fn.now() };
  ['account_no', 'account_name', 'from_section', 'to_section', 'note'].forEach((k) => {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  });
  if (req.body.amount !== undefined) patch.amount = Number(req.body.amount) || 0;
  await knex('reclassifications').where({ id: row.id }).update(patch);
  await logChange({ user: req.user, companyId: req.companyId, versionId: req.version.id },
    { entity: 'reclass', entityId: row.id, action: 'update', before: row, after: patch });
  res.json({ ok: true });
});

// מחיקת מיון
router.delete('/:id', requireAuth, resolveVersion('edit'), async (req, res) => {
  const row = await knex('reclassifications').where({ id: req.params.id, version_id: req.version.id }).first();
  if (!row) return res.status(404).json({ error: 'מיון לא נמצא' });
  await knex('reclassifications').where({ id: row.id }).del();
  await logChange({ user: req.user, companyId: req.companyId, versionId: req.version.id },
    { entity: 'reclass', entityId: row.id, action: 'delete', before: row });
  res.json({ ok: true });
});

module.exports = router;
