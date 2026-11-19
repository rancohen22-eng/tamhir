// Bell notifications + per-user email opt-out.
const express = require('express');
const router = express.Router();
const { q } = require('../db');
const { requireAuth } = require('../auth');

router.post('/notifications', requireAuth, async (req, res) => {
  const rows = await q(
    `SELECT notif_id, booking_id, message, is_read, to_char(created_at,'YYYY-MM-DD HH24:MI') at
       FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.user.user_id]);
  res.json({ ok: true, notifications: rows });
});

router.post('/notifications/read', requireAuth, async (req, res) => {
  await q(`UPDATE notifications SET is_read='Y' WHERE user_id=$1 AND is_read='N'`, [req.user.user_id]);
  res.json({ ok: true });
});

router.post('/notify/set', requireAuth, async (req, res) => {
  const on = req.body.on === 'Y' ? 'Y' : 'N';
  await q(`UPDATE app_users SET notify_email=$1 WHERE user_id=$2`, [on, req.user.user_id]);
  res.json({ ok: true });
});

module.exports = router;
