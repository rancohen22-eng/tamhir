'use strict';
const router = require('express').Router();
const knex = require('../db');
const { requireAuth, requireCompanyLevel } = require('../middleware/auth');
const { logChange } = require('../services/audit');
const { computeReport } = require('../services/report-engine');
const { computeCashflow } = require('../services/cashflow-engine');
const { computeEquity } = require('../services/equity-engine');
const { resolveOpeningVersion } = require('../services/comparative');
const { seedCashflow } = require('../services/seed-cashflow');
const { computeWorksheet } = require('../services/cashflow-worksheet');

async function withVersion(req, res, minLevel, handler) {
  const id = Number(req.params.versionId || req.body.version_id || req.query.version_id || 0);
  if (!id) return res.status(400).json({ error: 'חסר מזהה גרסה' });
  const v = await knex('report_versions').where({ id }).first();
  if (!v) return res.status(404).json({ error: 'גרסה לא נמצאה' });
  req.companyId = v.company_id; req.version = v;
  return requireCompanyLevel(minLevel)(req, res, () => handler(v));
}

// כל 4 הדוחות הראשיים
router.get('/:versionId', requireAuth, (req, res) => withVersion(req, res, 'view', async (v) => {
  const [report, cashflow, equity, opening] = await Promise.all([
    computeReport(v), computeCashflow(v), computeEquity(v), resolveOpeningVersion(v),
  ]);
  res.json({
    balance: report.balance, pnl: report.pnl, unmapped: report.unmapped,
    cashflow, equity,
    opening: opening ? { id: opening.id, name: opening.name } : null,
    prior_version_id: v.prior_version_id || null,
  });
}));

// זריעת מבנה תזרים ברירת-מחדל לחברה
router.post('/:versionId/cashflow/seed', requireAuth, (req, res) => withVersion(req, res, 'edit', async (v) => {
  const r = await seedCashflow(v.company_id, { rebuild: !!req.body.rebuild });
  await logChange({ user: req.user, companyId: v.company_id, versionId: v.id }, { entity: 'cashflow', action: 'seed', after: r });
  res.json(r);
}));

// נייר עבודה לתזרים לפי סעיף (מבנה ההרכבה)
router.get('/:versionId/cashflow-worksheet', requireAuth, (req, res) => withVersion(req, res, 'view', async (v) => {
  res.json(await computeWorksheet(v));
}));

// שמירת הקצאת תנועה לדליים עבור שורת מאזן (מחליף את כל הדליים לשורה)
router.put('/:versionId/cashflow-alloc', requireAuth, (req, res) => withVersion(req, res, 'edit', async (v) => {
  const fsLineId = Number(req.body.fs_line_id);
  const buckets = req.body.buckets || {};
  if (!fsLineId) return res.status(400).json({ error: 'חסרה שורה' });
  await knex.transaction(async (trx) => {
    await trx('cashflow_allocations').where({ version_id: v.id, fs_line_id: fsLineId }).del();
    const rows = Object.entries(buckets).filter(([, amt]) => Number(amt)).map(([bucket, amt]) => ({ version_id: v.id, fs_line_id: fsLineId, bucket, amount: Number(amt) || 0 }));
    if (rows.length) await trx('cashflow_allocations').insert(rows);
  });
  await logChange({ user: req.user, companyId: v.company_id, versionId: v.id }, { entity: 'cashflow_alloc', entityId: fsLineId, action: 'update' });
  res.json({ ok: true });
}));

