'use strict';
/* ═══════════ מצב גלובלי ═══════════ */
const S = {
  user: null,
  companies: [], periods: [], versions: [],
  companyId: null, periodId: null, versionId: null,
  level: null, // רמת הרשאה לחברה הנוכחית
  tab: 'tb',
  stmtTab: 'balance', // תת-לשונית בדוחות ראשיים
  units: 1000, // יחידות תצוגה בדוחות: 1000=אלפי דולר, 1=דולר מלא
};
const uMoney = (v) => nf.format(Math.round((Number(v) || 0) / S.units));

/* ═══════════ עזרי DOM ═══════════ */
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  }
  kids.flat().forEach((c) => { if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return e;
};
const nf = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v) => (v == null ? '' : nf.format(Math.round(Number(v) || 0)));
const canEdit = () => S.level === 'edit';

function toast(msg, isErr) {
  const t = el('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}
async function guard(fn) { try { await fn(); } catch (e) { toast(e.message || 'שגיאה', true); if (e.status === 401) location.reload(); } }

function modal(title, contentNode, onSave, saveLabel) {
  const bg = el('div', { class: 'modal-bg' });
  const close = () => bg.remove();
  const box = el('div', { class: 'modal' },
    el('h3', {}, title), contentNode,
    el('div', { class: 'toolbar', style: 'margin-top:14px; justify-content:flex-end' },
      el('button', { class: 'btn sec', onclick: close }, 'ביטול'),
      onSave ? el('button', { class: 'btn', onclick: () => guard(async () => { const ok = await onSave(); if (ok !== false) close(); }) }, saveLabel || 'שמירה') : null,
    ));
  bg.append(box);
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  document.body.append(bg);
  return { close };
}

/* ═══════════ התחברות ═══════════ */
$('lockForm').addEventListener('submit', (e) => {
  e.preventDefault();
  $('lockErr').textContent = '';
  guard(async () => {
    try {
      S.user = await API.post('/auth/login', { username: $('usr').value, password: $('pw').value });
      await startApp();
    } catch (err) { $('lockErr').textContent = err.message; }
  });
});
$('logoutBtn').addEventListener('click', () => guard(async () => { await API.post('/auth/logout'); location.reload(); }));

/* ═══════════ אתחול אפליקציה ═══════════ */
async function startApp() {
  $('lock').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('who').textContent = (S.user.full_name || S.user.username) + (S.user.is_admin ? ' · מנהל' : '');
  S.companies = await API.get('/companies');
  S.periods = await API.get('/periods');
  buildContextSelectors();
  buildTabs();
  if (S.companies.length && S.periods.length) {
    S.companyId = S.companies[0].id;
    S.periodId = S.periods[0].id;
    await reloadVersions();
  }
  render();
}

function buildContextSelectors() {
  const cc = $('ctxCompany'); cc.innerHTML = '';
  S.companies.forEach((c) => cc.append(el('option', { value: c.id }, c.name)));
  cc.onchange = () => guard(async () => { S.companyId = Number(cc.value); await reloadVersions(); buildTabs(); render(); });

  const cp = $('ctxPeriod'); cp.innerHTML = '';
  S.periods.forEach((p) => cp.append(el('option', { value: p.id }, p.label || `${p.fiscal_year} · ${p.as_of_date}`)));
  cp.onchange = () => guard(async () => { S.periodId = Number(cp.value); await reloadVersions(); render(); });

  $('ctxVersion').onchange = () => { S.versionId = Number($('ctxVersion').value) || null; render(); };
  $('newVersionBtn').onclick = newVersionDialog;
  $('cloneVersionBtn').onclick = cloneVersionDialog;
}

async function reloadVersions() {
  const comp = S.companies.find((c) => c.id === S.companyId);
  S.level = comp ? comp.level : null;
  $('ctxLevel').textContent = S.level === 'edit' ? 'עריכה' : (S.level === 'view' ? 'צפייה' : 'אין הרשאה');
  S.versions = [];
  S.versionId = null;
  if (S.companyId && S.periodId && S.level) {
    S.versions = await API.get(`/versions?company_id=${S.companyId}&period_id=${S.periodId}`);
    if (S.versions.length) S.versionId = S.versions[0].id;
  }
  const cv = $('ctxVersion'); cv.innerHTML = '';
  if (!S.versions.length) cv.append(el('option', { value: '' }, '— אין גרסאות —'));
  S.versions.forEach((v) => cv.append(el('option', { value: v.id }, `${v.name} ${v.status === 'final' ? '(סופי)' : ''}`)));
  if (S.versionId) cv.value = S.versionId;
  $('newVersionBtn').disabled = !canEdit() || !S.periodId;
  $('cloneVersionBtn').disabled = !canEdit() || !S.versionId;
}

function newVersionDialog() {
  const name = el('input', { value: 'טיוטה ' + new Date().toLocaleDateString('he-IL') });
  modal('גרסה חדשה', el('div', { class: 'field' }, el('label', {}, 'שם הגרסה'), name), async () => {
    const r = await API.post('/versions', { company_id: S.companyId, period_id: S.periodId, name: name.value });
    await reloadVersions(); S.versionId = r.id; $('ctxVersion').value = r.id; render();
    toast('נוצרה גרסה חדשה');
  });
}
function cloneVersionDialog() {
  const src = S.versions.find((v) => v.id === S.versionId);
  const name = el('input', { value: (src ? src.name : 'גרסה') + ' - עותק' });
  modal('שמירה כגרסה חדשה (Snapshot)', el('div', {}, el('p', { class: 'muted' }, 'ייווצר עותק מלא של נתוני הגרסה הנוכחית.'), el('div', { class: 'field' }, el('label', {}, 'שם הגרסה החדשה'), name)), async () => {
    const r = await API.post(`/versions/${S.versionId}/clone`, { name: name.value });
    await reloadVersions(); S.versionId = r.id; $('ctxVersion').value = r.id; render();
    toast('נשמרה גרסה חדשה');
  });
}

/* ═══════════ טאבים ═══════════ */
const TABS = [
  { id: 'tb', label: 'מאזן בוחן' },
  { id: 'consolidation', label: 'איחוד חברות', cons: true },
  { id: 'structure', label: 'מבנה הדוח' },
  { id: 'index', label: 'אינדקס המרה' },
  { id: 'adj', label: 'פקודות נוספות' },
  { id: 'reclass', label: 'פקודות מיון' },
  { id: 'ifrs16', label: 'IFRS 16' },
  { id: 'report', label: 'דוחות ראשיים' },
  { id: 'audit', label: 'לוג שינויים' },
  { id: 'companies', label: 'חברות', admin: true },
  { id: 'users', label: 'משתמשים', admin: true },
];
function currentCompany() { return S.companies.find((c) => c.id === S.companyId); }
function buildTabs() {
  const nav = $('tabs'); nav.innerHTML = '';
  const cons = currentCompany() && currentCompany().is_consolidated;
  const visible = TABS.filter((t) => (!t.admin || S.user.is_admin) && (!t.cons || cons));
  if (visible.every((t) => t.id !== S.tab)) S.tab = 'tb';
  visible.forEach((t) => {
    nav.append(el('button', { class: S.tab === t.id ? 'active' : '', onclick: () => { S.tab = t.id; buildTabs(); render(); } }, t.label));
  });
}

/* ═══════════ ראוטר תצוגה ═══════════ */
function render() {
  const m = $('main'); m.innerHTML = '';
  if (S.tab === 'users') return void renderUsers(m);
  if (S.tab === 'companies') return void renderCompanies(m);
  if (!S.level) { m.append(el('div', { class: 'card' }, 'אין לך הרשאה לחברה זו.')); return; }
  const needVersion = ['tb', 'adj', 'reclass', 'report', 'audit'].includes(S.tab);
  if (needVersion && !S.versionId) {
    m.append(el('div', { class: 'card' }, 'בחרו או צרו גרסה כדי להתחיל לעבוד. ', canEdit() ? el('button', { class: 'btn sm', onclick: newVersionDialog }, 'גרסה חדשה') : ''));
    return;
  }
  ({ tb: renderTB, consolidation: renderConsolidation, structure: renderStructure, index: renderIndex, adj: renderAdjustments, reclass: renderReclass, ifrs16: renderIFRS16, report: renderReport, audit: renderAudit }[S.tab] || (() => {}))(m);
}

function contextBanner() {
  const c = S.companies.find((x) => x.id === S.companyId);
  const p = S.periods.find((x) => x.id === S.periodId);
  const v = S.versions.find((x) => x.id === S.versionId);
  return el('div', { class: 'muted', style: 'margin-bottom:10px; font-size:13px' },
    `חברה: ${c ? c.name : '—'} · תקופה: ${p ? (p.label || p.fiscal_year) : '—'} · גרסה: ${v ? v.name : '—'}`);
}

/* ═══════════ מאזן בוחן ═══════════ */
async function renderTB(m) {
  m.append(el('h2', { class: 'view-title' }, 'מאזן בוחן'), contextBanner());
  const tools = el('div', { class: 'toolbar' });
  if (canEdit()) tools.append(
    el('button', { class: 'btn sm', onclick: standardImportDialog }, '⬆ ייבוא קובץ סטנדרטי (רב-חברתי)'),
    el('button', { class: 'btn sec sm', onclick: importDialog }, 'ייבוא עם מיפוי עמודות'));
  m.append(tools);
  const wrap = el('div', { class: 'card' }, 'טוען…');
  m.append(wrap);
  await guard(async () => {
    const rows = await API.get(`/trial-balance/by-section?version_id=${S.versionId}`);
    wrap.innerHTML = '';
    if (!rows.length) { wrap.textContent = 'אין נתונים בגרסה זו. ' + (canEdit() ? 'ייבאו מאזן בוחן מאקסל.' : ''); return; }
    const tbl = el('table', { class: 'grid' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'סעיף'), el('th', {}, 'שם סעיף'), el('th', {}, 'כותרת ראשית'),
        el('th', { class: 'num' }, 'יתרה שוטפת'), el('th', { class: 'num' }, 'יתרה קודמת'))));
    const tbody = el('tbody');
    let sum = 0;
    rows.forEach((r) => {
      sum += Number(r.amount) || 0;
      tbody.append(el('tr', {},
        el('td', {}, el('span', { class: 'clickable', onclick: () => drillSection(r.tb_section_code) }, r.tb_section_code || '—')),
        el('td', {}, r.tb_section_name || ''), el('td', {}, r.main_header || ''),
        el('td', { class: 'num' }, money(r.amount)), el('td', { class: 'num' }, money(r.prior_amount))));
    });
    tbl.append(tbody, el('tfoot', {}, el('tr', { class: 'row-total' },
      el('td', { colspan: 3 }, `סה"כ ${rows.length} סעיפים`), el('td', { class: 'num' }, money(sum)), el('td', {}))));
    wrap.append(tbl);
  });
}

