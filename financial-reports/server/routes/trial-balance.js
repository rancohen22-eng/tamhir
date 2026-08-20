'use strict';
const router = require('express').Router();
const multer = require('multer');
const knex = require('../db');
const { requireAuth, requireCompanyLevel } = require('../middleware/auth');
const { logChange } = require('../services/audit');
const { previewWorkbook, extractTrialBalance } = require('../services/xlsx-import');
const { buildFromVersion } = require('../services/build-structure');
const { parseStandard } = require('../services/standard-import');
const { permissionLevel } = require('../middleware/auth');

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

    // בנייה אוטומטית של מבנה הדוח + אינדקס אם למאזן יש כותרות ואין עדיין מבנה לחברה
    let structure = null;
    const hasHeaders = rows.some((r) => r.main_header || r.sub_header);
    const existingLines = await knex('fs_lines').where({ company_id: v.company_id }).first();
    if (hasHeaders && !existingLines) {
      try { structure = await buildFromVersion(v, { ctx: { user: req.user } }); }
      catch (e) { console.error('auto build-structure failed:', e.message); }
    }
    res.json({ imported: rows.length, structure });
  });
});

// ── טוען מבנה סטנדרטי (קובץ ייצוא מהמערכת הפיננסית) ──
// תצוגה מקדימה: מזהה חברות בקובץ וממפה לחברות במערכת
router.post('/import-standard/preview', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא הועלה קובץ' });
  try {
    const companies = await knex('companies');
    const { sheetName, groups } = await parseStandard(req.file.buffer, companies);
    res.json({ sheetName, groups: groups.map((g) => ({ fileCompany: g.fileCompany, count: g.count, matchedCompanyId: g.matchedCompanyId, matchedCompanyName: g.matchedCompanyName })) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ביצוע: ייבוא כל חברה שבקובץ לגרסה חדשה בתקופה נבחרת + בניית מבנה אוטומטית
// body: period_id, mapping = [{ fileCompany, company_id, version_name }]
router.post('/import-standard/commit', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא הועלה קובץ' });
  const periodId = Number(req.body.period_id);
  if (!periodId) return res.status(400).json({ error: 'חסרה תקופה' });
  let mapping;
  try { mapping = JSON.parse(req.body.mapping || '[]'); } catch { return res.status(400).json({ error: 'mapping לא תקין' }); }

  const companies = await knex('companies');
  const { groups } = await parseStandard(req.file.buffer, companies);
  const results = [];
  for (const g of groups) {
    const m = mapping.find((x) => x.fileCompany === g.fileCompany);
    if (!m || !m.company_id) { results.push({ fileCompany: g.fileCompany, skipped: true }); continue; }
    const level = await permissionLevel(req.user, Number(m.company_id));
    if (level !== 'edit') { results.push({ fileCompany: g.fileCompany, error: 'אין הרשאת עריכה' }); continue; }

    const versionId = await knex.transaction(async (trx) => {
      const [id] = await trx('report_versions').insert({
        company_id: Number(m.company_id), period_id: periodId,
        name: m.version_name || `ייבוא ${new Date().toLocaleDateString('he-IL')}`,
        status: 'draft', created_by: req.user.id,
      });
      const rows = g.rows.map((r) => ({ ...r, version_id: id }));
      for (let i = 0; i < rows.length; i += 500) await trx('trial_balance_rows').insert(rows.slice(i, i + 500));
      return id;
    });
    const version = await knex('report_versions').where({ id: versionId }).first();
    let structure = null;
    const existingLines = await knex('fs_lines').where({ company_id: version.company_id }).first();
    if (!existingLines) { try { structure = await buildFromVersion(version, { ctx: { user: req.user } }); } catch (e) { console.error(e.message); } }
    await logChange({ user: req.user, companyId: version.company_id, versionId },
      { entity: 'trial_balance', entityId: versionId, action: 'import-standard', after: { rows: g.rows.length } });
    results.push({ fileCompany: g.fileCompany, company_id: version.company_id, version_id: versionId, imported: g.rows.length, structure });
  }
  res.json({ results });
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
