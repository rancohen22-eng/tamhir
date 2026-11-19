// Public routes: login (full, with lockout), bootstrap, act-from-email, logout.
const express = require('express');
const router = express.Router();
const { q, one } = require('../db');
const { verifyPassword, createSession, requireAuth } = require('../auth');
const { sendTracked } = require('../mail');

const THRESHOLD = Number(process.env.LOCKOUT_THRESHOLD || 5);
const WINDOW = Number(process.env.LOCKOUT_WINDOW_MIN || 15);

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || null;

async function emailAdminsLocked(username, ip) {
  const admins = await q(
    `SELECT DISTINCT u.email FROM app_users u JOIN user_roles r ON r.user_id=u.user_id
      WHERE r.role_code='ADMIN' AND u.email IS NOT NULL AND u.is_active='Y'`, []);
  for (const a of admins) {
    await sendTracked({
      to: a.email,
      subject: 'ארקיע — התראת אבטחה: חשבון ננעל עקב ריבוי כשלונות',
      text: `החשבון "${username}" ננעל ל-${WINDOW} דקות לאחר ${THRESHOLD} ניסיונות כושלים. IP: ${ip || 'לא ידוע'}`,
      html: `<div dir="rtl">החשבון <b>${username}</b> ננעל ל-${WINDOW} דקות לאחר ${THRESHOLD} ניסיונות כושלים.<br>IP: ${ip || 'לא ידוע'}</div>`,
      meta: { kind: 'SECURITY', subject: 'account locked' },
    });
  }
}

// POST /api/login
router.post('/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').toLowerCase().trim();
    const password = String(req.body.password || '');
    const ip = clientIp(req);
    if (!username || !password) return res.json({ ok: false, error: 'bad_credentials' });

    const [{ count }] = await q(
      `SELECT COUNT(*)::int AS count FROM login_attempts
        WHERE lower(username)=$1 AND success='N' AND attempted_at > now() - ($2||' minutes')::interval`,
      [username, WINDOW]);
    if (count >= THRESHOLD) {
      await q(`INSERT INTO login_attempts(username,ip,success) VALUES ($1,$2,'N')`, [username, ip]);
      return res.json({ ok: false, error: 'locked' });
    }

    const user = await one(`SELECT * FROM app_users WHERE lower(username)=$1`, [username]);
    const ok = user && user.is_active === 'Y' && await verifyPassword(password, user.password_hash);
    if (!ok) {
      await q(`INSERT INTO login_attempts(username,ip,success) VALUES ($1,$2,'N')`, [username, ip]);
      if (count + 1 === THRESHOLD) emailAdminsLocked(username, ip).catch(() => {});
      return res.json({ ok: false, error: 'bad_credentials' });
    }

    await q(`INSERT INTO login_attempts(username,ip,success) VALUES ($1,$2,'Y')`, [username, ip]);
    await q(`INSERT INTO login_log(user_id,username) VALUES ($1,$2)`, [user.user_id, username]);
    const token = await createSession(user.user_id);
    const roles = (await q(`SELECT role_code FROM user_roles WHERE user_id=$1`, [user.user_id])).map(r => r.role_code);
    const agent = await one(`SELECT agent_id FROM agents WHERE user_id=$1`, [user.user_id]);
    res.json({
      ok: true, token,
      user: { id: user.user_id, username, full_name: user.full_name, dept_id: user.dept_id,
              pref_lang: user.pref_lang, notify_email: user.notify_email },
      roles, agent_id: agent ? agent.agent_id : null,
    });
  } catch (e) { console.error(e); res.json({ ok: false, error: 'server_error' }); }
});

// POST /api/bootstrap
router.post('/bootstrap', requireAuth, async (req, res) => {
  try {
    const departments = await q(`SELECT dept_id id, dept_code code, name_he, name_en FROM departments WHERE is_active='Y' ORDER BY dept_id`);
    const currencies = await q(`SELECT code, symbol, name_he, name_en FROM currencies`);
    const statuses = await q(`SELECT status_code code, label_he he, label_en en, is_terminal terminal FROM statuses ORDER BY sort_order`);
    const wet_operators = await q(`SELECT operator_id, name_he, name_en FROM wet_operators WHERE is_active='Y' ORDER BY name_he`);
    const airports = await q(`SELECT iata, name_he, name_en, country FROM airports WHERE is_active='Y' ORDER BY iata`);
    res.json({ ok: true, departments, currencies, statuses, wet_operators, airports });
  } catch (e) { console.error(e); res.json({ ok: false, error: 'server_error' }); }
});

// GET /api/act?t=TOKEN  — approve from email (anonymous, one-time).
// TODO: validate booking_action_tokens (exists, not expired, used='N'), perform the
// approve transition via the workflow engine (see bookings.js changeStatus), mark used,
// and return a small branded HTML page. See ENDPOINTS.md "Approve / track from email".
router.get('/act', async (req, res) => {
  res.type('text/html').send('<!doctype html><meta charset="utf-8"><p>TODO: implement act-from-email (see ENDPOINTS.md).</p>');
});

// POST /api/logout (optional convenience)
router.post('/logout', requireAuth, async (req, res) => {
  await q(`DELETE FROM api_sessions WHERE token=$1`, [req.body.token]);
  res.json({ ok: true });
});

module.exports = router;