async function drillSection(section) {
  await guard(async () => {
    const rows = await API.get(`/trial-balance?version_id=${S.versionId}&section=${encodeURIComponent(section)}`);
    const tbl = el('table', { class: 'grid' }, el('thead', {}, el('tr', {},
      el('th', {}, 'חשבון'), el('th', {}, 'תיאור'), el('th', { class: 'num' }, 'יתרה'))));
    const tb = el('tbody');
    rows.forEach((r) => tb.append(el('tr', {}, el('td', {}, r.account_no), el('td', {}, r.account_name || ''), el('td', { class: 'num' }, nf2.format(Number(r.amount) || 0)))));
    tbl.append(tb);
    modal(`חשבונות בסעיף ${section}`, tbl, null);
  });
}

/* ── ייבוא מאזן בוחן ── */
function importDialog() {
  const file = el('input', { type: 'file', accept: '.xlsx,.xls' });
  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'קובץ אקסל (.xlsx)'), file),
    el('p', { class: 'muted', style: 'font-size:13px' }, 'לאחר הבחירה תוצג תצוגה מקדימה ומיפוי עמודות. הייבוא דורס את מאזן הבוחן בגרסה הנוכחית.'));
  modal('ייבוא מאזן בוחן', body, async () => {
    if (!file.files[0]) { toast('בחרו קובץ', true); return false; }
    const fd = new FormData(); fd.append('file', file.files[0]);
    const preview = await API.postForm('/trial-balance/preview', fd);
    mappingDialog(file.files[0], preview);
    return true;
  }, 'המשך למיפוי');
}

function mappingDialog(fileObj, preview) {
  const sheetSel = el('select', {});
  preview.sheets.forEach((s, i) => sheetSel.append(el('option', { value: i }, `${s.name} (${s.rowCount} שורות)`)));
  const headerRow = el('input', { type: 'number', value: 1, min: 1, style: 'width:80px' });
  const previewBox = el('div', { style: 'overflow:auto; max-height:200px; border:1px solid var(--line); border-radius:8px; margin:8px 0' });
  const FIELDS = [
    ['tb_section_code', 'קוד סעיף מאזן בוחן *'], ['tb_section_name', 'שם סעיף'],
    ['account_no', 'מספר חשבון *'], ['account_name', 'תיאור חשבון'],
    ['main_header', 'כותרת ראשית'], ['sub_header', 'כותרת משנה'],
    ['amount', 'יתרה (שוטפת) *'], ['prior_amount', 'יתרה קודמת'],
  ];
  const selects = {};
  const mapArea = el('div', {});

  function refresh() {
    const s = preview.sheets[Number(sheetSel.value)];
    // תצוגה מקדימה
    previewBox.innerHTML = '';
    const t = el('table', { class: 'grid' });
    s.sample.forEach((row, ri) => {
      const tr = el('tr', {});
      row.forEach((c) => tr.append(ri === 0 ? el('th', {}, c) : el('td', {}, c)));
      t.append(tr);
    });
    previewBox.append(t);
    // בוררי עמודות
    mapArea.innerHTML = '';
    const cols = s.colCount;
    FIELDS.forEach(([key, label]) => {
      const sel = el('select', {});
      sel.append(el('option', { value: '' }, '—'));
      for (let c = 1; c <= cols; c++) {
        const hdr = (s.sample[Number(headerRow.value) - 1] || [])[c - 1] || '';
        sel.append(el('option', { value: c }, `עמ' ${c}${hdr ? ' · ' + hdr : ''}`));
      }
      // ניחוש אוטומטי לפי כותרת
      const hdrRow = s.sample[Number(headerRow.value) - 1] || [];
      const guess = { tb_section_code: 'סעיף', tb_section_name: 'שם סעיף', account_no: 'חשבון', account_name: 'תאור', main_header: 'ראשית', sub_header: 'משנה', amount: 'יתרה', prior_amount: 'קודמת' }[key];
      if (guess) { const gi = hdrRow.findIndex((h) => String(h).includes(guess)); if (gi >= 0) sel.value = gi + 1; }
      selects[key] = sel;
      mapArea.append(el('div', { class: 'field' }, el('label', {}, label), sel));
    });
  }
  sheetSel.onchange = refresh;
  headerRow.onchange = refresh;

  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'גליון'), sheetSel),
    el('div', { class: 'field' }, el('label', {}, 'שורת כותרות'), headerRow),
    el('label', { class: 'muted' }, 'תצוגה מקדימה:'), previewBox,
    el('div', { style: 'display:grid; grid-template-columns:1fr 1fr; gap:0 12px' }, mapArea));
  refresh();
  modal('מיפוי עמודות', body, async () => {
    const map = {};
    Object.entries(selects).forEach(([k, sel]) => { if (sel.value) map[k] = Number(sel.value); });
    if (!map.account_no || !map.amount) { toast('חובה למפות מספר חשבון ויתרה', true); return false; }
    const fd = new FormData();
    fd.append('file', fileObj);
    fd.append('version_id', S.versionId);
    fd.append('options', JSON.stringify({ sheetName: preview.sheets[Number(sheetSel.value)].name, headerRow: Number(headerRow.value), map }));
    const r = await API.postForm('/trial-balance/import', fd);
    if (r.structure) toast(`יובאו ${r.imported} שורות · נבנו אוטומטית ${r.structure.lines} שורות דוח ומופו ${r.structure.mapped} סעיפים`);
    else toast(`יובאו ${r.imported} שורות`);
    render();
  }, 'ייבא');
}

/* ── ייבוא קובץ סטנדרטי רב-חברתי ── */
function standardImportDialog() {
  const file = el('input', { type: 'file', accept: '.xlsx,.xls' });
  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'קובץ ייצוא סטנדרטי מהמערכת הפיננסית'), file),
    el('p', { class: 'muted', style: 'font-size:13px' }, 'הקובץ יזוהה אוטומטית (עמודות: כותרת ראשית / משנה / סעיף / חשבון / תיאור / חברה / יתרה) ויפוצל לפי חברה. לכל חברה תיווצר גרסה חדשה ויבנה מבנה הדוח אוטומטית.'));
  modal('ייבוא קובץ סטנדרטי', body, async () => {
    if (!file.files[0]) { toast('בחרו קובץ', true); return false; }
    const fd = new FormData(); fd.append('file', file.files[0]);
    const prev = await API.postForm('/trial-balance/import-standard/preview', fd);
    standardMappingDialog(file.files[0], prev);
    return true;
  }, 'זיהוי חברות');
}
function standardMappingDialog(fileObj, prev) {
  const periodSel = el('select', {});
  S.periods.forEach((p) => periodSel.append(el('option', { value: p.id }, p.label || `${p.fiscal_year}`)));
  periodSel.value = S.periodId || (S.periods[0] && S.periods[0].id);
  const vname = el('input', { value: 'ייבוא ' + new Date().toLocaleDateString('he-IL') });
  const rows = el('div', {});
  const selects = {};
  prev.groups.forEach((g) => {
    const sel = el('select', {});
    sel.append(el('option', { value: '' }, '— לא לייבא —'));
    S.companies.filter((c) => !c.is_consolidated).forEach((c) => sel.append(el('option', { value: c.id }, c.name)));
    if (g.matchedCompanyId) sel.value = g.matchedCompanyId;
    selects[g.fileCompany] = sel;
    rows.append(el('div', { class: 'field' }, el('label', {}, `${g.fileCompany} (${g.count} שורות) →`), sel));
  });
  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'תקופת דוח'), periodSel),
    el('div', { class: 'field' }, el('label', {}, 'שם הגרסה'), vname),
    el('hr'), el('label', { class: 'muted' }, 'מיפוי חברות מהקובץ לחברות במערכת:'), rows);
  modal('אישור ייבוא רב-חברתי', body, async () => {
    const mapping = prev.groups.map((g) => ({ fileCompany: g.fileCompany, company_id: selects[g.fileCompany].value ? Number(selects[g.fileCompany].value) : null, version_name: vname.value }));
    const fd = new FormData();
    fd.append('file', fileObj); fd.append('period_id', periodSel.value); fd.append('mapping', JSON.stringify(mapping));
    const r = await API.postForm('/trial-balance/import-standard/commit', fd);
    const ok = r.results.filter((x) => x.imported);
    toast(`יובאו ${ok.length} חברות (${ok.reduce((s, x) => s + x.imported, 0)} שורות)`);
    await reloadVersions(); render();
  }, 'ייבא');
}

