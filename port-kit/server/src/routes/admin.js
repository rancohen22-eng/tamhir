// Admin routes. Implemented: users list, create (+welcome email), logins, attempts,
// emaillog, usage. The rest are stubs — port from install_api.sql (admin_* functions).
const express = require('express');
const router = express.Router();
const { q, one } = require('../db');
const { requireAuth, requireAdmin, hashPassword, MIN_PW } = require('../auth');
const { sendTracked, BASE } = require('../mail');

router.use(requireAuth, requireAdmin);

// list users (+roles, dept, email)
router.post('/admin/users', async (_req, res) => {
  const rows = await q(
    `SELECT u.user_id id, u.username, u.full_name, u.email, u.is_active, d.name_he dept,
            (SELECT string_agg(role_code,',') FROM user_roles r WHERE r.user_id=u.user_id) roles
       FROM app_users u LEFT JOIN departments d ON d.dept_id=u.dept_id ORDER BY u.user_id`);
  res.json({ ok: true, users: rows });
});

// create user + grant role (+agent/approver rows) + send welcome email
router.post('/admin/user/create', async (req, res) => {
  const { username, full, email, dept_id, role, password } = req.body;
  if (password && password.length < MIN_PW) return res.json({ ok: false, error: 'weak_password' });
  const pw = password || 'Arkia2026!';
  if (pw.length < MIN_PW) return res.json({ ok: false, error: 'weak_password' });
  try {
    const u = await one(
      `INSERT INTO app_users(username,full_name,email,dept_id,pref_lang,password_hash)
       VALUES (lower($1),$2,$3,$4,'HE',$5) RETURNING user_id`,
      [username, full, email || null, dept_id || null, await hashPassword(pw)]);
    await q(`INSERT INTO user_roles(user_id,role_code) VALUES ($1,$2)`, [u.user_id, role]);
    if (role === 'AGENT') await q(`INSERT INTO agents(user_id,agency_name) VALUES ($1,$2)`, [u.user_id, full]);
    if (role === 'APPROVER' && dept_id) await q(`INSERT INTO dept_approvers(dept_id,approver_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [dept_id, u.user_id]);
    let emailed = false;
    if (email) emailed = await sendTracked({
      to: email, subject: 'ברוכים הבאים — מערכת הזמנת טיסות מטלטוס (פרטי כניסה)',
      text: `שם משתמש: ${String(username).toLowerCase()}\nסיסמה זמנית: ${pw}\nכניסה: ${BASE}/api/app`,
      html: `<div dir="rtl" style="font-family:Heebo,Arial"><h2 style="color:#123a86">ברוכים הבאים</h2>
             שם משתמש: <b>${String(username).toLowerCase()}</b><br>סיסמה זמנית: <b>${pw}</b><br>
             <p><a href="${BASE}/api/app" style="background:#0e7a4e;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">כניסה למערכת</a></p></div>`,
      meta: { user_id: u.user_id, kind: 'WELCOME' },
    });
    res.json({ ok: true, id: u.user_id, emailed });
  } catch (e) { console.error(e); res.json({ ok: false, error: 'server_error' }); }
});

// security monitoring
router.post('/admin/logins', async (_req, res) => {
  const rows = await q(`SELECT l.username, u.full_name, to_char(l.login_at,'YYYY-MM-DD HH24:MI:SS') at
                          FROM login_log l LEFT JOIN app_users u ON u.user_id=l.user_id
                         ORDER BY l.login_at DESC LIMIT 100`);
  res.json({ ok: true, logins: rows });
});
router.post('/admin/attempts', async (_req, res) => {
  const rows = await q(`SELECT username, ip, success, to_char(attempted_at,'YYYY-MM-DD HH24:MI:SS') at
                          FROM login_attempts ORDER BY attempted_at DESC LIMIT 200`);
  res.json({ ok: true, attempts: rows });
});
router.post('/admin/emaillog', async (_req, res) => {
  const rows = await q(`SELECT recipient "to", kind, subject, booking_id,
                               to_char(sent_at,'YYYY-MM-DD HH24:MI') sent, opened,
                               to_char(opened_at,'YYYY-MM-DD HH24:MI') opened_at, COALESCE(open_count,0) open_count
                          FROM email_log ORDER BY sent_at DESC LIMIT 300`);
  res.json({ ok: true, emails: rows });
});
router.post('/admin/usage', async (_req, res) => {
  const s = await one(`SELECT round(pg_database_size(current_database())/1024.0/1024/1024, 3) gb`);
  const m = await one(`SELECT count(*)::int c FROM email_log WHERE sent_at >= date_trunc('month', now())`);
  res.json({ ok: true, storage_gb: Number(s.gb), storage_limit_gb: 250, emails_month: m.c, emails_limit: 3000 });
});

// dept approvers (multiple per dept)
router.post('/admin/dept_approvers', async (_req, res) => {
  const rows = await q(`SELECT da.dept_id, da.approver_user_id user_id, u.full_name name
                          FROM dept_approvers da JOIN app_users u ON u.user_id=da.approver_user_id ORDER BY da.dept_id`);
  res.json({ ok: true, approvers: rows });
});
router.post('/admin/dept_approver/set', async (req, res) => {
  const { dept_id, user_id } = req.body;
  if (!user_id) return res.json({ ok: false, error: 'no_user' });
  await q(`INSERT INTO dept_approvers(dept_id,approver_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [dept_id, user_id]);
  await q(`INSERT INTO user_roles(user_id,role_code) VALUES ($1,'APPROVER') ON CONFLICT DO NOTHING`, [user_id]);
  await q(`UPDATE bookings SET approver_id=$2 WHERE dept_id=$1 AND approver_id IS NULL AND status NOT IN ('TICKETED','CANCELLED','REJECTED')`, [dept_id, user_id]);
  res.json({ ok: true });
});
router.post('/admin/dept_approver/del', async (req, res) => {
  await q(`DELETE FROM dept_approvers WHERE dept_id=$1 AND approver_user_id=$2`, [req.body.dept_id, req.body.user_id]);
  await q(`UPDATE bookings SET approver_id=NULL WHERE dept_id=$1 AND approver_id=$2 AND status NOT IN ('TICKETED','CANCELLED','REJECTED')`, [req.body.dept_id, req.body.user_id]);
  res.json({ ok: true });
});

// departments / airports / wet ops
router.post('/admin/dept/create', async (req, res) => {
  await q(`INSERT INTO departments(dept_code,name_he,name_en) VALUES ($1,$2,COALESCE($3,$2))`, [req.body.code, req.body.name_he, req.body.name_en || null]);
  res.json({ ok: true });
});
router.post('/admin/dept/update', async (req, res) => {
  if (!req.body.name_he) return res.json({ ok: false, error: 'no_name' });
  await q(`UPDATE departments SET name_he=$1,name_en=COALESCE($2,$1),dept_code=COALESCE($3,dept_code) WHERE dept_id=$4`,
    [req.body.name_he, req.body.name_en || null, req.body.code || null, req.body.dept_id]);
  res.json({ ok: true });
});
router.post('/admin/airports', async (_req, res) => {
  const rows = await q(`SELECT iata,name_he,name_en,country,is_active FROM airports ORDER BY iata`);
  res.json({ ok: true, airports: rows });
});
router.post('/admin/airport/save', async (req, res) => {
  const { iata, name_he, name_en, country, is_active } = req.body;
  await q(`INSERT INTO airports(iata,name_he,name_en,country,is_active) VALUES (upper($1),$2,$3,$4,COALESCE($5,'Y'))
           ON CONFLICT (iata) DO UPDATE SET name_he=COALESCE(EXCLUDED.name_he,airports.name_he),
             name_en=COALESCE(EXCLUDED.name_en,airports.name_en), country=COALESCE(EXCLUDED.country,airports.country),
             is_active=COALESCE(EXCLUDED.is_active,airports.is_active)`,
    [iata, name_he || null, name_en || null, country || null, is_active || null]);
  res.json({ ok: true });
});
router.post('/admin/wetop/create', async (req, res) => {
  await q(`INSERT INTO wet_operators(name_he,name_en) VALUES ($1,COALESCE($2,$1))`, [req.body.name_he, req.body.name_en || null]);
  res.json({ ok: true });
});

// password admin
router.post('/admin/setpw', async (req, res) => {
  if (!req.body.password || req.body.password.length < MIN_PW) return res.json({ ok: false, error: 'weak_password' });
  await q(`UPDATE app_users SET password_hash=$1 WHERE lower(username)=lower($2)`, [await hashPassword(req.body.password), req.body.username]);
  res.json({ ok: true });
});

// TODO stubs — port from install_api.sql:
router.post('/admin/user/update', (_req, res) => res.json({ ok: false, error: 'not_implemented' }));
router.post('/admin/user/delete', (_req, res) => res.json({ ok: false, error: 'not_implemented' }));
router.post('/admin/resetpw', (_req, res) => res.json({ ok: false, error: 'not_implemented' })); // generate temp pw + email it

module.exports = router;
