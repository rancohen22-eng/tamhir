'use strict';
const router = require('express').Router();
const knex = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logChange } = require('../services/audit');

// רשימת תקופות
router.get('/', requireAuth, async (req, res) => {
  const rows = await knex('periods').orderBy([{ column: 'fiscal_year', order: 'desc' }, { column: 'as_of_date', order: 'desc' }]);
  res.json(rows);
});

// יצירת תקופה (מנהל)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { fiscal_year, as_of_date, label } = req.body;
  if (!fiscal_year || !as_of_date) return res.status(400).json({ error: 'חסרים שנת כספים / תאריך' });
  const exists = await knex('periods').where({ fiscal_year, as_of_date }).first();
  if (exists) return res.status(409).json({ error: 'התקופה כבר קיימת' });
  const [id] = await knex('periods').insert({ fiscal_year, as_of_date, label: label || null });
  await logChange({ user: req.user }, { entity: 'period', entityId: id, action: 'create', after: { fiscal_year, as_of_date } });
  res.json({ id });
});

module.exports = router;