/* ── איחוד חברות ── */
async function renderConsolidation(m) {
  m.append(el('h2', { class: 'view-title' }, 'איחוד חברות'), contextBanner());
  if (!S.versionId) { m.append(el('div', { class: 'card' }, 'צרו גרסת מאוחד תחילה (בורר הגרסה למעלה).')); return; }
  const wrap = el('div', {}); m.append(wrap);
  await guard(async () => {
    const [members, candidates] = await Promise.all([
      API.get(`/consolidation/${S.versionId}/members`),
      API.get(`/consolidation/${S.versionId}/candidates`),
    ]);
    const memberIds = new Set(members.map((x) => x.id));

    const mcard = el('div', { class: 'card' }, el('h3', { style: 'margin-top:0; color:var(--brand)' }, 'חברות בנות בגרסת המאוחד'));
    if (!members.length) mcard.append(el('div', { class: 'muted' }, 'טרם נוספו חברות בנות.'));
    else {
      const t = el('table', { class: 'grid' }, el('thead', {}, el('tr', {},
        el('th', {}, 'חברה'), el('th', {}, 'גרסה'), el('th', {}, 'אחזקה %'), el('th', {}, 'שיטה'), el('th', {}, ''))));
      const tb = el('tbody');
      members.forEach((mem) => {
        const pct = el('input', { type: 'number', step: 'any', value: mem.holding_pct, style: 'width:80px', disabled: canEdit() ? null : 'disabled' });
        const method = el('select', { disabled: canEdit() ? null : 'disabled' });
        [['full', 'איחוד מלא'], ['equity', 'שווי מאזני (אקוויטי)']].forEach(([v, l]) => method.append(el('option', { value: v }, l)));
        method.value = mem.method || 'full';
        const saveMem = () => guard(async () => { await API.patch(`/consolidation/${S.versionId}/members/${mem.id}`, { holding_pct: Number(pct.value), method: method.value }); toast('נשמר'); });
        pct.onchange = saveMem; method.onchange = saveMem;
        tb.append(el('tr', {}, el('td', {}, mem.company_name), el('td', {}, mem.name), el('td', {}, pct), el('td', {}, method),
          el('td', {}, canEdit() ? el('button', { class: 'btn danger sm', onclick: () => guard(async () => { await API.del(`/consolidation/${S.versionId}/members/${mem.id}`); render(); }) }, 'הסר') : '')));
      });
      t.append(tb); mcard.append(t);
    }
    if (canEdit()) mcard.append(el('div', { class: 'toolbar', style: 'margin-top:10px' },
      el('button', { class: 'btn sm', onclick: () => buildConsolidatedStructure() }, '⚙ בנה מבנה מאוחד מהבנות'),
      el('button', { class: 'btn sec sm', onclick: () => buildConsolidatedStructure(true) }, 'בנייה מחדש')));
    wrap.append(mcard);

    if (canEdit()) {
      const add = candidates.filter((c) => !memberIds.has(c.id));
      const ccard = el('div', { class: 'card' }, el('h3', { style: 'margin-top:0; color:var(--brand)' }, 'הוספת חברות בנות (אותה תקופה)'));
      if (!add.length) ccard.append(el('div', { class: 'muted' }, 'אין גרסאות זמינות להוספה בתקופה זו.'));
      else {
        const t = el('table', { class: 'grid' }, el('thead', {}, el('tr', {},
          el('th', {}, 'חברה'), el('th', {}, 'גרסה'), el('th', {}, 'אחזקה %'), el('th', {}, 'שיטה'), el('th', {}, ''))));
        const tb = el('tbody');
        add.forEach((c) => {
          const pct = el('input', { type: 'number', step: 'any', value: 100, style: 'width:80px' });
          const method = el('select', {});
          [['full', 'איחוד מלא'], ['equity', 'שווי מאזני']].forEach(([v, l]) => method.append(el('option', { value: v }, l)));
          tb.append(el('tr', {}, el('td', {}, c.company_name), el('td', {}, c.name), el('td', {}, pct), el('td', {}, method),
            el('td', {}, el('button', { class: 'btn sm', onclick: () => guard(async () => { await API.post(`/consolidation/${S.versionId}/members`, { member_version_id: c.id, holding_pct: Number(pct.value), method: method.value }); render(); }) }, '+ הוסף'))));
        });
        t.append(tb); ccard.append(t);
      }
      wrap.append(ccard);
    }
    wrap.append(el('div', { class: 'muted', style: 'font-size:13px' }, 'לאחר בניית המבנה: הדוח המאוחד (טאב "דוחות וביאורים") מצרף את הבנות. "פקודות נוספות" ו"פקודות מיון" בגרסה זו מתפקדות כפקודות איחוד ומיון של המאוחד.'));
  });
}
function buildConsolidatedStructure(rebuild) {
  if (rebuild && !confirm('בנייה מחדש תמחק את מבנה המאוחד ותבנה מהבנות מחדש. להמשיך?')) return;
  guard(async () => {
    const r = await API.post(`/consolidation/${S.versionId}/build-structure`, { rebuild: !!rebuild });
    toast(`נבנו ${r.lines} שורות · ${r.mapped}/${r.sections} סעיפים מופו`);
    render();
  });
}

/* ═══════════ מבנה הדוח (fs_lines) ═══════════ */
async function renderStructure(m) {
  m.append(el('h2', { class: 'view-title' }, 'מבנה הדוח הכספי'), contextBanner());
  if (canEdit()) m.append(el('div', { class: 'toolbar' },
    el('button', { class: 'btn sm', onclick: () => fsLineDialog('balance') }, '+ שורת מאזן'),
    el('button', { class: 'btn sm', onclick: () => fsLineDialog('pnl') }, '+ שורת רווח והפסד')));
  const wrap = el('div', {}); m.append(wrap);
  await guard(async () => {
    const lines = await API.get(`/fs-lines?company_id=${S.companyId}`);
    ['balance', 'pnl'].forEach((st) => {
      const card = el('div', { class: 'card' }, el('h3', { style: 'margin-top:0; color:var(--brand)' }, st === 'balance' ? 'דוח על המצב הכספי' : 'רווח והפסד'));
      const list = lines.filter((l) => l.statement === st);
      if (!list.length) card.append(el('div', { class: 'muted' }, 'אין שורות. הוסיפו שורות למבנה הדוח.'));
      else {
        const tbl = el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, el('th', {}, 'תיאור'), el('th', {}, 'סוג'), el('th', {}, 'באור'), el('th', {}, 'סדר'), el('th', {}, ''))));
        const tb = el('tbody');
        list.forEach((l) => tb.append(el('tr', { class: l.kind === 'header' ? 'row-header' : (l.kind === 'total' ? 'row-total' : '') },
          el('td', {}, l.label), el('td', {}, { header: 'כותרת', line: 'שורה', total: 'סיכום' }[l.kind] || l.kind),
          el('td', {}, l.note_ref || ''), el('td', {}, l.sort_order),
          el('td', {}, canEdit() ? el('span', {},
            el('button', { class: 'btn sec sm', onclick: () => fsLineDialog(st, l) }, 'עריכה'), ' ',
            el('button', { class: 'btn danger sm', onclick: () => deleteFsLine(l) }, '✕')) : ''))));
        tbl.append(tb); card.append(tbl);
      }
      wrap.append(card);
    });
  });
}
function fsLineDialog(statement, line) {
  const label = el('input', { value: line ? line.label : '' });
  const kind = el('select', {}); [['line', 'שורה'], ['header', 'כותרת'], ['total', 'סיכום']].forEach(([v, t]) => kind.append(el('option', { value: v }, t)));
  if (line) kind.value = line.kind;
  const note = el('input', { value: line ? (line.note_ref || '') : '' });
  const order = el('input', { type: 'number', value: line ? line.sort_order : 0 });
  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'תיאור'), label),
    el('div', { class: 'field' }, el('label', {}, 'סוג'), kind),
    el('div', { class: 'field' }, el('label', {}, 'מספר באור'), note),
    el('div', { class: 'field' }, el('label', {}, 'סדר'), order));
  modal(line ? 'עריכת שורה' : 'שורה חדשה', body, async () => {
    const payload = { company_id: S.companyId, statement, label: label.value, kind: kind.value, note_ref: note.value, sort_order: Number(order.value) || 0 };
    if (line) await API.patch(`/fs-lines/${line.id}`, payload); else await API.post('/fs-lines', payload);
    render();
  });
}
function deleteFsLine(line) {
  if (!confirm(`למחוק את השורה "${line.label}"?`)) return;
  guard(async () => { await API.del(`/fs-lines/${line.id}?company_id=${S.companyId}`); render(); });
}

