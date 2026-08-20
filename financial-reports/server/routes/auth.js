'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const knex = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logChange } = require('../services/audit');

// התחברות
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'חסרים פרטי התחברות' });
  const user = await knex('users').whereRaw('LOWER(username) = ?', [String(username).toLowerCase().trim()]).first();
  if (!user || !user.is_active || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
  }
  req.session.userId = user.id;
  await logChange({ user }, { entity: 'auth', entityId: user.id, action: 'login' });
  res.json({ id: user.id, username: user.username, full_name: user.full_name, is_admin: !!user.is_admin });
});

// התנתקות
router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// המשתמש הנוכחי
router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  res.json({ id: u.id, username: u.username, full_name: u.full_name, is_admin: !!u.is_admin });
});

// שינוי סיסמה עצמי
router.post('/change-password', requireAuth, async (req, res) => {
  const { current, next: nextPw } = req.body;
  if (!nextPw || nextPw.length < 6) return res.status(400).json({ error: 'סיסמה חדשה קצרה מדי' });
  if (!bcrypt.compareSync(current || '', req.user.password_hash)) {
    return res.status(401).json({ error: 'הסיסמה הנוכחית שגויה' });
  }
  await knex('users').where({ id: req.user.id }).update({ password_hash: bcrypt.hashSync(nextPw, 10) });
  res.json({ ok: true });
});

module.exports = router;
