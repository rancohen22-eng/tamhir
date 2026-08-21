'use strict';
/*
 * הגדרות Knex לשתי סביבות:
 *  - development: SQLite (קובץ מקומי) — לפיתוח ובדיקות ללא תלות בשרת DB.
 *  - production : Oracle Autonomous Database דרך node-oracledb (Thin mode).
 *
 * הלוגיקה זהה בשתי הסביבות (Knex query builder). המעבר לפרודקשן = הגדרת
 * משתני סביבה בלבד (ראה .env.example).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const migrations = { directory: path.join(__dirname, 'migrations') };
const seeds = { directory: path.join(__dirname, 'seeds') };

module.exports = {
  development: {
    client: 'sqlite3',
    connection: { filename: process.env.SQLITE_FILE || path.join(__dirname, '..', '..', 'data.dev.sqlite') },
    useNullAsDefault: true,
    migrations,
    seeds,
    pool: {
      afterCreate: (conn, cb) => conn.run('PRAGMA foreign_keys = ON', cb),
    },
  },

  production: {
    client: 'oracledb',
    connection: {
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      // connectString = שם TNS מתוך tnsnames.ora שב-wallet (למשל arkiafr_high).
      connectString: process.env.ORACLE_CONNECT_STRING,
      // Thin mode mTLS מול Autonomous DB: תיקיית ה-wallet (מכילה tnsnames.ora +
      // ewallet.pem) וסיסמת ה-wallet שנקבעה בעת ההורדה מ-OCI.
      configDir: process.env.TNS_ADMIN,
      walletLocation: process.env.TNS_ADMIN,
      walletPassword: process.env.ORACLE_WALLET_PASSWORD || undefined,
    },
    migrations,
    seeds,
    // min:0 — לא לפתוח חיבורים בזמן יצירת ה-pool. הצמדת min>0 גורמת ל-Knex
    // לנסות לפתוח חיבורים מיד, ולחיצת יד ה-mTLS הראשונה מול Autonomous DB
    // איטית ולעיתים חורגת מ-acquireConnectionTimeout → KnexTimeoutError
    // ("operation timed out") עוד לפני שה-migrate מתחיל. עם min:0 החיבור
    // נפתח עצלן בעת השאילתה הראשונה בפועל.
    pool: {
      min: 0,
      max: 10,
      // זמן להמתין ליצירת חיבור חדש בתוך ה-pool (ברירת מחדל oracledb: 60ש').
      acquireTimeoutMillis: 120000,
      createTimeoutMillis: 120000,
    },
    // הזמן ש-Knex ממתין ל-acquire מה-pool לפני KnexTimeoutError.
    acquireConnectionTimeout: 120000,
  },
};