/* ═══════════ אינדקס המרה ═══════════ */
async function renderIndex(m) {
  m.append(el('h2', { class: 'view-title' }, 'אינדקס המרה: סעיף מאזן בוחן ← שורת דוח'), contextBanner());
  if (canEdit()) m.append(el('div', { class: 'toolbar' },
    el('button', { class: 'btn sm', onclick: buildStructure, disabled: S.versionId ? null : 'disabled' }, '⚙ בנה מבנה ואינדקס אוטומטית מהמאזן'),
    el('button', { class: 'btn sec sm', onclick: () => buildStructure(true), disabled: S.versionId ? null : 'disabled' }, 'בנייה מחדש'),
    el('span', { class: 'muted' }, '·'),
    el('button', { class: 'btn sec sm', onclick: seedIndex, disabled: S.versionId ? null : 'disabled' }, 'זריעת סעיפים ריקים בלבד')));
  const wrap = el('div', { class: 'card' }, 'טוען…'); m.append(wrap);
  await guard(async () => {
    const [maps, lines] = await Promise.all([API.get(`/index-map?company_id=${S.companyId}`), API.get(`/fs-lines?company_id=${S.companyId}`)]);
    wrap.innerHTML = '';
    if (!maps.length) { wrap.textContent = 'אין סעיפים. השתמשו ב"זריעה ממאזן בוחן" לאחר ייבוא.'; return; }
    const tbl = el('table', { class: 'grid' }, el('thead', {}, el('tr', {},
      el('th', {}, 'קוד סעיף'), el('th', {}, 'שם סעיף'), el('th', {}, 'שורת דוח כספי'))));
    const tb = el('tbody');
    maps.forEach((mp) => {
      const sel = el('select', { disabled: canEdit() ? null : 'disabled' });
      sel.append(el('option', { value: '' }, '— לא ממופה —'));
      lines.forEach((l) => sel.append(el('option', { value: l.id }, `${l.statement === 'balance' ? '[מאזן]' : '[רו"ה]'} ${l.label}`)));
      if (mp.fs_line_id) sel.value = mp.fs_line_id;
      sel.onchange = () => guard(async () => {
        await API.put('/index-map', { company_id: S.companyId, tb_section_code: mp.tb_section_code, tb_section_name: mp.tb_section_name, fs_line_id: sel.value ? Number(sel.value) : null, row_version: mp.row_version });
        mp.row_version++; toast('נשמר');
      });
      tb.append(el('tr', {}, el('td', {}, mp.tb_section_code), el('td', {}, mp.tb_section_name || ''), el('td', {}, sel)));
    });
    tbl.append(tb); wrap.append(tbl);
  });
}
function seedIndex() { guard(async () => { const r = await API.post('/index-map/seed-from-version', { version_id: S.versionId }); toast(`נוספו ${r.added} סעיפים`); render(); }); }
function buildStructure(rebuild) {
  if (rebuild && !confirm('בנייה מחדש תמחק את מבנה הדוח שנבנה אוטומטית ותבנה מהמאזן מחדש. להמשיך?')) return;
  guard(async () => {
    const r = await API.post('/index-map/build-from-version', { version_id: S.versionId, rebuild: !!rebuild });
    toast(`נבנו ${r.headers} כותרות · ${r.lines} שורות · ${r.mapped}/${r.sections} סעיפים מופו`);
    render();
  });
}

/* ═══════════ פקודות נוספות ═══════════ */
async function renderAdjustments(m) {
  m.append(el('h2', { class: 'view-title' }, 'גליון פקודות נוספות'), contextBanner());
  if (canEdit()) m.append(el('div', { class: 'toolbar' }, el('button', { class: 'btn sm', onclick: () => adjDialog() }, '+ פקודה חדשה')));
  const wrap = el('div', { class: 'card' }, 'טוען…'); m.append(wrap);
  await guard(async () => {
    const rows = await API.get(`/adjustments?version_id=${S.versionId}`);
    wrap.innerHTML = '';
    if (!rows.length) { wrap.textContent = 'אין פקודות נוספות בגרסה זו.'; return; }
    const tbl = el('table', { class: 'grid' }, el('thead', {}, el('tr', {},
      el('th', {}, 'מס\' פקודה'), el('th', {}, 'חשבון'), el('th', {}, 'שם'), el('th', {}, 'סעיף'), el('th', {}, 'מהות'), el('th', { class: 'num' }, 'סכום'), el('th', {}, ''))));
    const tb = el('tbody'); let sum = 0;
    rows.forEach((r) => {
      sum += Number(r.amount) || 0;
      tb.append(el('tr', {}, el('td', {}, r.entry_no || ''), el('td', {}, r.account_no || ''), el('td', {}, r.account_name || ''),
        el('td', {}, r.tb_section_code || ''), el('td', {}, r.purpose || ''), el('td', { class: 'num' }, nf2.format(Number(r.amount) || 0)),
        el('td', {}, canEdit() ? el('span', {}, el('button', { class: 'btn sec sm', onclick: () => adjDialog(r) }, 'עריכה'), ' ', el('button', { class: 'btn danger sm', onclick: () => delRow('adjustments', r.id) }, '✕')) : '')));
    });
    tbl.append(tb, el('tfoot', {}, el('tr', { class: 'row-total' }, el('td', { colspan: 5 }, 'סה"כ'), el('td', { class: 'num' }, nf2.format(sum)), el('td', {}))));
    wrap.append(tbl);
  });
}
function adjDialog(row) {
  const f = {};
  const mk = (key, label, num) => { f[key] = el('input', num ? { type: 'number', step: 'any' } : {}); if (row) f[key].value = row[key] != null ? row[key] : ''; return el('div', { class: 'field' }, el('label', {}, label), f[key]); };
  const body = el('div', {}, mk('entry_no', 'מספר פקודה', true), mk('account_no', 'כרטיס/חשבון'), mk('account_name', 'שם כרטיס'), mk('tb_section_code', 'סעיף מאזן בוחן'), mk('tb_section_name', 'שם סעיף'), mk('purpose', 'מהות הפקודה'), mk('amount', 'סכום', true));
  modal(row ? 'עריכת פקודה' : 'פקודה נוספת חדשה', body, async () => {
    const payload = { version_id: S.versionId };
    Object.entries(f).forEach(([k, inp]) => { payload[k] = inp.value; });
    if (row) { payload.row_version = row.row_version; await API.patch(`/adjustments/${row.id}`, payload); }
    else await API.post('/adjustments', payload);
    render();
  });
}

