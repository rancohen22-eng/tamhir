'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const knex = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logChange } = require('../services/audit');

// כל ה-routes כאן דורשים מנהל
router.use(requireAuth, requireAdmin);

// רשימת משתמשים + הרשאות
router.get('/', async (req, res) => {
  const users = await knex('users').select('id', 'username', 'full_name', 'is_admin', 'is_active').orderBy('username');
  const perms = await knex('permissions').select();
  const byUser = {};
  perms.forEach((p) => { (byUser[p.user_id] = byUser[p.user_id] || []).push(p); });
  res.json(users.map((u) => ({ ...u, permissions: byUser[u.id] || [] })));
});

// יצירת משתמש
router.post('/', async (req, res) => {
  const { username, full_name, password, is_admin } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'חסרים שם משתמש / סיסמה' });
  const exists = await knex('users').whereRaw('LOWER(username)=?', [username.toLowerCase().trim()]).first();
  if (exists) return res.status(409).json({ error: 'שם המשתמש כבר קיים' });
  const [id] = await knex('users').insert({
    username: username.trim(), full_name: full_name || null,
    password_hash: bcrypt.hashSync(password, 10), is_admin: !!is_admin, is_active: true,
  });
  await logChange({ user: req.user }, { entity: 'user', entityId: id, action: 'create', after: { username } });
  res.json({ id });
});

// עדכון משתמש (שם / פעיל / מנהל / איפוס סיסמה)
router.patch('/:id', async (req, res) => {
  const patch = {};
  ['full_name', 'is_admin', 'is_active'].forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  if (req.body.password) patch.password_hash = bcrypt.hashSync(req.body.password, 10);
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'אין מה לעדכן' });
  await knex('users').where({ id: req.params.id }).update(patch);
  await logChange({ user: req.user }, { entity: 'user', entityId: req.params.id, action: 'update', after: Object.keys(patch) });
  res.json({ ok: true });
});

// קביעת הרשאות משתמש לחברות (מחליף את הקיימות)
// body: { permissions: [{ company_id|null, level }] }
router.put('/:id/permissions', async (req, res) => {
  const list = Array.isArray(req.body.permissions) ? req.body.permissions : [];
  await knex.transaction(async (trx) => {
    await trx('permissions').where({ user_id: req.params.id }).del();
    if (list.length) {
      await trx('permissions').insert(list.map((p) => ({
        user_id: Number(req.params.id),
        company_id: p.company_id || null,
        level: p.level === 'edit' ? 'edit' : 'view',
      })));
    }
  });
  await logChange({ user: req.user }, { entity: 'user_perms', entityId: req.params.id, action: 'update', after: list });
  res.json({ ok: true });
});

module.exports = router;
