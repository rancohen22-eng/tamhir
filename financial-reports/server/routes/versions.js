'use strict';
const router = require('express').Router();
const knex = require('../db');
const { requireAuth, requireCompanyLevel } = require('../middleware/auth');
const { logChange } = require('../services/audit');

// רשימת גרסאות לחברה+תקופה
router.get('/', requireAuth, requireCompanyLevel('view'), async (req, res) => {
  const { period_id } = req.query;
  const q = knex('report_versions').where({ company_id: req.companyId });
  if (period_id) q.andWhere({ period_id });
  const rows = await q.orderBy('created_at', 'desc');
  res.json(rows);
});

// גרסה בודדת + הקשר (חברה/תקופה)
router.get('/:id', requireAuth, async (req, res) => {
  const v = await knex('report_versions').where({ id: req.params.id }).first();
  if (!v) return res.status(404).json({ error: 'גרסה לא נמצאה' });
  req.companyId = v.company_id;
  return requireCompanyLevel('view')(req, res, async () => {
    const company = await knex('companies').where({ id: v.company_id }).first();
    const period = await knex('periods').where({ id: v.period_id }).first();
    res.json({ ...v, company, period, level: req.permLevel });
  });
});

// יצירת גרסה חדשה (אפשר לשכפל מגרסה קיימת: based_on_version_id)
router.post('/', requireAuth, requireCompanyLevel('edit'), async (req, res) => {
  const { period_id, name, based_on_version_id } = req.body;
  if (!period_id || !name) return res.status(400).json({ error: 'חסרים תקופה / שם גרסה' });

  const result = await knex.transaction(async (trx) => {
    const [id] = await trx('report_versions').insert({
      company_id: req.companyId,
      period_id,
      name,
      status: 'draft',
      based_on_version_id: based_on_version_id || null,
      created_by: req.user.id,
    });

    // שכפול נתונים מגרסת מקור (snapshot)
    if (based_on_version_id) {
      await cloneData(trx, based_on_version_id, id, req.user.id);
    }
    return id;
  });

  await logChange({ user: req.user, companyId: req.companyId, versionId: result },
    { entity: 'version', entityId: result, action: 'create', after: { name, based_on_version_id } });
  res.json({ id: result });
});

// שכפול גרסה קיימת לגרסה חדשה (כפתור "שמור כגרסה חדשה")
router.post('/:id/clone', requireAuth, async (req, res) => {
  const src = await knex('report_versions').where({ id: req.params.id }).first();
  if (!src) return res.status(404).json({ error: 'גרסת מקור לא נמצאה' });
  req.companyId = src.company_id;
  return requireCompanyLevel('edit')(req, res, async () => {
    const name = req.body.name || `${src.name} - עותק`;
    const newId = await knex.transaction(async (trx) => {
      const [id] = await trx('report_versions').insert({
        company_id: src.company_id, period_id: src.period_id, name,
        status: 'draft', based_on_version_id: src.id, created_by: req.user.id,
      });
      await cloneData(trx, src.id, id, req.user.id);
      return id;
    });
    await logChange({ user: req.user, companyId: src.company_id, versionId: newId },
      { entity: 'version', entityId: newId, action: 'clone', after: { from: src.id, name } });
    res.json({ id: newId });
  });
});

// עדכון סטטוס גרסה (draft/final) / שם
router.patch('/:id', requireAuth, async (req, res) => {
  const v = await knex('report_versions').where({ id: req.params.id }).first();
  if (!v) return res.status(404).json({ error: 'גרסה לא נמצאה' });
  req.companyId = v.company_id;
  return requireCompanyLevel('edit')(req, res, async () => {
    const patch = {};
    if (req.body.name != null) patch.name = req.body.name;
    if (req.body.status != null) patch.status = req.body.status;
    patch.updated_at = knex.fn.now();
    await knex('report_versions').where({ id: v.id }).update(patch);
    await logChange({ user: req.user, companyId: v.company_id, versionId: v.id },
      { entity: 'version', entityId: v.id, action: 'update', before: { name: v.name, status: v.status }, after: patch });
    res.json({ ok: true });
  });
});

// --- עזר: העתקת כל נתוני העבודה בין גרסאות ---
async function cloneData(trx, fromVersionId, toVersionId, userId) {
  const copyTable = async (table, extra = {}) => {
    const rows = await trx(table).where({ version_id: fromVersionId });
    if (!rows.length) return;
    const cloned = rows.map((r) => {
      const { id, created_at, ...rest } = r; // eslint-disable-line no-unused-vars
      return { ...rest, version_id: toVersionId, ...extra };
    });
    // הכנסה במקבצים
    for (let i = 0; i < cloned.length; i += 500) {
      await trx(table).insert(cloned.slice(i, i + 500));
    }
  };
  await copyTable('trial_balance_rows');
  await copyTable('adjustments', { created_by: userId });
  await copyTable('reclassifications', { created_by: userId });
}

module.exports = router;