/* ═══════════ פקודות מיון ═══════════ */
async function renderReclass(m) {
  m.append(el('h2', { class: 'view-title' }, 'גליון פקודות מיון'), contextBanner());

  // ── חוקי מיון אוטומטי ──
  const rulesCard = el('div', { class: 'card' }, 'טוען חוקים…'); m.append(rulesCard);
  await guard(async () => {
    const rules = await API.get(`/reclass-rules?company_id=${S.companyId}`);
    rulesCard.innerHTML = '';
    rulesCard.append(el('div', { class: 'toolbar' },
      el('b', { style: 'color:var(--brand)' }, 'חוקי מיון אוטומטי'),
      el('span', { style: 'flex:1' }),
      canEdit() ? el('button', { class: 'btn sm', onclick: () => ruleDialog() }, '+ חוק חדש') : '',
      canEdit() ? el('button', { class: 'btn sec sm', onclick: applyRules }, '⚙ החל חוקים') : ''));
    if (!rules.length) rulesCard.append(el('div', { class: 'muted' }, 'אין חוקים. דוגמה: "כל היתרות השליליות בסעיף מזומנים ושווי מזומנים → משיכות יתר".'));
    else {
      const t = el('table', { class: 'grid' }, el('thead', {}, el('tr', {},
        el('th', {}, 'שם'), el('th', {}, 'תחום'), el('th', {}, 'תנאי'), el('th', {}, 'רמה'), el('th', {}, 'סעיף יעד'), el('th', {}, 'פעיל'), el('th', {}, ''))));
      const tb = el('tbody');
      const scopeTxt = { section: 'סעיף', subheader: 'כותרת משנה', all: 'הכל' };
      const signTxt = { negative: 'יתרות שליליות', positive: 'יתרות חיוביות', all: 'כל היתרות' };
      rules.forEach((r) => tb.append(el('tr', {}, el('td', {}, r.name),
        el('td', { class: 'muted', style: 'font-size:12px' }, `${scopeTxt[r.source_scope_type]}: ${r.source_scope_value || ''}`),
        el('td', {}, signTxt[r.sign]), el('td', {}, r.level === 'account' ? 'חשבון' : 'סעיף'),
        el('td', {}, r.target_section_name || r.target_section_code),
        el('td', {}, r.active ? el('span', { class: 'tag ok' }, 'כן') : el('span', { class: 'tag' }, 'לא')),
        el('td', {}, canEdit() ? el('span', {}, el('button', { class: 'btn sec sm', onclick: () => ruleDialog(r) }, 'עריכה'), ' ', el('button', { class: 'btn danger sm', onclick: () => delRule(r.id) }, '✕')) : ''))));
      t.append(tb); rulesCard.append(t);
    }
  });

  // ── פקודות מיון (ידני + מיוצר) ──
  if (canEdit()) m.append(el('div', { class: 'toolbar' }, el('button', { class: 'btn sm', onclick: () => reclassDialog() }, '+ מיון ידני חדש')));
  const wrap = el('div', { class: 'card' }, 'טוען…'); m.append(wrap);
  await guard(async () => {
    const rows = await API.get(`/reclass?version_id=${S.versionId}`);
    wrap.innerHTML = '';
    if (!rows.length) { wrap.textContent = 'אין פקודות מיון בגרסה זו.'; return; }
    const tbl = el('table', { class: 'grid' }, el('thead', {}, el('tr', {},
      el('th', {}, 'מקור'), el('th', {}, 'חשבון'), el('th', {}, 'מסעיף'), el('th', {}, 'לסעיף'), el('th', {}, 'הערה'), el('th', { class: 'num' }, 'סכום'), el('th', {}, ''))));
    const tb = el('tbody');
    rows.forEach((r) => {
      const isRule = r.source === 'rule';
      tb.append(el('tr', {}, el('td', {}, isRule ? el('span', { class: 'tag warn' }, 'אוטומטי') : el('span', { class: 'tag' }, 'ידני')),
        el('td', {}, r.account_no || ''), el('td', {}, r.from_section || ''), el('td', {}, r.to_section || ''),
        el('td', {}, r.note || ''), el('td', { class: 'num' }, nf2.format(Number(r.amount) || 0)),
        el('td', {}, (canEdit() && !isRule) ? el('span', {}, el('button', { class: 'btn sec sm', onclick: () => reclassDialog(r) }, 'עריכה'), ' ', el('button', { class: 'btn danger sm', onclick: () => delRow('reclass', r.id) }, '✕')) : '')));
    });
    tbl.append(tb); wrap.append(tbl);
  });
}
function applyRules() { guard(async () => { const r = await API.post('/reclass-rules/apply', { version_id: S.versionId }); toast(`הוחלו ${r.rules} חוקים · נוצרו ${r.generated} מיונים`); render(); }); }
function delRule(id) { if (!confirm('למחוק את החוק (וגם המיונים שיצר)?')) return; guard(async () => { await API.del(`/reclass-rules/${id}?company_id=${S.companyId}`); render(); }); }
function ruleDialog(rule) {
  const name = el('input', { value: rule ? rule.name : '' });
  const scopeType = el('select', {}); [['subheader', 'כותרת משנה'], ['section', 'סעיף'], ['all', 'הכל']].forEach(([v, l]) => scopeType.append(el('option', { value: v }, l)));
  if (rule) scopeType.value = rule.source_scope_type;
  const scopeVal = el('input', { value: rule ? (rule.source_scope_value || '') : 'מזומנים ושווי מזומנים', placeholder: 'טקסט/קוד לזיהוי התחום' });
  const sign = el('select', {}); [['negative', 'יתרות שליליות'], ['positive', 'יתרות חיוביות'], ['all', 'כל היתרות']].forEach(([v, l]) => sign.append(el('option', { value: v }, l)));
  if (rule) sign.value = rule.sign;
  const level = el('select', {}); [['account', 'לפי חשבון'], ['section', 'לפי סעיף']].forEach(([v, l]) => level.append(el('option', { value: v }, l)));
  if (rule) level.value = rule.level;
  const tgtCode = el('input', { value: rule ? (rule.target_section_code || '') : '', placeholder: 'קוד סעיף יעד' });
  const tgtName = el('input', { value: rule ? (rule.target_section_name || '') : 'משיכות יתר', placeholder: 'שם סעיף היעד' });
  const active = el('input', { type: 'checkbox' }); if (!rule || rule.active) active.checked = true;
  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'שם החוק'), name),
    el('div', { class: 'field' }, el('label', {}, 'תחום המקור'), scopeType),
    el('div', { class: 'field' }, el('label', {}, 'ערך התחום (טקסט כותרת-משנה / קוד סעיף)'), scopeVal),
    el('div', { class: 'field' }, el('label', {}, 'תנאי'), sign),
    el('div', { class: 'field' }, el('label', {}, 'רמת מיון'), level),
    el('div', { class: 'field' }, el('label', {}, 'קוד סעיף יעד'), tgtCode),
    el('div', { class: 'field' }, el('label', {}, 'שם סעיף יעד'), tgtName),
    el('div', { class: 'field' }, el('label', {}, el('span', {}, active, ' פעיל'))));
  modal(rule ? 'עריכת חוק מיון' : 'חוק מיון חדש', body, async () => {
    const payload = { name: name.value, source_scope_type: scopeType.value, source_scope_value: scopeVal.value, sign: sign.value, level: level.value, target_section_code: tgtCode.value, target_section_name: tgtName.value, active: active.checked, company_id: S.companyId };
    if (!payload.name || !payload.target_section_code) { toast('חסר שם או קוד סעיף יעד', true); return false; }
    if (rule) await API.patch(`/reclass-rules/${rule.id}`, payload); else await API.post('/reclass-rules', payload);
    render(); toast('נשמר');
  });
}
function reclassDialog(row) {
  const f = {};
  const mk = (key, label, num) => { f[key] = el('input', num ? { type: 'number', step: 'any' } : {}); if (row) f[key].value = row[key] != null ? row[key] : ''; return el('div', { class: 'field' }, el('label', {}, label), f[key]); };
  const body = el('div', {}, mk('account_no', 'חשבון'), mk('account_name', 'תיאור'), mk('from_section', 'מסעיף (מקור)'), mk('to_section', 'לסעיף (יעד)'), mk('note', 'הערה'), mk('amount', 'סכום', true));
  modal(row ? 'עריכת מיון' : 'מיון חדש', body, async () => {
    const payload = { version_id: S.versionId };
    Object.entries(f).forEach(([k, inp]) => { payload[k] = inp.value; });
    if (row) { payload.row_version = row.row_version; await API.patch(`/reclass/${row.id}`, payload); }
    else await API.post('/reclass', payload);
    render();
  });
}
function delRow(kind, id) { if (!confirm('למחוק?')) return; guard(async () => { await API.del(`/${kind}/${id}?version_id=${S.versionId}`); render(); }); }

