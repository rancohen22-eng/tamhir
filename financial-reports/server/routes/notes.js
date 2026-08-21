'use strict';
const router = require('express').Router();
const knex = require('../db');
const { requireAuth } = require('../middleware/auth');
const { resolveVersion } = require('../middleware/version');
const { logChange } = require('../services/audit');

// רשימת ביאורים לגרסה (כולל מספרי הביאור שבשורות הדוח, גם אם טרם נכתב מלל)
router.get('/', requireAuth, resolveVersion('view'), async (req, res) => {
  const notes = await knex('report_notes').where({ version_id: req.version.id }).orderBy(['sort_order', 'note_ref']);
  // מספרי ביאור שמופיעים בשורות הדוח של החברה
  const refs = await knex('fs_lines').where({ company_id: req.companyId }).whereNotNull('note_ref').distinct('note_ref').pluck('note_ref');
  res.json({ notes, refs: refs.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), 'he', { numeric: true })) });
});

// שמירת/עדכון ביאור (upsert לפי version+note_ref)
router.put('/', requireAuth, resolveVersion('edit'), async (req, res) => {
  const { note_ref, title, body, sort_order } = req.body;
  if (!note_ref) return res.status(400).json({ error: 'חסר מספר ביאור' });
  const existing = await knex('report_notes').where({ version_id: req.version.id, note_ref }).first();
  if (existing) await knex('report_notes').where({ id: existing.id }).update({ title, body, sort_order: sort_order ?? existing.sort_order, updated_at: knex.fn.now() });
  else await knex('report_notes').insert({ version_id: req.version.id, note_ref, title: title || null, body: body || null, sort_order: sort_order || 0 });
  await logChange({ user: req.user, companyId: req.companyId, versionId: req.version.id }, { entity: 'note', entityId: note_ref, action: 'update' });
  res.json({ ok: true });
});

module.exports = router;
