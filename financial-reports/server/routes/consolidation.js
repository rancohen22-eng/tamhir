'use strict';
const router = require('express').Router();
const knex = require('../db');
const { requireAuth, requireCompanyLevel } = require('../middleware/auth');
const { logChange } = require('../services/audit');
const { buildFromVersion } = require('../services/build-structure');
const { memberVersions, memberVersionIds, ensureSyntheticLines } = require('../services/consolidation');

// עזר: טעינת גרסת מאוחד + בדיקת הרשאה
async function withConsolidated(req, res, minLevel, handler) {
  const v = await knex('report_versions').where({ id: req.params.versionId }).first();
  if (!v) return res.status(404).json({ error: 'גרסה לא נמצאה' });
  const company = await knex('companies').where({ id: v.company_id }).first();
  if (!company || !company.is_consolidated) return res.status(400).json({ error: 'הגרסה אינה שייכת לחברת איחוד' });
  req.companyId = v.company_id;
  return requireCompanyLevel(minLevel)(req, res, () => handler(v));
}

// רשימת הבנות המרכיבות
router.get('/:versionId/members', requireAuth, (req, res) => withConsolidated(req, res, 'view', async (v) => {
  res.json(await memberVersions(v.id));
}));

// גרסאות מועמדות (בנות) לאותה תקופה
router.get('/:versionId/candidates', requireAuth, (req, res) => withConsolidated(req, res, 'view', async (v) => {
  const rows = await knex('report_versions as ver')
    .join('companies as c', 'c.id', 'ver.company_id')
    .where('ver.period_id', v.period_id).andWhere('c.is_consolidated', false)
    .select('ver.id', 'ver.name', 'ver.company_id', 'c.name as company_name', 'ver.status', 'ver.created_at')
    .orderBy(['c.sort_order', { column: 'ver.created_at', order: 'desc' }]);
  res.json(rows);
}));

// הוספת בת (עם שיעור אחזקה ושיטה)
router.post('/:versionId/members', requireAuth, (req, res) => withConsolidated(req, res, 'edit', async (v) => {
  const memberId = Number(req.body.member_version_id);
  if (!memberId) return res.status(400).json({ error: 'חסרה גרסת בת' });
  const holding_pct = req.body.holding_pct != null ? Number(req.body.holding_pct) : 100;
  const method = req.body.method === 'equity' ? 'equity' : 'full';
  const exists = await knex('consolidation_members').where({ consolidated_version_id: v.id, member_version_id: memberId }).first();
  if (!exists) await knex('consolidation_members').insert({ consolidated_version_id: v.id, member_version_id: memberId, holding_pct, method });
  else await knex('consolidation_members').where({ id: exists.id }).update({ holding_pct, method });
  await logChange({ user: req.user, companyId: v.company_id, versionId: v.id }, { entity: 'consolidation', action: 'add-member', after: { memberId, holding_pct, method } });
  res.json({ ok: true });
}));

// עדכון אחזקה/שיטה לבת
router.patch('/:versionId/members/:memberVersionId', requireAuth, (req, res) => withConsolidated(req, res, 'edit', async (v) => {
  const patch = {};
  if (req.body.holding_pct != null) patch.holding_pct = Number(req.body.holding_pct);
  if (req.body.method != null) patch.method = req.body.method === 'equity' ? 'equity' : 'full';
  await knex('consolidation_members').where({ consolidated_version_id: v.id, member_version_id: req.params.memberVersionId }).update(patch);
  await logChange({ user: req.user, companyId: v.company_id, versionId: v.id }, { entity: 'consolidation', action: 'update-member', after: patch });
  res.json({ ok: true });
}));

// הסרת בת
router.delete('/:versionId/members/:memberVersionId', requireAuth, (req, res) => withConsolidated(req, res, 'edit', async (v) => {
  await knex('consolidation_members').where({ consolidated_version_id: v.id, member_version_id: req.params.memberVersionId }).del();
  await logChange({ user: req.user, companyId: v.company_id, versionId: v.id }, { entity: 'consolidation', action: 'remove-member', after: { memberId: req.params.memberVersionId } });
  res.json({ ok: true });
}));

// בניית מבנה+אינדקס למאוחד מתוך שורות הבנות
router.post('/:versionId/build-structure', requireAuth, (req, res) => withConsolidated(req, res, 'edit', async (v) => {
  const sources = await memberVersionIds(v.id);
  if (!sources.length) return res.status(400).json({ error: 'לא הוגדרו חברות בנות למאוחד' });
  const result = await buildFromVersion(v, { rebuild: !!req.body.rebuild, sourceVersionIds: sources, ctx: { user: req.user } });
  await ensureSyntheticLines(v.company_id); // שורות אקוויטי / זכויות מיעוט
  // מיפוי כל סעיף מצטבר שאינו ממופה (למשל סעיף יעד ממיוני הבנות)
  const { computeSectionTotals } = require('../services/report-engine');
  const { ensureSectionMapped } = require('../services/build-structure');
  const { parsePrefixed } = require('../services/build-structure');
  const sections = await computeSectionTotals(v);
  for (const s of Object.values(sections)) {
    const n = parsePrefixed(s.mainHeader).num;
    await ensureSectionMapped(v.company_id, s.code, s.name, (n != null && n <= 3) ? 'balance' : 'pnl');
  }
  res.json(result);
}));

module.exports = router;