/* ═══════════ דוחות וביאורים ═══════════ */
/* ═══════════ IFRS 16 ═══════════ */
async function renderIFRS16(m) {
  m.append(el('h2', { class: 'view-title' }, 'IFRS 16 — חכירות'), contextBanner());
  const wrap = el('div', {}, 'טוען…'); m.append(wrap);
  await guard(async () => {
    const d = await API.get(`/ifrs16/${S.versionId}`);
    wrap.innerHTML = '';
    const s = d.summary; const r = d.reconciliation;
    const kv = (label, val) => el('div', { style: 'display:flex;justify-content:space-between;padding:4px 6px' },
      el('span', {}, label), el('span', { style: 'font-variant-numeric:tabular-nums;direction:ltr;font-weight:600' }, uMoney(val)));

    // סיכום
    wrap.append(el('div', { class: 'card' }, el('h3', { style: 'margin-top:0;color:var(--brand)' }, 'סיכום IFRS 16'),
      kv('נכס זכות שימוש (סגירה)', s.asset_closing),
      kv('התחייבות חכירה (סגירה)', s.liab_closing),
      kv('  מזה חלות שוטפת (12 ח\')', s.current_portion),
      kv('  מזה לזמן ארוך', s.long_term),
      kv('הוצאות פחת (רו"ה)', s.depreciation),
      kv('הוצאות מימון (רו"ה)', s.interest),
      d.consolidated ? el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:8px' }, `מאוחד: צירוף ${d.perCompany.length} חברות באיחוד מלא${d.excludedEquity ? ` (לא כולל ${d.excludedEquity} חברות אקוויטי)` : ''}`) : ''));

    // בדיקת התאמה
    const line = (label, mod, rep, diff) => el('div', { style: 'display:flex;gap:12px;padding:3px 6px' },
      el('span', { style: 'flex:1' }, label),
      el('span', { style: 'width:120px;text-align:left;direction:ltr' }, uMoney(mod)),
      el('span', { style: 'width:120px;text-align:left;direction:ltr;color:var(--muted)' }, uMoney(rep)),
      el('span', { style: `width:110px;text-align:left;direction:ltr;color:${Math.abs(diff) < 1000 ? 'var(--accent)' : 'var(--warn)'}` }, uMoney(diff)));
    wrap.append(el('div', { class: 'card' }, el('h3', { style: 'margin-top:0;color:var(--brand)' }, 'בדיקת התאמה לדוח הכספי'),
      el('div', { style: 'display:flex;gap:12px;padding:3px 6px;font-weight:700;color:var(--muted);font-size:13px' },
        el('span', { style: 'flex:1' }, ''), el('span', { style: 'width:120px;text-align:left' }, 'מודול'), el('span', { style: 'width:120px;text-align:left' }, 'בדוח'), el('span', { style: 'width:110px;text-align:left' }, 'הפרש')),
      line('זכות שימוש בנכס (מאזן)', r.rou.module, r.rou.report, r.rou.diff),
      line('התחייבות בגין חכירה (מאזן)', r.lease.module, r.lease.report, r.lease.diff),
      el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:6px' }, 'הפחת והמימון מוזנים כפקודה נוספת לרו"ה. אם הדוח כבר כולל את סעיפי החכירה — ההפרש ≈0.')));

    // טבלת הסכמים
    const consView = d.consolidated;
    const card = el('div', { class: 'card', style: 'overflow-x:auto' }, el('h3', { style: 'margin-top:0;color:var(--brand)' }, 'הסכמי חכירה'));
    if (!d.lines.length) card.append(el('div', { class: 'muted' }, 'אין הסכמים. ' + (canEdit() && !consView ? 'הוסיפו הסכם.' : '')));
    else {
      const cols = [['name', 'הסכם'], ['liab_open', 'התח\' י.פ'], ['liab_add', 'תוספות'], ['liab_payment', 'פרעון'], ['liab_interest', 'מימון'], ['liab_fx', 'הפ\' שער'], ['liab_closing', 'התח\' י.ס'], ['asset_closing', 'נכס י.ס'], ['asset_depreciation', 'פחת'], ['current_portion', 'חלות שוטפת']];
      const head = el('tr', {}); cols.forEach(([, l]) => head.append(el('th', { class: 'num' }, l)));
      const tbl = el('table', { class: 'grid' }, el('thead', {}, head)); const tb = el('tbody');
      d.lines.forEach((l) => {
        const tr = el('tr', {});
        cols.forEach(([k]) => {
          if (k === 'name') tr.append(el('td', {}, (consView && l.company ? `${l.name} · ${l.company}` : l.name)));
          else tr.append(el('td', { class: 'num' }, uMoney(l[k])));
        });
        tb.append(tr);
      });
      tbl.append(tb); card.append(tbl);
    }
    if (canEdit() && !consView) card.append(el('div', { class: 'toolbar', style: 'margin-top:10px' }, el('button', { class: 'btn sm', onclick: () => ifrs16Dialog() }, '+ הסכם חדש')));
    wrap.append(card);
  });
}
function ifrs16Dialog(row) {
  const f = {};
  const mk = (key, label, num) => { f[key] = el('input', num ? { type: 'number', step: 'any' } : {}); if (row) f[key].value = row[key] != null ? row[key] : ''; return el('div', { class: 'field' }, el('label', {}, label), f[key]); };
  const body = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:0 12px' },
    mk('name', 'שם ההסכם'), mk('current_portion', 'חלות שוטפת (12ח\')', true),
    mk('liab_open', 'התחייבות י.פ', true), mk('asset_open', 'נכס י.פ', true),
    mk('liab_add', 'תוספת התחייבות', true), mk('asset_add', 'תוספת נכס', true),
    mk('liab_payment', 'פרעון (שלילי)', true), mk('asset_depreciation', 'פחת (שלילי)', true),
    mk('liab_interest', 'הוצאות מימון', true), mk('liab_fx', 'הפרשי שער', true));
  modal('הסכם IFRS 16', body, async () => {
    const payload = { version_id: S.versionId };
    Object.entries(f).forEach(([k, inp]) => { payload[k] = inp.value; });
    await API.post(`/ifrs16/${S.versionId}/agreement`, payload);
    render();
  });
}

async function renderReport(m) {
  m.append(el('h2', { class: 'view-title' }, 'דוחות ראשיים'), contextBanner());
  const sub = S.stmtTab || 'balance';
  const subtabs = [['balance', 'מאזן'], ['pnl', 'רווח והפסד'], ['equity', 'שינויים בהון'], ['cashflow', 'תזרים מזומנים'], ['notes', 'ביאורים']];
  const nav = el('div', { class: 'toolbar' });
  subtabs.forEach(([id, lbl]) => nav.append(el('button', { class: 'btn ' + (sub === id ? '' : 'sec') + ' sm', onclick: () => { S.stmtTab = id; render(); } }, lbl)));
  nav.append(el('span', { style: 'flex:1' }));
  const unitsSel = el('select', { style: 'padding:5px 8px;border-radius:8px;border:1px solid var(--line)' },
    el('option', { value: 1000 }, 'אלפי דולר'), el('option', { value: 1 }, 'דולר מלא'));
  unitsSel.value = S.units;
  unitsSel.onchange = () => { S.units = Number(unitsSel.value); render(); };
  nav.append(el('span', { class: 'muted', style: 'font-size:13px' }, 'יחידות:'), unitsSel);
  nav.append(el('button', { class: 'btn sec sm', onclick: exportWord }, '⬇ ייצוא ל-Word'));
  m.append(nav);
  const wrap = el('div', {}, 'טוען…'); m.append(wrap);
  await guard(async () => {
    const st = await API.get(`/statements/${S.versionId}`);
    wrap.innerHTML = '';
    wrap.append(el('div', { class: 'muted', style: 'font-size:13px; margin-bottom:8px' },
      `גרסת פתיחה/השוואה: ${st.opening ? st.opening.name : '— לא נמצאה —'} `,
      canEdit() ? el('button', { class: 'btn sec sm', onclick: () => priorDialog() }, 'שינוי') : ''));
    if (sub === 'balance' || sub === 'pnl') {
      if (sub === 'balance' && st.unmapped && st.unmapped.length) wrap.append(unmappedWarn(st.unmapped));
      wrap.append(el('div', { class: 'muted', style: 'font-size:12.5px;margin-bottom:6px' }, 'לחיצה על שורה פותחת תחקור עד רמת חשבון'));
      wrap.append(statementCard(sub === 'balance' ? 'דוח על המצב הכספי' : 'דוח על רווח או הפסד', sub === 'balance' ? st.balance : st.pnl));
    } else if (sub === 'cashflow') { await renderCashflow(wrap); }
    else if (sub === 'equity') { renderEquity(wrap, st.equity); }
    else if (sub === 'notes') { await renderNotes(wrap); }
  });
}
async function renderNotes(wrap) {
  const data = await API.get(`/notes?version_id=${S.versionId}`);
  const byRef = {}; data.notes.forEach((n) => { byRef[n.note_ref] = n; });
  const refs = [...new Set([...data.refs, ...data.notes.map((n) => n.note_ref)])].sort((a, b) => String(a).localeCompare(String(b), 'he', { numeric: true }));
  wrap.append(el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:8px' }, 'הזינו את המלל לכל ביאור — הוא יוזרם לייצוא ה-Word. מספרי הביאורים נלקחים משורות הדוח.'));
  if (!refs.length) { wrap.append(el('div', { class: 'card' }, 'אין מספרי ביאור מוגדרים בשורות הדוח. הגדירו "מספר באור" ב"מבנה הדוח".')); return; }
  refs.forEach((ref) => {
    const n = byRef[ref] || {};
    const title = el('input', { value: n.title || '', placeholder: 'כותרת הביאור', disabled: canEdit() ? null : 'disabled' });
    const body = el('textarea', { rows: 4, style: 'width:100%;padding:9px;border:1px solid var(--line);border-radius:8px', placeholder: 'טקסט הביאור…', disabled: canEdit() ? null : 'disabled' }, n.body || '');
    const card = el('div', { class: 'card' },
      el('div', { style: 'display:flex;gap:10px;align-items:center;margin-bottom:8px' },
        el('b', { style: 'color:var(--brand)' }, `באור ${ref}`), title),
      body);
    if (canEdit()) card.append(el('div', { class: 'toolbar', style: 'margin-top:8px' },
      el('button', { class: 'btn sm', onclick: () => guard(async () => { await API.put('/notes', { version_id: S.versionId, note_ref: ref, title: title.value, body: body.value }); toast('הביאור נשמר'); }) }, 'שמירה')));
    wrap.append(card);
  });
}
function unmappedWarn(unmapped) {
  return el('div', { class: 'card', style: 'border-color:var(--warn)' },
    el('b', { style: 'color:var(--warn)' }, `⚠ ${unmapped.length} סעיפי מאזן בוחן אינם ממופים לשורת דוח `),
    el('span', { class: 'muted' }, '(היכנסו ל"אינדקס המרה"). '),
    el('div', { class: 'muted', style: 'font-size:12.5px; margin-top:6px' }, unmapped.slice(0, 10).map((u) => `${u.code} (${money(u.net)})`).join(' · ')));
}
function priorDialog() {
  guard(async () => {
    const cands = await API.get(`/statements/${S.versionId}/prior-candidates`);
    const sel = el('select', {});
    sel.append(el('option', { value: '' }, '— אוטומטי (דוח שנתי סופי אחרון) —'));
    cands.forEach((c) => sel.append(el('option', { value: c.id }, `${c.name} · ${c.as_of_date} ${c.status === 'final' ? '(סופי)' : ''}`)));
    modal('גרסת פתיחה/השוואה', el('div', { class: 'field' }, el('label', {}, 'בחרו גרסה (או אוטומטי)'), sel), async () => {
      await API.put(`/statements/${S.versionId}/prior`, { prior_version_id: sel.value ? Number(sel.value) : null });
      render(); toast('עודכן');
    });
  });
}

/* ── תזרים מזומנים — נייר עבודה לפי סעיף (מבנה ההרכבה) ── */
async function renderCashflow(wrap) {
  const w = await API.get(`/statements/${S.versionId}/cashflow-worksheet`);
  const cf = w.cashflow; const c = w.control;

  // דוח תזרים מסוכם
  wrap.append(el('div', { class: 'card' }, el('h3', { style: 'margin-top:0;color:var(--brand)' }, 'דוח על תזרימי המזומנים'),
    sumRow('מזומנים נטו מפעילות שוטפת', cf.operating),
    sumRow('מזומנים נטו מפעילות השקעה', cf.investing),
    sumRow('מזומנים נטו מפעילות מימון', cf.financing),
    sumRow('הפרשי שער על מזומנים', cf.fx),
    sumRow('שינוי נטו במזומנים', cf.netChange, true)));

  // בקרה
  wrap.append(el('div', { class: 'card', style: `border-color:${c.ok ? 'var(--accent)' : 'var(--danger)'}` },
    el('h3', { style: `margin-top:0;color:${c.ok ? 'var(--accent)' : 'var(--danger)'}` }, `בקרת תזרים ${c.ok ? '✓ תקין' : '✗ פער'}`),
    sumRow('יתרת מזומנים לתחילת התקופה (מהדוח השנתי הקודם)', c.cashOpening),
    sumRow('+ שינוי נטו במזומנים', cf.netChange),
    sumRow('= יתרת מזומנים מחושבת', c.computedClosing),
    sumRow('יתרת מזומנים בפועל', c.cashClosing),
    sumRow('הפרש בקרה', c.diff, true)));

  // נייר עבודה: הקצאת תנועה לדליי פעילות
  const wp = el('div', { class: 'card', style: 'overflow-x:auto' },
    el('h3', { style: 'margin-top:0;color:var(--brand)' }, 'נייר עבודה — הקצאת תנועה לפי פעילות'),
    el('div', { class: 'muted', style: 'font-size:12.5px;margin-bottom:8px' },
      w.opening ? `יתרות פתיחה מגרסת: ${w.opening.name}` : 'אין גרסת פתיחה — יתרות פתיחה 0 (הגדירו גרסת השוואה למעלה). ' + 'לכל שורה: פתיחה + הקצאות = סגירה (עמודת בדיקה = 0).'));
  const buckets = w.buckets;
  const head = el('tr', {}, el('th', {}, 'סעיף'), el('th', { class: 'num' }, 'פתיחה'), el('th', { class: 'num' }, 'סגירה'), el('th', { class: 'num' }, 'תנועה'));
  buckets.forEach((b) => head.append(el('th', { class: 'num' }, b.label)));
  head.append(el('th', { class: 'num' }, 'בדיקה'));
  const tbl = el('table', { class: 'grid' }, el('thead', {}, head)); const tb = el('tbody');
  w.lines.forEach((l) => {
    if (Math.abs(l.movement) < 0.5 && Math.abs(l.opening) < 0.5 && Math.abs(l.closing) < 0.5) return;
    const tr = el('tr', {});
    tr.append(el('td', {}, l.label), el('td', { class: 'num' }, uMoney(l.opening)), el('td', { class: 'num' }, uMoney(l.closing)), el('td', { class: 'num' }, uMoney(l.movement)));
    buckets.forEach((b) => {
      if (canEdit()) {
        const inp = el('input', { type: 'number', step: 'any', value: Math.round((l.buckets[b.key] || 0) / S.units), style: 'width:88px;text-align:left;direction:ltr' });
        inp.onchange = () => guard(async () => { l.buckets[b.key] = Number(inp.value) * S.units; await API.put(`/statements/${S.versionId}/cashflow-alloc`, { fs_line_id: l.id, buckets: l.buckets }); render(); });
        tr.append(el('td', { class: 'num' }, inp));
      } else tr.append(el('td', { class: 'num' }, uMoney(l.buckets[b.key])));
    });
    tr.append(el('td', { class: 'num', style: Math.abs(l.check) > 1 ? 'color:var(--danger);font-weight:700' : 'color:var(--accent)' }, uMoney(l.check)));
    tb.append(tr);
  });
  tbl.append(tb); wp.append(tbl); wrap.append(wp);
}
function sumRow(label, val, bold) {
  return el('div', { style: `display:flex; justify-content:space-between; padding:3px 4px; ${bold ? 'font-weight:700; border-top:1px solid var(--line)' : ''}` },
    el('span', {}, label), el('span', { style: 'font-variant-numeric:tabular-nums; direction:ltr' }, uMoney(val)));
}
const nf0fmt = (v) => uMoney(v);
function editableNum(val, onSave) {
  const inp = el('input', { type: 'number', step: 'any', value: val || 0, style: 'width:120px; text-align:left; direction:ltr' });
  inp.onchange = () => guard(async () => { await onSave(Number(inp.value) || 0); });
  return inp;
}
function seedCashflow() { guard(async () => { await API.post(`/statements/${S.versionId}/cashflow/seed`, { rebuild: true }); toast('מבנה התזרים נוצר'); render(); }); }
function saveCashflowValue(lineId, amount) { return API.put(`/statements/${S.versionId}/cashflow/value`, { cashflow_line_id: lineId, amount }).then(() => { toast('נשמר'); render(); }); }

/* ── שינויים בהון ── */
function renderEquity(wrap, eq) {
  if (!eq.columns.length) { wrap.append(el('div', { class: 'card' }, 'לא זוהו רכיבי הון במבנה הדוח. ודאו שקיימות שורות תחת כותרת "הון".')); return; }
  const card = el('div', { class: 'card', style: 'overflow-x:auto' });
  const cols = eq.columns;
  const head = el('tr', {}, el('th', {}, 'תנועה'));
  cols.forEach((c) => head.append(el('th', { class: 'num' }, c.label)));
  head.append(el('th', { class: 'num' }, 'סה"כ'));
  const tbl = el('table', { class: 'grid' }, el('thead', {}, head));
  const tb = el('tbody');
  const rowEl = (r, cls) => {
    const tr = el('tr', { class: cls || '' }, el('td', {}, r.label));
    cols.forEach((c) => tr.append(el('td', { class: 'num' }, nf0fmt(r.values[c.id]))));
    tr.append(el('td', { class: 'num' }, nf0fmt(r.values.total)));
    return tr;
  };
  tb.append(rowEl(eq.rows[0], 'row-header'));
  eq.rows.slice(1).forEach((r) => tb.append(rowEl(r)));
  // שורת בלתי-מוסבר (פלאג) אם יש
  if (Math.abs(eq.unexplained.total) >= 1) {
    const tr = el('tr', { class: '' }, el('td', { style: 'color:var(--warn)' }, 'בלתי-מוסבר (דורש פירוק תנועות)'));
    cols.forEach((c) => tr.append(el('td', { class: 'num', style: 'color:var(--warn)' }, nf0fmt(eq.unexplained[c.id]))));
    tr.append(el('td', { class: 'num', style: 'color:var(--warn)' }, nf0fmt(eq.unexplained.total)));
    tb.append(tr);
  }
  tb.append(rowEl(eq.closing, 'row-total'));
  tbl.append(tb); card.append(tbl);
  card.append(el('div', { class: 'muted', style: 'font-size:12.5px; margin-top:8px' },
    `רווח נקי לתקופה: ${nf0fmt(eq.netProfit)} · ${eq.control.ok ? 'ההון מתלכד ✓' : 'קיים סכום בלתי-מוסבר — הוסיפו שורות תנועה (OCI/דיבידנד/הנפקה) לפירוק'}`));
  wrap.append(card);
}
function statementCard(title, lines) {
  const card = el('div', { class: 'card' }, el('h3', { style: 'margin-top:0; color:var(--brand)' }, title));
  if (!lines.length) { card.append(el('div', { class: 'muted' }, 'לא הוגדרו שורות. הגדירו ב"מבנה הדוח".')); return card; }
  const depth = {}; const byId = {}; lines.forEach((l) => byId[l.id] = l);
  const dep = (l) => depth[l.id] != null ? depth[l.id] : (depth[l.id] = l.parent_id && byId[l.parent_id] ? dep(byId[l.parent_id]) + 1 : 0);
  const tbl = el('table', { class: 'grid' }, el('thead', {}, el('tr', {},
    el('th', {}, 'סעיף'), el('th', {}, 'באור'), el('th', { class: 'num' }, 'שוטף'), el('th', { class: 'num' }, 'קודם'))));
  const tb = el('tbody');
  lines.forEach((l) => {
    const cls = l.kind === 'header' ? 'row-header' : (l.kind === 'total' ? 'row-total' : '');
    const label = el('td', { style: `padding-right:${8 + dep(l) * 16}px` },
      l.kind === 'header' ? l.label : el('span', { class: 'clickable', onclick: () => drillLine(l) }, l.label));
    tb.append(el('tr', { class: cls }, label, el('td', {}, l.note_ref || ''),
      el('td', { class: 'num' }, l.kind === 'header' ? '' : uMoney(l.amount)),
      el('td', { class: 'num' }, l.kind === 'header' ? '' : uMoney(l.prior))));
  });
  tbl.append(tb); card.append(tbl); return card;
}
async function drillLine(line) {
  await guard(async () => {
    const d = await API.get(`/reports/drill/${line.id}?version_id=${S.versionId}`);
    const box = el('div', {});
    if (!d.sections.length) box.append(el('div', { class: 'muted' }, 'לא ממופים סעיפים לשורה זו.'));
    d.sections.forEach((s) => {
      const sec = el('div', { class: 'drill' }, el('b', {}, `סעיף ${s.section_code} — ${s.section_name || ''}`));
      const tbl = el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, el('th', {}, 'חשבון'), el('th', {}, 'תיאור'), el('th', { class: 'num' }, 'יתרה'))));
      const tb = el('tbody');
      s.accounts.forEach((a) => tb.append(el('tr', {}, el('td', {}, a.account_no), el('td', {}, a.account_name || ''), el('td', { class: 'num' }, nf2.format(Number(a.amount) || 0)))));
      tbl.append(tb); sec.append(tbl);
      if (s.adjustments.length) sec.append(el('div', { class: 'muted', style: 'margin-top:6px' }, `פקודות נוספות: ${s.adjustments.length} · סה"כ ${nf2.format(s.adjustments.reduce((x, a) => x + Number(a.amount || 0), 0))}`));
      if (s.reclassIn.length || s.reclassOut.length) sec.append(el('div', { class: 'muted' }, `מיונים: נכנס ${s.reclassIn.length}, יוצא ${s.reclassOut.length}`));
      box.append(sec);
    });
    modal(`תחקור: ${line.label}`, box, null);
  });
}
function exportWord() {
  window.open(`/api/reports/export/word?version_id=${S.versionId}&units=${S.units}`, '_blank');
}

/* ═══════════ לוג שינויים ═══════════ */
async function renderAudit(m) {
  m.append(el('h2', { class: 'view-title' }, 'לוג שינויים'), contextBanner());
  const wrap = el('div', { class: 'card' }, 'טוען…'); m.append(wrap);
  await guard(async () => {
    const rows = await API.get(`/audit?company_id=${S.companyId}&version_id=${S.versionId}`);
    wrap.innerHTML = '';
    if (!rows.length) { wrap.textContent = 'אין רשומות לוג.'; return; }
    const tbl = el('table', { class: 'grid' }, el('thead', {}, el('tr', {},
      el('th', {}, 'תאריך'), el('th', {}, 'משתמש'), el('th', {}, 'ישות'), el('th', {}, 'פעולה'), el('th', {}, 'פרטים'))));
    const tb = el('tbody');
    rows.forEach((r) => tb.append(el('tr', {},
      el('td', {}, new Date(r.ts).toLocaleString('he-IL')), el('td', {}, r.username || ''),
      el('td', {}, r.entity), el('td', {}, el('span', { class: 'tag' }, r.action)),
      el('td', { class: 'muted', style: 'font-size:12px; max-width:340px; overflow:hidden; text-overflow:ellipsis' }, (r.after_json || r.before_json || '').slice(0, 120)))));
    tbl.append(tb); wrap.append(tbl);
  });
}

/* ═══════════ ניהול חברות ═══════════ */
async function renderCompanies(m) {
  m.append(el('h2', { class: 'view-title' }, 'ניהול חברות'));
  m.append(el('div', { class: 'toolbar' }, el('button', { class: 'btn sm', onclick: () => companyDialog() }, '+ הוסף חברה')));
  const wrap = el('div', { class: 'card' }, 'טוען…'); m.append(wrap);
  await guard(async () => {
    const list = await API.get('/companies');
    wrap.innerHTML = '';
    const tbl = el('table', { class: 'grid' }, el('thead', {}, el('tr', {},
      el('th', {}, 'שם'), el('th', {}, 'קוד'), el('th', {}, 'סוג'), el('th', {}, 'כינויים'), el('th', {}, ''))));
    const tb = el('tbody');
    list.forEach((c) => tb.append(el('tr', {},
      el('td', {}, c.name), el('td', {}, c.code || ''),
      el('td', {}, c.is_consolidated ? el('span', { class: 'tag' }, 'מאוחד') : 'רגילה'),
      el('td', { class: 'muted', style: 'font-size:12px' }, (c.aliases || '').replace(/\n/g, ' · ')),
      el('td', {}, el('button', { class: 'btn sec sm', onclick: () => companyDialog(c) }, 'עריכה')))));
    tbl.append(tb); wrap.append(tbl);
  });
}
function companyDialog(c) {
  const name = el('input', { value: c ? c.name : '' });
  const code = el('input', { value: c ? (c.code || '') : '' });
  const cons = el('input', { type: 'checkbox' }); if (c && c.is_consolidated) cons.checked = true;
  const aliases = el('textarea', { rows: 3, placeholder: 'שם חלופי בכל שורה (כפי שמופיע בקובץ הייצוא)' }); aliases.value = c ? (c.aliases || '') : '';
  const order = el('input', { type: 'number', value: c ? c.sort_order : 0 });
  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'שם החברה'), name),
    el('div', { class: 'field' }, el('label', {}, 'קוד'), code),
    el('div', { class: 'field' }, el('label', {}, el('span', {}, cons, ' חברת איחוד (מאוחד)'))),
    el('div', { class: 'field' }, el('label', {}, 'כינויים (שמות חלופיים)'), aliases),
    el('div', { class: 'field' }, el('label', {}, 'סדר תצוגה'), order));
  modal(c ? 'עריכת חברה' : 'חברה חדשה', body, async () => {
    const payload = { name: name.value, code: code.value, is_consolidated: cons.checked, aliases: aliases.value, sort_order: Number(order.value) || 0 };
    if (!payload.name) { toast('חסר שם', true); return false; }
    if (c) await API.patch(`/companies/${c.id}`, payload); else await API.post('/companies', payload);
    S.companies = await API.get('/companies'); buildContextSelectors();
    if (!S.companyId && S.companies.length) { S.companyId = S.companies[0].id; await reloadVersions(); }
    render(); toast('נשמר');
  });
}