// עדכון ערך ידני בשורת תזרים
router.put('/:versionId/cashflow/value', requireAuth, (req, res) => withVersion(req, res, 'edit', async (v) => {
  const lineId = Number(req.body.cashflow_line_id);
  const amount = Number(req.body.amount) || 0;
  if (!lineId) return res.status(400).json({ error: 'חסרה שורה' });
  const existing = await knex('cashflow_values').where({ version_id: v.id, cashflow_line_id: lineId }).first();
  if (existing) await knex('cashflow_values').where({ id: existing.id }).update({ amount, row_version: existing.row_version + 1 });
  else await knex('cashflow_values').insert({ version_id: v.id, cashflow_line_id: lineId, amount });
  await logChange({ user: req.user, companyId: v.company_id, versionId: v.id }, { entity: 'cashflow_value', entityId: lineId, action: 'update', after: { amount } });
  res.json({ ok: true });
}));

// עדכון שורת תזרים (מקור/סימן/תווית)
router.patch('/cashflow-line/:id', requireAuth, async (req, res) => {
  const line = await knex('cashflow_lines').where({ id: req.params.id }).first();
  if (!line) return res.status(404).json({ error: 'שורה לא נמצאה' });
  req.companyId = line.company_id;
  return requireCompanyLevel('edit')(req, res, async () => {
    const patch = {};
    ['label', 'source_type', 'source_fs_line_id', 'sign', 'section', 'sort_order'].forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
    await knex('cashflow_lines').where({ id: line.id }).update(patch);
    res.json({ ok: true });
  });
});

// קביעת גרסת פתיחה/השוואה ידנית
router.put('/:versionId/prior', requireAuth, (req, res) => withVersion(req, res, 'edit', async (v) => {
  const pid = req.body.prior_version_id ? Number(req.body.prior_version_id) : null;
  await knex('report_versions').where({ id: v.id }).update({ prior_version_id: pid });
  await logChange({ user: req.user, companyId: v.company_id, versionId: v.id }, { entity: 'version', entityId: v.id, action: 'set-prior', after: { prior_version_id: pid } });
  res.json({ ok: true });
}));

// גרסאות מועמדות לפתיחה (אותה חברה, לפני התקופה)
router.get('/:versionId/prior-candidates', requireAuth, (req, res) => withVersion(req, res, 'view', async (v) => {
  const period = await knex('periods').where({ id: v.period_id }).first();
  const rows = await knex('report_versions as ver').join('periods as p', 'p.id', 'ver.period_id')
    .where('ver.company_id', v.company_id).andWhere('p.as_of_date', '<', period.as_of_date).andWhere('ver.id', '!=', v.id)
    .select('ver.id', 'ver.name', 'ver.status', 'p.as_of_date', 'p.label as period_label')
    .orderBy('p.as_of_date', 'desc');
  res.json(rows);
}));

// --- שורות שינויים בהון (ידניות) ---
router.post('/:versionId/equity/row', requireAuth, (req, res) => withVersion(req, res, 'edit', async (v) => {
  const [id] = await knex('equity_rows').insert({ company_id: v.company_id, label: req.body.label || 'תנועה', kind: req.body.kind || 'movement', sort_order: req.body.sort_order || 0 });
  res.json({ id });
}));
router.put('/:versionId/equity/value', requireAuth, (req, res) => withVersion(req, res, 'edit', async (v) => {
  const { equity_row_id, fs_line_id, amount } = req.body;
  if (!equity_row_id || !fs_line_id) return res.status(400).json({ error: 'חסרים שדות' });
  const existing = await knex('equity_values').where({ version_id: v.id, equity_row_id, fs_line_id }).first();
  if (existing) await knex('equity_values').where({ id: existing.id }).update({ amount: Number(amount) || 0 });
  else await knex('equity_values').insert({ version_id: v.id, equity_row_id, fs_line_id, amount: Number(amount) || 0 });
  res.json({ ok: true });
}));
router.delete('/equity/row/:id', requireAuth, async (req, res) => {
  const row = await knex('equity_rows').where({ id: req.params.id }).first();
  if (!row) return res.status(404).json({ error: 'לא נמצא' });
  req.companyId = row.company_id;
  return requireCompanyLevel('edit')(req, res, async () => { await knex('equity_rows').where({ id: row.id }).del(); res.json({ ok: true }); });
});

module.exports = router;
