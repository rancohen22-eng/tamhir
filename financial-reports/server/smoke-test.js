'use strict';
/* בדיקת עשן מקצה לקצה מול השרת (development / SQLite). */
const http = require('http');
const ExcelJS = require('exceljs');
const app = require('./index');

let cookie = '';
function req(method, path, { json, raw, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw || (json ? JSON.stringify(json) : null);
    const r = http.request({ method, path, host: '127.0.0.1', port: server.address().port,
      headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.headers['set-cookie']) cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
        const buf = Buffer.concat(chunks);
        const ct = res.headers['content-type'] || '';
        resolve({ status: res.statusCode, body: ct.includes('json') ? JSON.parse(buf.toString() || '{}') : buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function makeXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('מאזן בוחן');
  ws.addRow(['סעיף', 'חשבון', 'תאור החשבון', 'חברה', 'יתרה', 'כותרת ראשית']);
  ws.addRow(['111', '2100200000', 'בנק הפועלים', 'ארקיע', 70.53, 'נכסים']);
  ws.addRow(['111', '2100400000', 'בנק לאומי', 'ארקיע', 1000, 'נכסים']);
  ws.addRow(['610', '2171300000', 'עמלות סוכנים', 'ארקיע', -5000, 'רווח והפסד']);
  return wb.xlsx.writeBuffer();
}

let server;
(async () => {
  server = app.listen(0);
  const A = (label, ok) => console.log(`${ok ? '✓' : '✗ FAIL'} ${label}`);
  try {
    let r = await req('POST', '/api/auth/login', { json: { username: 'admin', password: 'Arkia2026!' } });
    A('login', r.status === 200 && r.body.is_admin);

    r = await req('GET', '/api/companies');
    A('list companies', r.status === 200 && r.body.length >= 5);
    const companyId = r.body[0].id;

    r = await req('GET', '/api/periods');
    const periodId = r.body[0].id;
    A('list periods', r.status === 200 && !!periodId);

    r = await req('POST', '/api/versions', { json: { company_id: companyId, period_id: periodId, name: 'בדיקה' } });
    A('create version', r.status === 200 && r.body.id);
    const versionId = r.body.id;

    // ייבוא מאזן בוחן
    const xlsx = await makeXlsx();
    const boundary = '----smoke' + Date.now();
    const opts = JSON.stringify({ sheetName: 'מאזן בוחן', headerRow: 1, dataStartRow: 2,
      map: { tb_section_code: 1, account_no: 2, account_name: 3, amount: 5, main_header: 6 } });
    const parts = [];
    const push = (name, val, filename) => {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ''}\r\n${filename ? 'Content-Type: application/octet-stream\r\n' : ''}\r\n`));
      parts.push(Buffer.isBuffer(val) ? val : Buffer.from(String(val)));
      parts.push(Buffer.from('\r\n'));
    };
    push('version_id', versionId);
    push('options', opts);
    push('file', Buffer.from(xlsx), 'tb.xlsx');
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    r = await req('POST', '/api/trial-balance/import', { raw: Buffer.concat(parts), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
    A('import trial balance (3 rows)', r.status === 200 && r.body.imported === 3);

    r = await req('GET', `/api/trial-balance/by-section?version_id=${versionId}`);
    A('trial balance by-section', r.status === 200 && r.body.length === 2);

    // עץ שורות דוח: יוצרים שורה למאזן ולרו"ה
    r = await req('POST', '/api/fs-lines', { json: { company_id: companyId, statement: 'balance', label: 'מזומנים ושווי מזומנים', kind: 'line', note_ref: '4' } });
    const cashLine = r.body.id;
    r = await req('POST', '/api/fs-lines', { json: { company_id: companyId, statement: 'pnl', label: 'עמלות', kind: 'line' } });
    const commLine = r.body.id;
    A('create fs lines', !!cashLine && !!commLine);

    // זריעת אינדקס מהגרסה + מיפוי
    r = await req('POST', '/api/index-map/seed-from-version', { json: { version_id: versionId } });
    A('seed index from version', r.status === 200 && r.body.added === 2);
    await req('PUT', '/api/index-map', { json: { company_id: companyId, tb_section_code: '111', fs_line_id: cashLine } });
    await req('PUT', '/api/index-map', { json: { company_id: companyId, tb_section_code: '610', fs_line_id: commLine } });

    // פקודה נוספת
    r = await req('POST', '/api/adjustments', { json: { version_id: versionId, tb_section_code: '111', purpose: 'התאמה', amount: 500 } });
    A('create adjustment', r.status === 200);

    // מיון
    r = await req('POST', '/api/reclass', { json: { version_id: versionId, from_section: '111', to_section: '610', amount: 100 } });
    A('create reclass', r.status === 200);

    // חישוב דוח: מזומנים = 70.53+1000+500(adj)-100(reclass out)=1470.53 ; עמלות=-5000+100=-4900
    r = await req('GET', `/api/reports?version_id=${versionId}`);
    const cash = r.body.balance.find((l) => l.id === cashLine);
    const comm = r.body.pnl.find((l) => l.id === commLine);
    A(`report cash=${cash && cash.amount} (expect ~1470.53)`, cash && Math.abs(cash.amount - 1470.53) < 0.01);
    A(`report commissions=${comm && comm.amount} (expect -4900)`, comm && Math.abs(comm.amount - (-4900)) < 0.01);

    // תחקור
    r = await req('GET', `/api/reports/drill/${cashLine}?version_id=${versionId}`);
    A('drill down to accounts', r.status === 200 && r.body.sections[0].accounts.length === 2);

    // ייצוא Word
    r = await req('GET', `/api/reports/export/word?version_id=${versionId}`);
    A(`export word (${r.body.length} bytes)`, r.status === 200 && r.body.length > 2000 && r.body.slice(0, 2).toString() === 'PK');

    // בדיקת הרשאות: משתמש צפייה לא יכול לערוך
    await req('POST', '/api/users', { json: { username: 'viewer1', password: 'View123!', is_admin: false } });
    r = await req('GET', '/api/users');
    const viewer = r.body.find((u) => u.username === 'viewer1');
    await req('PUT', `/api/users/${viewer.id}/permissions`, { json: { permissions: [{ company_id: companyId, level: 'view' }] } });
    await req('POST', '/api/auth/logout');
    cookie = '';
    await req('POST', '/api/auth/login', { json: { username: 'viewer1', password: 'View123!' } });
    r = await req('POST', '/api/adjustments', { json: { version_id: versionId, tb_section_code: '111', amount: 1 } });
    A('viewer blocked from editing (403)', r.status === 403);
    r = await req('GET', `/api/reports?version_id=${versionId}`);
    A('viewer can view report', r.status === 200);

    console.log('\nSMOKE TEST DONE');
  } catch (e) {
    console.error('SMOKE ERROR:', e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
})();
