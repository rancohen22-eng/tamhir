'use strict';
const router = require('express').Router();
const knex = require('../db');
const { requireAuth, requireCompanyLevel } = require('../middleware/auth');

// לוג שינויים מסונן לפי חברה (וגרסה אופציונלית). דורש הרשאת צפייה לחברה.
router.get('/', requireAuth, requireCompanyLevel('view'), async (req, res) => {
  const { version_id, entity, limit } = req.query;
  const q = knex('audit_log').where({ company_id: req.companyId });
  if (version_id) q.andWhere({ version_id });
  if (entity) q.andWhere({ entity });
  const rows = await q.orderBy('ts', 'desc').limit(Math.min(Number(limit) || 200, 1000));
  res.json(rows);
});

module.exports = router;
