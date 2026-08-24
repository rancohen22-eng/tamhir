'use strict';
/*
 * אבחון התחברות: מתחבר ל-DB בדיוק כמו השרת (production=Oracle), ומדפיס את
 * מצב משתמש ה-admin + בדיקת סיסמה. הרצה: node server/diag-login.js
 */
const bcrypt = require('bcryptjs');
const knex = require('./db');

(async () => {
  console.log('סביבה (NODE_ENV):', process.env.NODE_ENV || '(לא מוגדר)');
  console.log('DB client:', knex.client && knex.client.config && knex.client.config.client);
  try {
    const users = await knex('users').select('id', 'username', 'full_name', 'is_active', 'is_admin', 'password_hash');
    console.log('מספר משתמשים בטבלה:', users.length);
    for (const u of users) {
      console.log('---');
      console.log('  id:', u.id, '| username:', JSON.stringify(u.username));
      console.log('  is_active:', u.is_active, '(typeof', typeof u.is_active + ')');
      console.log('  is_admin :', u.is_admin, '(typeof', typeof u.is_admin + ')');
      console.log('  hash length:', u.password_hash ? u.password_hash.length : 0, '| prefix:', u.password_hash ? u.password_hash.slice(0, 7) : '(ריק)');
      if (u.username && u.username.toLowerCase() === 'admin') {
        console.log('  bcrypt.compareSync("Arkia2026!"):', bcrypt.compareSync('Arkia2026!', u.password_hash || ''));
      }
    }
    if (!users.length) console.log('>>> אין משתמשים כלל — ה-seed לא רץ בהצלחה מול ה-DB הזה.');
  } catch (e) {
    console.error('שגיאה בשאילתה:', e.message);
  } finally {
    await knex.destroy();
  }
})();
