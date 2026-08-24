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

// --- תיקון wallet ל-Knex↔Oracle Autonomous (Thin mode) ---
// ה-dialect של Knex ל-oracledb (acquireRawConnection) בונה מחדש את קונפיג החיבור
// ומעביר רק user/password/connectString — ומשמיט את שדות ה-wallet
// (configDir/walletLocation/walletPassword). בלי סיסמת ה-wallet, oracledb לא מצליח
// לפענח את ewallet.pem, לחיצת היד של ה-mTLS נתקעת, וה-pool נכשל ב-timeout.
// כאן אנו עוטפים את getConnection של אותו מופע מודול ש-Knex יטען דרך require('oracledb')
// (נטען פעם אחת ומוחזק ב-cache) ומזריקים בחזרה את שדות ה-wallet מ-.env, כך שהחיבור
// זהה לבדיקה הגולמית שמצליחה. אידמפוטנטי, מוגן ל-Oracle בלבד, ולא משפיע על פיתוח SQLite.
if (process.env.ORACLE_USER && process.env.TNS_ADMIN) {
  try {
    const oracledb = require('oracledb');
    if (!oracledb.__walletPatched) {
      const origGetConnection = oracledb.getConnection.bind(oracledb);
      oracledb.getConnection = function (cfg, cb) {
        if (cfg && typeof cfg === 'object' && cfg.walletLocation === undefined) {
          cfg = Object.assign({}, cfg, {
            configDir: process.env.TNS_ADMIN,
            walletLocation: process.env.TNS_ADMIN,
            walletPassword: process.env.ORACLE_WALLET_PASSWORD || undefined,
          });
        }
        return origGetConnection(cfg, cb);
      };
      oracledb.__walletPatched = true;
    }
  } catch (e) {
    // oracledb לא זמין (סביבת SQLite) — מתעלמים
  }
}

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
      // Autonomous DB מפעיל parallel DML כברירת מחדל → ORA-12838 כאשר מנעול
      // המיגרציה של Knex עושה insert ואז select על אותה טבלה באותה טרנזקציה.
      // מכבים parallel DML לכל session חדש (גם migrate/seed וגם ריצת השרת).
      // connection הוא חיבור oracledb ש-Knex עוטף עם executeAsync (מחזיר promise);
      // done הוא callback node-style ש-Knex מפעיל דרך promisify.
      afterCreate: (connection, done) => {
        connection
          .executeAsync('ALTER SESSION DISABLE PARALLEL DML', [], {})
          .then(() => done(null, connection))
          .catch((err) => done(err, connection));
      },
    },
    // הזמן ש-Knex ממתין ל-acquire מה-pool לפני KnexTimeoutError.
    acquireConnectionTimeout: 120000,
  },
};
