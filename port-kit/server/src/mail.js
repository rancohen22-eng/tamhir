// Email via internal SMTP (nodemailer) + read-tracking pixel + email_log.
const nodemailer = require('nodemailer');
const { randToken } = require('./auth');
const { one, q } = require('./db');

const BASE = process.env.APP_BASE_URL || '';
const FROM = process.env.MAIL_FROM || 'bookings@arkia.co.il';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE) === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
});

// 1x1 transparent GIF returned by GET /api/track
const PIXEL_GIF = Buffer.from(
  '47494638396101000100800000000000FFFFFF21F90401000000002C00000000010001000002024C01003B', 'hex');

// logs an email_log row and returns the <img> pixel HTML to append to the body
async function trackPixel({ booking_id = null, recipient, user_id = null, kind, subject }) {
  const token = randToken(24);
  try {
    await q(
      `INSERT INTO email_log(token,booking_id,recipient,user_id,kind,subject)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [token, booking_id, recipient, user_id, kind, (subject || '').slice(0, 300)]
    );
    return `<img src="${BASE}/api/track?t=${token}" width="1" height="1" alt="" style="display:none">`;
  } catch (e) { console.error('trackPixel', e); return ''; }
}

// send one tracked HTML email (best-effort; never throws)
async function sendTracked({ to, subject, text, html, meta }) {
  try {
    const pixel = await trackPixel({ recipient: to, subject, ...meta });
    await transporter.sendMail({ from: FROM, to, subject, text, html: (html || '') + pixel });
    return true;
  } catch (e) { console.error('sendMail', e); return false; }
}

// mark pixel opened (GET /api/track)
async function markOpened(token) {
  try {
    await q(
      `UPDATE email_log SET opened='Y', opened_at=COALESCE(opened_at, now()),
              open_count=COALESCE(open_count,0)+1 WHERE token=$1`, [token]);
  } catch (e) { /* ignore */ }
}

module.exports = { transporter, sendTracked, trackPixel, markOpened, PIXEL_GIF, BASE, FROM, one };
