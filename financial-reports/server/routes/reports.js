'use strict';
const router = require('express').Router();
const knex = require('../db');
const { requireAuth } = require('../middleware/auth');
const { resolveVersion } = require('../middleware/version');
const { computeReport, drillLine } = require('../services/report-engine');
const { buildReportDocx } = require('../services/docx-export');

// חישוב הדוח המלא לגרסה
router.get('/', requireAuth, resolveVersion('view'), async (req, res) => {
  const report = await computeReport(req.version);
  res.json(report);
});

// תחקור שורת דוח עד רמת חשבון
router.get('/drill/:fsLineId', requireAuth, resolveVersion('view'), async (req, res) => {
  const data = await drillLine(req.version, Number(req.params.fsLineId));
  res.json(data);
});

// ייצוא הדוח ל-Word (.docx)
router.get('/export/word', requireAuth, resolveVersion('view'), async (req, res) => {
  const report = await computeReport(req.version);
  const company = await knex('companies').where({ id: req.version.company_id }).first();
  const period = await knex('periods').where({ id: req.version.period_id }).first();
  const buffer = await buildReportDocx({ report, company, period, version: req.version });
  const fname = `financial-report-${company.code || company.id}-${period.fiscal_year}.docx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  res.send(buffer);
});

module.exports = router;
