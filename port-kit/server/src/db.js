// PostgreSQL pool + tiny query helpers.
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (e) => console.error('pg pool error', e));

// q(text, params) -> rows[]
async function q(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}
// one(text, params) -> first row or null
async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}

module.exports = { pool, q, one };
