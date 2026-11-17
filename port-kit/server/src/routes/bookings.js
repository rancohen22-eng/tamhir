// Bookings: list, detail, create, workflow actions, files. Replaces booking_pkg.
const express = require('express');
const router = express.Router();
const { q, one } = require('../db');
const { requireAuth, hasRole, randToken } = require('../auth');
const { sendTracked } = require('../mail');

const BASE = process.env.APP_BASE_URL || '';

// ── minimal branded email HTML (enhance to match the Oracle template as needed) ──
function emailHtml(b, approveUrl) {
  const row = (k, v) => (v == null || v === '') ? '' : `<tr><td style="color:#5b6b7f;padding:4px 8px">${k}</td><td style="padding:4px 8px;font-weight:600">${v}</td></tr>`;
  return `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif">
    ${b.urgent === 'Y' ? '<div style="background:#b3261e;color:#fff;padding:6px;text-align:center;font-weight:700">⚠ הצעת מחיר דחופה</div>' : ''}
    <h2 style="color:#123a86">הזמנה #${b.booking_id} · ${b.status}${b.low_cost === 'Y' ? ' · LOW COST' : ''}</h2>
    <table style="border-collapse:collapse">
      ${row('נתיב', [b.origin_iata, b.dest_iata].filter(Boolean).join(' → '))}
      ${row('תאריך יציאה', b.departure_date)}
      ${row('נוסעים', b.pax_count)}
      ${row('מחיר', b.price != null ? `${b.price} ${b.currency_code}` : '')}
      ${row('PNR', b.pnr)}
    </table>
    ${approveUrl ? `<p><a href="${approveUrl}" style="background:#0e7a4e;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">✔ אשר את ההצעה</a></p>` : ''}
    <p><a href="${BASE}/api/app#b=${b.booking_id}">לצפייה בהזמנה</a></p>
  </div>`;
}

// ── workflow engine (replaces booking_pkg.change_status) ──
async function changeStatus(bookingId, newStatus, actorId, note) {
  const b = await one(`SELECT * FROM bookings WHERE booking_id=$1`, [bookingId]);
  const from = b.status;
  await q(`UPDATE bookings SET status=$1, updated_at=now() WHERE booking_id=$2`, [newStatus, bookingId]);
  await q(`INSERT INTO booking_status_log(booking_id,from_status,to_status,action_by,note) VALUES ($1,$2,$3,$4,$5)`,
    [bookingId, from, newStatus, actorId, note || null]);

  const tpls = await q(`SELECT * FROM notif_templates WHERE status_code=$1`, [newStatus]);
  for (const t of tpls) {
    const recips = await recipientUsers(b, t.recipient_role);
    for (const u of recips) {
      const msg = (u.pref_lang === 'EN' ? t.msg_en : t.msg_he).replace(/%ID%/g, bookingId);
      const subj = (u.pref_lang === 'EN' ? t.subject_en : t.subject_he);
      await q(`INSERT INTO notifications(user_id,booking_id,notif_type,message) VALUES ($1,$2,$3,$4)`,
        [u.user_id, bookingId, newStatus, msg]);
      if (u.email && u.notify_email === 'Y')
        await sendTracked({ to: u.email, subject: `ארקיע — ${subj} #${bookingId}`, text: msg,
          html: emailHtml({ ...b, status: newStatus }), meta: { booking_id: bookingId, user_id: u.user_id, kind: 'STATUS:' + newStatus } });
    }
  }
}

// recipient resolution for a template role
async function recipientUsers(b, role) {
  if (role === 'INITIATOR') return q(`SELECT * FROM app_users WHERE user_id=$1 AND is_active='Y'`, [b.initiator_id]);
  if (role === 'AGENT') return q(`SELECT u.* FROM app_users u JOIN agents a ON a.user_id=u.user_id WHERE a.agent_id=$1 AND u.is_active='Y'`, [b.agent_id]);
  if (role === 'APPROVER')
    return q(`SELECT * FROM app_users WHERE is_active='Y' AND user_id IN (
                SELECT approver_user_id FROM dept_approvers WHERE dept_id=$1
                UNION SELECT $2::bigint WHERE $2 IS NOT NULL)`, [b.dept_id, b.approver_id]);
  return [];
}

// email every active agent (open pool) on new request
async function notifyAgents(bookingId) {
  const b = await one(`SELECT * FROM bookings WHERE booking_id=$1`, [bookingId]);
  const agents = await q(`SELECT u.* FROM app_users u JOIN agents a ON a.user_id=u.user_id WHERE a.is_active='Y' AND u.is_active='Y'`);
  for (const u of agents) {
    await q(`INSERT INTO notifications(user_id,booking_id,notif_type,message) VALUES ($1,$2,'AWAITING_QUOTE',$3)`,
      [u.user_id, bookingId, `בקשה חדשה להצעת מחיר #${bookingId}`]);
    if (u.email && u.notify_email === 'Y')
      await sendTracked({ to: u.email, subject: `ארקיע — בקשה חדשה להצעת מחיר #${bookingId}`,
        text: 'התקבלה בקשה חדשה הממתינה להצעת מחיר.', html: emailHtml(b),
        meta: { booking_id: bookingId, user_id: u.user_id, kind: 'AGENT_REQUEST' } });
  }
}

