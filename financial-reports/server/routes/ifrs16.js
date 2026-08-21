'use strict';
const router = require('express').Router();
const knex = require('../db');
const { requireAuth, requireCompanyLevel } = require('../middleware/auth');
const { logChange } = require('../services/audit');
const { computeIFRS16, reconcileIFRS16, generateIFRS16Entries } = require('../services/ifrs16');
const { computeReport } = require('../services/report-engine');

async function withVersion(req, res, minLevel, handler) {
  const id = Number(req.params.versionId || req.query.version_id || req.body.version_id || 0);
  if (!id) return res.status(400).json({ error: 'חסר מזהה גרסה' });
  const v = await knex('report_versions').where({ id }).first();
  if (!v) return res.status(404).json({ error: 'גרסה לא נמצאה' });
  req.companyId = v.company_id; req.version = v;
  return requireCompanyLevel(minLevel)(req, res, () => handler(v));
}

// סיכום IFRS16 + בדיקת התאמה
router.get('/:versionId', requireAuth, (req, res) => withVersion(req, res, 'view', async (v) => {
  const data = await computeIFRS16(v);
  const report = await computeReport(v);
  const recon = await reconcileIFRS16(v, report);
  res.json({ ...data, reconciliation: recon });
}));

// ייצור פקודת יומן מההסכמים
router.post('/:versionId/generate-entry', requireAuth, (req, res) => withVersion(req, res, 'edit', async (v) => {
  const result = await generateIFRS16Entries(v, req.user.id);
  await logChange({ user: req.user, companyId: v.company_id, versionId: v.id }, { entity: 'ifrs16', action: 'generate-entry', after: result });
  res.json(result);
}));

// יצירת הסכם + תנועה
router.post('/:versionId/agreement', requireAuth, (req, res) => withVersion(req, res, 'edit', async (v) => {
  const b = req.body;
  const [agId] = await knex('ifrs16_agreements').insert({ company_id: v.company_id, name: b.name || 'הסכם', currency: b.currency || 'USD', notes: b.notes || null });
  await knex('ifrs16_movements').insert({ agreement_id: agId, version_id: v.id, ...pickMovement(b) });
  await logChange({ user: req.user, companyId: v.company_id, versionId: v.id }, { entity: 'ifrs16', entityId: agId, action: 'create', after: { name: b.name } });
  res.json({ id: agId });
}));

// עדכון תנועת הסכם (upsert per גרסה)
router.put('/:versionId/movement', requireAuth, (req, res) => withVersion(req, res, 'edit', async (v) => {
  const agId = Number(req.body.agreement_id);
  if (!agId) return res.status(400).json({ error: 'חסר הסכם' });
  const existing = await knex('ifrs16_movements').where({ agreement_id: agId, version_id: v.id }).first();
  const patch = pickMovement(req.body);
  if (existing) await knex('ifrs16_movements').where({ id: existing.id }).update({ ...patch, row_version: existing.row_version + 1 });
  else await knex('ifrs16_movements').insert({ agreement_id: agId, version_id: v.id, ...patch });
  if (req.body.name) await knex('ifrs16_agreements').where({ id: agId }).update({ name: req.body.name });
  await logChange({ user: req.user, companyId: v.company_id, versionId: v.id }, { entity: 'ifrs16', entityId: agId, action: 'update' });
  res.json({ ok: true });
}));

// מחיקת הסכם
router.delete('/:versionId/agreement/:agId', requireAuth, (req, res) => withVersion(req, res, 'edit', async (v) => {
  await knex('ifrs16_agreements').where({ id: req.params.agId, company_id: v.company_id }).del();
  await logChange({ user: req.user, companyId: v.company_id, versionId: v.id }, { entity: 'ifrs16', entityId: req.params.agId, action: 'delete' });
  res.json({ ok: true });
}));

function pickMovement(b) {
  const o = {};
  ['liab_open', 'liab_add', 'liab_disposal', 'liab_payment', 'liab_interest', 'liab_fx',
    'asset_open', 'asset_add', 'asset_disposal', 'asset_depreciation', 'current_portion'].forEach((k) => { if (b[k] !== undefined) o[k] = Number(b[k]) || 0; });
  return o;
}

module.exports = router;
