'use strict';
const router = require('express').Router();
const knex = require('../db');
const { requireAuth, requireCompanyLevel } = require('../middleware/auth');
const { logChange } = require('../services/audit');

// אינדקס המרה: סעיף מאזן בוחן -> שורת דוח כספי (per חברה)
router.get('/', requireAuth, requireCompanyLevel('view'), async (req, res) => {
  const rows = await knex('index_map').where({ company_id: req.companyId }).orderBy('tb_section_code');
  res.json(rows);
});

// יצירה/עדכון מיפוי (upsert לפי company+tb_section_code) עם optimistic lock
router.put('/', requireAuth, requireCompanyLevel('edit'), async (req, res) => {
  const { tb_section_code, tb_section_name, fs_line_id, row_version } = req.body;
  if (!tb_section_code) return res.status(400).json({ error: 'חסר קוד סעיף מאזן בוחן' });
  const existing = await knex('index_map').where({ company_id: req.companyId, tb_section_code }).first();
  if (existing) {
    if (row_version != null && Number(row_version) !== existing.row_version) {
      return res.status(409).json({ error: 'הרשומה עודכנה על ידי משתמש אחר. רעננו ונסו שוב.', current: existing });
    }
    await knex('index_map').where({ id: existing.id }).update({
      tb_section_name: tb_section_name ?? existing.tb_section_name,
      fs_line_id: fs_line_id ?? null,
      updated_at: knex.fn.now(),
      row_version: existing.row_version + 1,
    });
    await logChange({ user: req.user, companyId: req.companyId }, { entity: 'index_map', entityId: existing.id, action: 'update', before: existing, after: { fs_line_id } });
    return res.json({ id: existing.id });
  }
  const [id] = await knex('index_map').insert({
    company_id: req.companyId, tb_section_code, tb_section_name: tb_section_name || null, fs_line_id: fs_line_id || null,
  });
  await logChange({ user: req.user, companyId: req.companyId }, { entity: 'index_map', entityId: id, action: 'create', after: { tb_section_code, fs_line_id } });
  res.json({ id });
});

// זריעת סעיפי מאזן בוחן חסרים מתוך גרסה (יוצר שורות אינדקס ריקות לכל סעיף שקיים במאזן)
router.post('/seed-from-version', requireAuth, async (req, res) => {
  const v = await knex('report_versions').where({ id: req.body.version_id }).first();
  if (!v) return res.status(404).json({ error: 'גרסה לא נמצאה' });
  req.companyId = v.company_id;
  return requireCompanyLevel('edit')(req, res, async () => {
    const sections = await knex('trial_balance_rows').where({ version_id: v.id })
      .distinct('tb_section_code', 'tb_section_name').whereNotNull('tb_section_code');
    let added = 0;
    for (const s of sections) {
      const exists = await knex('index_map').where({ company_id: v.company_id, tb_section_code: s.tb_section_code }).first();
      if (!exists) {
        await knex('index_map').insert({ company_id: v.company_id, tb_section_code: s.tb_section_code, tb_section_name: s.tb_section_name });
        added++;
      }
    }
    await logChange({ user: req.user, companyId: v.company_id, versionId: v.id }, { entity: 'index_map', action: 'seed', after: { added } });
    res.json({ added });
  });
});

module.exports = router;