// email every dept approver with a one-time approve token
async function notifyApproverQuote(bookingId) {
  const b = await one(`SELECT * FROM bookings WHERE booking_id=$1`, [bookingId]);
  const approvers = await recipientUsers(b, 'APPROVER');
  for (const u of approvers) {
    const token = randToken(24);
    await q(`INSERT INTO booking_action_tokens(token,booking_id,action,user_id,expires_at) VALUES ($1,$2,'approve',$3, now()+interval '7 days')`,
      [token, bookingId, u.user_id]);
    await q(`INSERT INTO notifications(user_id,booking_id,notif_type,message) VALUES ($1,$2,'QUOTE_RECEIVED',$3)`,
      [u.user_id, bookingId, `התקבלה הצעת מחיר להזמנה #${bookingId} — נדרש אישור`]);
    if (u.email && u.notify_email === 'Y')
      await sendTracked({ to: u.email, subject: `ארקיע — נדרש אישור, הזמנה #${bookingId}`,
        text: 'התקבלה הצעת מחיר הממתינה לאישורך.',
        html: emailHtml(b, `${BASE}/api/act?t=${token}`),
        meta: { booking_id: bookingId, user_id: u.user_id, kind: 'APPROVER_QUOTE' } });
  }
}

async function canApprove(user, b) {
  if (hasRole(user, 'ADMIN')) return true;
  if (b.approver_id === user.user_id) return true;
  const r = await one(`SELECT 1 FROM dept_approvers WHERE dept_id=$1 AND approver_user_id=$2`, [b.dept_id, user.user_id]);
  return !!r;
}

// POST /api/bookings — list visible to caller
router.post('/bookings', requireAuth, async (req, res) => {
  const u = req.user;
  let where = '1=1', params = [];
  if (hasRole(u, 'FINANCE') || hasRole(u, 'ADMIN')) { /* all */ }
  else if (hasRole(u, 'AGENT')) { where = `(b.agent_id=$1 OR b.agent_id IS NULL)`; params = [u.agent_id]; }
  else { where = `b.dept_id=$1`; params = [u.dept_id]; }
  const rows = await q(
    `SELECT b.booking_id id, b.booking_id seq, b.status, b.dept_id, b.origin_iata origin, b.dest_iata dest,
            b.price, b.currency_code currency, b.low_cost, b.urgent, b.departure_date
       FROM bookings b WHERE ${where} ORDER BY b.booking_id DESC`, params);
  res.json({ ok: true, bookings: rows });
});

// POST /api/bookings/get — detail + files + timeline + can_approve
router.post('/bookings/get', requireAuth, async (req, res) => {
  const b = await one(`SELECT * FROM bookings WHERE booking_id=$1`, [req.body.id]);
  if (!b) return res.json({ ok: false, error: 'not_found' });
  const files = await q(`SELECT file_id id, file_kind kind, filename, mime_type mime FROM booking_files WHERE booking_id=$1 ORDER BY file_id`, [b.booking_id]);
  const log = await q(`SELECT l.from_status "from", l.to_status "to", u.full_name "by",
                              to_char(l.action_at,'YYYY-MM-DD HH24:MI') at, l.note
                         FROM booking_status_log l JOIN app_users u ON u.user_id=l.action_by
                        WHERE l.booking_id=$1 ORDER BY l.action_at DESC`, [b.booking_id]);
  const booking = { id: b.booking_id, seq: b.booking_id, status: b.status, dept_id: b.dept_id,
    initiator_id: b.initiator_id, agent_id: b.agent_id, approver_id: b.approver_id,
    departure_date: b.departure_date, open_date: b.open_date, ticketing_date: b.ticketing_date,
    price: b.price, currency: b.currency_code, pnr: b.pnr, quote_notes: b.quote_notes,
    trip_details: b.trip_details, rejection_reason: b.rejection_reason, cancel_reason: b.cancel_reason,
    pax: b.pax_count, pref_time: b.pref_time, origin: b.origin_iata, dest: b.dest_iata,
    wet_op_id: b.wet_operator_id, low_cost: b.low_cost, urgent: b.urgent,
    can_approve: (await canApprove(req.user, b)) ? 'Y' : 'N' };
  res.json({ ok: true, booking, files, log });
});