/* ═══════════ ניהול משתמשים ═══════════ */
async function renderUsers(m) {
  m.append(el('h2', { class: 'view-title' }, 'ניהול משתמשים והרשאות'));
  m.append(el('div', { class: 'toolbar' }, el('button', { class: 'btn sm', onclick: () => userDialog() }, '+ משתמש חדש')));
  const wrap = el('div', { class: 'card' }, 'טוען…'); m.append(wrap);
  await guard(async () => {
    const users = await API.get('/users');
    wrap.innerHTML = '';
    const tbl = el('table', { class: 'grid' }, el('thead', {}, el('tr', {},
      el('th', {}, 'משתמש'), el('th', {}, 'שם מלא'), el('th', {}, 'תפקיד'), el('th', {}, 'פעיל'), el('th', {}, 'הרשאות'), el('th', {}, ''))));
    const tb = el('tbody');
    users.forEach((u) => {
      const permTxt = u.is_admin ? 'מנהל — הכל' : (u.permissions.length ? u.permissions.map((p) => `${p.company_id ? (S.companies.find((c) => c.id === p.company_id) || {}).name || p.company_id : 'כל החברות'}:${p.level === 'edit' ? 'עריכה' : 'צפייה'}`).join(', ') : '—');
      tb.append(el('tr', {}, el('td', {}, u.username), el('td', {}, u.full_name || ''),
        el('td', {}, u.is_admin ? el('span', { class: 'tag ok' }, 'מנהל') : 'משתמש'),
        el('td', {}, u.is_active ? el('span', { class: 'tag ok' }, 'כן') : el('span', { class: 'tag danger' }, 'לא')),
        el('td', { class: 'muted', style: 'font-size:12px' }, permTxt),
        el('td', {}, el('span', {}, el('button', { class: 'btn sec sm', onclick: () => userDialog(u) }, 'עריכה'), ' ',
          u.is_admin ? '' : el('button', { class: 'btn sec sm', onclick: () => permDialog(u) }, 'הרשאות')))));
    });
    tbl.append(tb); wrap.append(tbl);
  });
}
function userDialog(u) {
  const username = el('input', { value: u ? u.username : '', disabled: u ? 'disabled' : null });
  const full = el('input', { value: u ? (u.full_name || '') : '' });
  const pw = el('input', { type: 'password', placeholder: u ? '(ריק = ללא שינוי)' : '' });
  const admin = el('input', { type: 'checkbox' }); if (u && u.is_admin) admin.checked = true;
  const active = el('input', { type: 'checkbox' }); if (!u || u.is_active) active.checked = true;
  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'שם משתמש'), username),
    el('div', { class: 'field' }, el('label', {}, 'שם מלא'), full),
    el('div', { class: 'field' }, el('label', {}, 'סיסמה'), pw),
    el('div', { class: 'field' }, el('label', {}, el('span', {}, admin, ' מנהל מערכת'))),
    el('div', { class: 'field' }, el('label', {}, el('span', {}, active, ' פעיל'))));
  modal(u ? 'עריכת משתמש' : 'משתמש חדש', body, async () => {
    if (u) await API.patch(`/users/${u.id}`, { full_name: full.value, is_admin: admin.checked, is_active: active.checked, ...(pw.value ? { password: pw.value } : {}) });
    else { if (!username.value || !pw.value) { toast('חובה שם משתמש וסיסמה', true); return false; } await API.post('/users', { username: username.value, full_name: full.value, password: pw.value, is_admin: admin.checked }); }
    render();
  });
}
function permDialog(u) {
  const rows = el('div', {});
  const state = {};
  S.companies.forEach((c) => {
    const existing = u.permissions.find((p) => p.company_id === c.id);
    const sel = el('select', {});
    [['', 'ללא'], ['view', 'צפייה'], ['edit', 'עריכה']].forEach(([v, t]) => sel.append(el('option', { value: v }, t)));
    if (existing) sel.value = existing.level;
    state[c.id] = sel;
    rows.append(el('div', { class: 'field' }, el('label', {}, c.name), sel));
  });
  modal(`הרשאות: ${u.username}`, rows, async () => {
    const permissions = [];
    Object.entries(state).forEach(([cid, sel]) => { if (sel.value) permissions.push({ company_id: Number(cid), level: sel.value }); });
    await API.put(`/users/${u.id}/permissions`, { permissions });
    render(); toast('ההרשאות נשמרו');
  });
}

/* ═══════════ בדיקת session קיים ═══════════ */
(async function boot() {
  try { S.user = await API.get('/auth/me'); await startApp(); } catch { /* לא מחובר */ }
})();
