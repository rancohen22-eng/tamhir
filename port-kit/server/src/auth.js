// Auth helpers: session tokens, middleware, password hashing.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { one, q } = require('./db');

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const MIN_PW = Number(process.env.MIN_PASSWORD_LEN || 8);

const randToken = (bytes = 16) => crypto.randomBytes(bytes).toString('hex');

async function hashPassword(plain) { return bcrypt.hash(plain, 10); }
async function verifyPassword(plain, hash) {
  if (!hash) return false;
  try { return await bcrypt.compare(plain, hash); } catch { return false; }
}

// create a 30-day session, return token
async function createSession(userId) {
  const token = randToken(16);
  await q(
    `INSERT INTO api_sessions(token,user_id,expires_at) VALUES ($1,$2, now() + ($3 || ' days')::interval)`,
    [token, userId, SESSION_DAYS]
  );
  return token;
}

// resolve a token -> user row (with roles, agent_id) or null
async function resolveSession(token) {
  if (!token) return null;
  const s = await one(
    `SELECT u.* FROM api_sessions s JOIN app_users u ON u.user_id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now() AND u.is_active = 'Y'`,
    [token]
  );
  if (!s) return null;
  const roles = (await q(`SELECT role_code FROM user_roles WHERE user_id=$1`, [s.user_id])).map(r => r.role_code);
  const agent = await one(`SELECT agent_id FROM agents WHERE user_id=$1`, [s.user_id]);
  s.roles = roles;
  s.agent_id = agent ? agent.agent_id : null;
  return s;
}

// express middleware: require a valid session; attaches req.user
async function requireAuth(req, res, next) {
  const token = req.body.token || req.query.token;
  const user = await resolveSession(token);
  if (!user) return res.json({ ok: false, error: 'invalid_or_expired_token' });
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.roles.includes('ADMIN'))
    return res.json({ ok: false, error: 'forbidden' });
  next();
}
const hasRole = (user, role) => !!user && user.roles.includes(role);

module.exports = {
  randToken, hashPassword, verifyPassword, createSession, resolveSession,
  requireAuth, requireAdmin, hasRole, MIN_PW,
};