// POST /api/bookings/create
router.post('/bookings/create', requireAuth, async (req, res) => {
  const u = req.user, body = req.body;
  const firstApprover = await one(`SELECT MIN(approver_user_id) a FROM dept_approvers WHERE dept_id=$1`, [u.dept_id]);
  const r = await one(
    `INSERT INTO bookings(dept_id,initiator_id,approver_id,status,open_date,departure_date,pax_count,pref_time,wet_operator_id,origin_iata,dest_iata,quote_notes)
     VALUES ($1,$2,$3,'AWAITING_QUOTE',CURRENT_DATE,$4,$5,$6,$7,upper($8),upper($9),$10) RETURNING booking_id`,
    [u.dept_id, u.user_id, firstApprover ? firstApprover.a : null,
     body.departure || null, body.pax || 1, body.pref_time || null, body.wet_op || null,
     body.origin || null, body.dest || null, body.notes || null]);
  await q(`INSERT INTO booking_status_log(booking_id,from_status,to_status,action_by,note) VALUES ($1,NULL,'AWAITING_QUOTE',$2,'נפתחה הזמנה')`, [r.booking_id, u.user_id]);
  notifyAgents(r.booking_id).catch(() => {});
  res.json({ ok: true, id: r.booking_id });
});

// POST /api/bookings/action
router.post('/bookings/action', requireAuth, async (req, res) => {
  try {
    const u = req.user, { id, action } = req.body;
    const b = await one(`SELECT * FROM bookings WHERE booking_id=$1`, [id]);
    if (!b) return res.json({ ok: false, error: 'not_found' });

    if (action === 'submit_quote') {
      if (!b.agent_id) await q(`UPDATE bookings SET agent_id=(SELECT agent_id FROM agents WHERE user_id=$1) WHERE booking_id=$2 AND agent_id IS NULL`, [u.user_id, id]);
      await q(`UPDATE bookings SET low_cost=$1, price=$2, currency_code=COALESCE($3,currency_code), trip_details=$4, quote_notes=$5 WHERE booking_id=$6`,
        [req.body.low_cost === 'Y' ? 'Y' : 'N', req.body.price || null, req.body.currency || null, req.body.trip || null, req.body.notes || null, id]);
      await changeStatus(id, 'QUOTE_RECEIVED', u.user_id, null);
      await notifyApproverQuote(id);
    } else if (action === 'approve' || action === 'reject') {
      if (!await canApprove(u, b)) return res.json({ ok: false, error: 'forbidden' });
      if (action === 'reject') await q(`UPDATE bookings SET rejection_reason=$1 WHERE booking_id=$2`, [req.body.reason || null, id]);
      await changeStatus(id, action === 'approve' ? 'APPROVED' : 'REJECTED', u.user_id, req.body.reason || req.body.notes || null);
    } else if (action === 'ticket') {
      await q(`UPDATE bookings SET pnr=$1, ticketing_date=CURRENT_DATE WHERE booking_id=$2`, [req.body.pnr || null, id]);
      await changeStatus(id, 'TICKETED', u.user_id, null);
    } else if (action === 'request_cancel') {
      if (b.status === 'TICKETED') {
        await q(`UPDATE bookings SET cancel_reason=$1, cancel_requested_by=$2, cancel_requested_at=now() WHERE booking_id=$3`, [req.body.reason || null, u.user_id, id]);
        await changeStatus(id, 'CANCEL_REQUESTED', u.user_id, req.body.reason || null);
      } else {
        await q(`UPDATE bookings SET cancel_reason=$1, cancel_requested_by=$2, cancel_requested_at=now() WHERE booking_id=$3`, [req.body.reason || null, u.user_id, id]);
        await changeStatus(id, 'CANCELLED', u.user_id, req.body.reason || null);
      }
    } else if (action === 'confirm_cancel') {
      await changeStatus(id, 'CANCELLED', u.user_id, req.body.notes || null);
    } else {
      return res.json({ ok: false, error: 'unknown_action' });
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.json({ ok: false, error: 'server_error' }); }
});

// POST /api/files/upload  {booking_id,kind,filename,mime,data(base64)}
router.post('/files/upload', requireAuth, async (req, res) => {
  const buf = Buffer.from(req.body.data || '', 'base64');
  await q(`INSERT INTO booking_files(booking_id,file_kind,filename,mime_type,file_blob,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [req.body.booking_id, req.body.kind, req.body.filename, req.body.mime || null, buf, req.user.user_id]);
  res.json({ ok: true });
});
// GET /api/files/:id
router.get('/files/:id', async (req, res) => {
  const f = await one(`SELECT filename, mime_type, file_blob FROM booking_files WHERE file_id=$1`, [req.params.id]);
  if (!f) return res.status(404).end();
  res.type(f.mime_type || 'application/octet-stream').send(f.file_blob);
});

// POST /api/bookings/edit  — TODO: port edit_booking (see ENDPOINTS.md)
router.post('/bookings/edit', requireAuth, (_req, res) => res.json({ ok: false, error: 'not_implemented' }));
// POST /api/agent/quote/create — TODO: port agent_create_quote (urgent, status QUOTE_RECEIVED)
router.post('/agent/quote/create', requireAuth, (_req, res) => res.json({ ok: false, error: 'not_implemented' }));

module.exports = router;
module.exports.changeStatus = changeStatus; // reused by act-from-email
