#!/usr/bin/env node
/**
 * rekey.mjs — יצירת/עדכון פרטי ההתחברות (שם משתמש + סיסמה) עבור "ריכוז הלוואות".
 *
 * הנתונים באפליקציה מוצפנים ב-AES-GCM עם "מפתח ראשי" (master key) אקראי.
 * המפתח הראשי נעטף (wrap) במפתח שנגזר (PBKDF2) משם המשתמש + הסיסמה + salt ייחודי.
 * כלומר: בלי סיסמה נכונה אי אפשר לפענח את המפתח הראשי — וממילא לא את הנתונים.
 *
 * שימוש:
 *   node rekey.mjs <username> <password> [username2 password2 ...]
 *
 * כל המשתמשים חולקים את אותו מפתח ראשי, כך שכולם רואים את אותם נתונים.
 * הפלט הוא בלוק USERS שיש להדביק בתוך index.html (חפשו: const USERS = ...).
 *
 * אם לא מועברים ארגומנטים — נוצרים ברירות המחדל: hashavut / Arkia2026!
 */

import { webcrypto as crypto } from 'node:crypto';

const KDF_ITERATIONS = 250000;

const b64 = (buf) => Buffer.from(buf).toString('base64');

async function deriveWrapKey(username, password, salt) {
  const km = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(username.toLowerCase() + '\n' + password),
    'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
}

async function main() {
  let args = process.argv.slice(2);
  if (args.length === 0) args = ['hashavut', 'Arkia2026!'];
  if (args.length % 2 !== 0) {
    console.error('שגיאה: יש להעביר זוגות של <username> <password>.');
    process.exit(1);
  }

  // מפתח ראשי אקראי — משותף לכל המשתמשים, מצפין את הנתונים.
  const masterRaw = crypto.getRandomValues(new Uint8Array(32));

  const users = [];
  for (let i = 0; i < args.length; i += 2) {
    const u = args[i];
    const p = args[i + 1];
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapKey = await deriveWrapKey(u, p, salt);
    const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, masterRaw);
    users.push({ u, s: b64(salt), iv: b64(iv), w: b64(wrapped) });
  }

  console.log('// ── הדביקו את הבלוק הבא ב-index.html (מחליף את const USERS ...) ──');
  console.log('const USERS = ' + JSON.stringify(users, null, 2) + ';');
  console.log('\n// פרטי ההתחברות שנוצרו:');
  for (let i = 0; i < args.length; i += 2) {
    console.log(`//   משתמש: ${args[i]}   סיסמה: ${args[i + 1]}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
