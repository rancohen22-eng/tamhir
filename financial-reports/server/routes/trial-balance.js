'use strict';
const router = require('express').Router();
const multer = require('multer');
const knex = require('../db');
const { requireAuth, requireCompanyLevel } = require('../middleware/auth');
const { logChange } = require('../services/audit');
const { previewWorkbook, extractTrialBalance } = require('../services/xlsx-import');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

// עזר: טעינת גרסה + קביעת החברה לצורך בדיקת הרשאה
async function withVersion(req, res, minLevel, handler) {
  const versionId = Number(req.body.version_id || req.query.version_id || 0);
  if (!versionId) return res.status(400).json({ error: 'חסר מזהה גרסה' });
  const v = await knex('report_versions').where({ id: versionId }).first();
  if (!v) return res.status(404).json({ error: 'גרסה לא נמצאה' });
  req.companyId = v.company_id;
  req.version = v;
  return requireCompanyLevel(minLevel)(req, res, () => handler(v));
}

// תצוגה מקדימה של קובץ אקסל (לפני מיפוי) — לא נשמר
router.post('/preview', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא הועלה קובץ' });
  try {
    const data = await previewWorkbook(req.file.buffer);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: 'שגיאה בקריאת הקובץ: ' + e.message });
  }
});

// ייבוא מאזן בוחן לגרסה (דורס קיים באותה גרסה)
router.post('/import', requireAuth, upload.single('file'), async (req, res) => {
  await withVersion(req, res, 'edit', async (v) => {
    if (!req.file) return res.status(400).json({ error: 'לא הועלה קובץ' });
    let opts;
    try { opts = JSON.parse(req.body.options || '{}'); }
    catch { return res.status(400).json({ error: 'options לא תקין' }); }
    let rows;
    try { rows = await extractTrialBalance(req.file.buffer, opts); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    if (!rows.length) return res.status(400).json({ error: 'לא נמצאו שורות נתונים לפי המיפוי' });

    await knex.transaction(async (trx) => {
      await trx('trial_balance_rows').where({ version_id: v.id }).del();
      const withVer = rows.map((r) => ({ ...r, version_id: v.id }));
      for (let i = 0; i < withVer.length; i += 500) {
        await trx('trial_balance_rows').insert(withVer.slice(i, i + 500));
      }
    });
    await logChange({ user: req.user, companyId: v.company_id, versionId: v.id },
      { entity: 'trial_balance', entityId: v.id, action: 'import', after: { rows: rows.length } });
    res.json({ imported: rows.length });
  });
});

// רשימת שורות מאזן בוחן לגרסה (עם סינון אופציונלי לפי סעיף)
router.get('/', requireAuth, async (req, res) => {
  await withVersion(req, res, 'view', async (v) => {
    const q = knex('trial_balance_rows').where({ version_id: v.id });
    if (req.query.section) q.andWhere({ tb_section_code: req.query.section });
    const rows = await q.orderBy(['tb_section_code', 'account_no']);
    res.json(rows);
  });
});

// סיכום לפי סעיף מאזן בוחן
router.get('/by-section', requireAuth, async (req, res) => {
  await withVersion(req, res, 'view', async (v) => {
    const rows = await knex('trial_balance_rows')
      .where({ version_id: v.id })
      .select('tb_section_code', 'tb_section_name', 'main_header', 'sub_header')
      .sum({ amount: 'amount' }).sum({ prior_amount: 'prior_amount' })
      .groupBy('tb_section_code', 'tb_section_name', 'main_header', 'sub_header')
      .orderBy('tb_section_code');
    res.json(rows);
  });
});

module.exports = router;
