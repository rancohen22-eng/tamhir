#!/usr/bin/env node
/**
 * fuel-report.mjs — בונה דוח מחירי דלק יומי (Brent & WTI) ושומר אותו כ-HTML למייל.
 *
 * מקורות נתונים (כולם חינמיים):
 *   • EIA API v2      — מחיר ספוט יומי + היסטוריה (להשוואות) + תחזית STEO רשמית.
 *   • Barchart OnDemand (getQuote) — עקום החוזים העתידיים לפי חודש (CBU26, CLQ26 ...),
 *                        בדיוק כמו ב-watchlist של Barchart: מחיר, שינוי יומי מוחלט ו-%.
 *
 * פלט:
 *   out/email.html   — גוף המייל (עברית, RTL).
 *   out/subject.txt  — שורת הנושא.
 *
 * הרצה מקומית:
 *   EIA_API_KEY=xxx BARCHART_API_KEY=yyy node scripts/fuel-report.mjs
 *
 * הסקריפט משתמש רק ב-fetch המובנה של Node 20+ — ללא תלויות npm.
 * אם מקור נתונים כלשהו נכשל, הדוח עדיין נבנה עם מה שכן זמין (best-effort).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'out');

const EIA_API_KEY = process.env.EIA_API_KEY;
const BARCHART_API_KEY = process.env.BARCHART_API_KEY;

// כמה חוזים חודשיים קרובים להציג לכל דלק בעקום.
const FUTURES_MONTHS = 6;

// ── סדרות EIA ──────────────────────────────────────────────────────────────
// ספוט יומי: RWTC = WTI Cushing, RBRTE = Europe Brent.
const EIA_SPOT = { WTI: 'RWTC', BRENT: 'RBRTE' };
// תחזית STEO חודשית: WTIPUUS = WTI spot forecast, BREPUUS = Brent spot forecast.
const STEO_SERIES = { WTI: 'WTIPUUS', BRENT: 'BREPUUS' };

// שורשי חוזים ב-Barchart: Brent = CB, WTI = CL.
const FUT_ROOT = { BRENT: 'CB', WTI: 'CL' };
// קודי חודש של חוזים עתידיים (F=ינואר ... Z=דצמבר).
const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// ── עזרי HTTP ──────────────────────────────────────────────────────────────
async function getJson(url, { headers } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (fuel-report bot)', ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
  return res.json();
}

// ── EIA: ספוט + היסטוריה ───────────────────────────────────────────────────
// מחזיר לכל דלק מערך {period:'YYYY-MM-DD', value:Number} ממוין יורד (חדש→ישן).
async function fetchEiaSpot() {
  if (!EIA_API_KEY) throw new Error('EIA_API_KEY חסר');
  const params = new URLSearchParams({
    api_key: EIA_API_KEY,
    frequency: 'daily',
    'data[0]': 'value',
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    length: '90',
  });
  params.append('facets[series][]', EIA_SPOT.WTI);
  params.append('facets[series][]', EIA_SPOT.BRENT);
  const url = `https://api.eia.gov/v2/petroleum/pri/spt/data/?${params}`;
  const json = await getJson(url);
  const rows = json?.response?.data ?? [];
  const out = { WTI: [], BRENT: [] };
  for (const r of rows) {
    const key = r.series === EIA_SPOT.WTI ? 'WTI' : r.series === EIA_SPOT.BRENT ? 'BRENT' : null;
    if (!key || r.value == null) continue;
    out[key].push({ period: r.period, value: Number(r.value) });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.period < b.period ? 1 : -1));
  return out;
}

// ── EIA: תחזית STEO ────────────────────────────────────────────────────────
// מחזיר לכל דלק מערך של החודשים העתידיים {period:'YYYY-MM', value} ממוין עולה.
async function fetchSteoForecast() {
  if (!EIA_API_KEY) throw new Error('EIA_API_KEY חסר');
  const params = new URLSearchParams({
    api_key: EIA_API_KEY,
    frequency: 'monthly',
    'data[0]': 'value',
    'sort[0][column]': 'period',
    'sort[0][direction]': 'asc',
    length: '48',
  });
  params.append('facets[seriesId][]', STEO_SERIES.WTI);
  params.append('facets[seriesId][]', STEO_SERIES.BRENT);
  const url = `https://api.eia.gov/v2/steo/data/?${params}`;
  const json = await getJson(url);
  const rows = json?.response?.data ?? [];
  const nowMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const out = { WTI: [], BRENT: [] };
  for (const r of rows) {
    const key = r.seriesId === STEO_SERIES.WTI ? 'WTI' : r.seriesId === STEO_SERIES.BRENT ? 'BRENT' : null;
    if (!key || r.value == null) continue;
    if (r.period < nowMonth) continue;
    out[key].push({ period: r.period, value: Number(r.value) });
  }
  for (const k of Object.keys(out)) out[k] = out[k].slice(0, 3);
  return out;
}

// ── Barchart: עקום חוזים עתידיים לפי חודש ───────────────────────────────────
// בונה סמלי חוזים ל-N החודשים הקרובים לשורש נתון (מהחודש הנוכחי קדימה).
function genContracts(root, n) {
  const list = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    const m = d.getMonth();
    const yy = String(d.getFullYear()).slice(2);
    list.push({
      symbol: `${root}${MONTH_CODES[m]}${yy}`,
      label: `${HE_MONTHS[m]} ${d.getFullYear()}`,
      period: `${d.getFullYear()}-${String(m + 1).padStart(2, '0')}`,
    });
    d.setMonth(d.getMonth() + 1);
  }
  return list;
}

// מחזיר { BRENT: [{symbol,label,price,net,pct}], WTI: [...] }
async function fetchBarchartFutures() {
  if (!BARCHART_API_KEY) throw new Error('BARCHART_API_KEY חסר');
  const meta = {};   // symbol -> {label, period, fuel}
  const symbols = [];
  for (const fuel of Object.keys(FUT_ROOT)) {
    for (const c of genContracts(FUT_ROOT[fuel], FUTURES_MONTHS)) {
      meta[c.symbol] = { label: c.label, period: c.period, fuel };
      symbols.push(c.symbol);
    }
  }
  const params = new URLSearchParams({ apikey: BARCHART_API_KEY, symbols: symbols.join(',') });
  const url = `https://ondemand.websol.barchart.com/getQuote.json?${params}`;
  const json = await getJson(url);
  const results = json?.results ?? [];

  // מחיר הסגירה בתחילת החודש לכל חוזה (best-effort; אם נכשל — פשוט לא תוצג ההשוואה).
  const monthStarts = await fetchContractsMonthStart(symbols);

  const out = { BRENT: [], WTI: [] };
  for (const r of results) {
    const m = meta[r.symbol];
    if (!m || r.lastPrice == null) continue;
    out[m.fuel].push({
      symbol: r.symbol,
      label: m.label,
      period: m.period,
      price: Number(r.lastPrice),
      net: r.netChange == null ? null : Number(r.netChange),
      pct: r.percentChange == null ? null : Number(String(r.percentChange).replace('%', '')),
      monthStart: monthStarts[r.symbol] ?? null,
    });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.period < b.period ? -1 : 1));
  return out;
}

// מושך לכל חוזה את מחיר הסגירה ביום המסחר הראשון של החודש הנוכחי (Barchart getHistory).
// מחזיר מפה symbol -> price. שגיאה בחוזה בודד לא מפילה את השאר.
async function fetchContractsMonthStart(symbols) {
  const now = new Date();
  const startDate = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}01`;
  const out = {};
  await Promise.all(symbols.map(async (sym) => {
    try {
      const p = new URLSearchParams({
        apikey: BARCHART_API_KEY, symbol: sym, type: 'daily', startDate, maxRecords: '1',
        order: 'asc',
      });
      const json = await getJson(`https://ondemand.websol.barchart.com/getHistory.json?${p}`);
      const first = json?.results?.[0];
      if (first?.close != null) out[sym] = Number(first.close);
    } catch { /* best-effort per contract */ }
  }));
  return out;
}

// ── חישוב השוואות ספוט ──────────────────────────────────────────────────────
function analyze(series) {
  if (!series || series.length === 0) return null;
  const current = series[0];
  const prev = series[1] ?? null;
  const curMonth = current.period.slice(0, 7);
  let monthStart = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].period.slice(0, 7) === curMonth) { monthStart = series[i]; break; }
  }
  return { current, prev, monthStart };
}

function delta(cur, ref) {
  if (cur == null || ref == null) return null;
  const abs = cur - ref;
  const pct = ref !== 0 ? (abs / ref) * 100 : null;
  return { abs, pct };
}

// ── עיצוב ──────────────────────────────────────────────────────────────────
const fmt = (n) => (n == null || Number.isNaN(n) ? '—' : `$${n.toFixed(2)}`);
const heMonth = (ym) => {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${m}/${y}`;
};
const heDate = (ymd) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
};

function deltaCell(d) {
  if (!d) return '<td style="color:#5b6b7f">—</td>';
  const up = d.abs > 0;
  const flat = d.abs === 0;
  const color = flat ? '#5b6b7f' : up ? '#b3261e' : '#0e7a4e'; // עלייה=אדום (יקר), ירידה=ירוק
  const arrow = flat ? '' : up ? '▲' : '▼';
  const sign = d.abs > 0 ? '+' : '';
  const pct = d.pct == null ? '' : ` (${sign}${d.pct.toFixed(2)}%)`;
  return `<td style="color:${color};white-space:nowrap;font-weight:600">${arrow} ${sign}${d.abs.toFixed(2)}${pct}</td>`;
}

// תגית שינוי צבועה (אחוז + ערך מוחלט). up=ירוק, down=אדום.
function changeTag(pct, abs) {
  if (pct == null && abs == null) return '<div style="color:#5b6b7f;text-align:center;font-size:12px">—</div>';
  const basis = pct ?? abs ?? 0;
  const flat = basis === 0;
  const bg = flat ? '#7a8699' : basis > 0 ? '#0e7a4e' : '#b3261e';
  const sign = basis > 0 ? '+' : '';
  const pctTxt = pct == null ? '' : `${sign}${pct.toFixed(2)}%`;
  const absTxt = abs == null ? '' : `${sign}${abs.toFixed(2)}`;
  return `<div style="background:${bg};color:#fff;border-radius:6px;padding:4px 8px;text-align:center;line-height:1.2">
            <div style="font-weight:800;font-size:13px">${pctTxt}</div>
            <div style="font-size:11px;opacity:.9">${absTxt}</div>
          </div>`;
}

// שורת חוזה בסגנון ה-watchlist של Barchart, כולל שינוי יומי ושינוי מול תחילת החודש.
function futuresRow(r) {
  // שינוי מול תחילת החודש = מול הסגירה בתחילת החודש של אותו חוזה.
  const mAbs = r.monthStart != null ? r.price - r.monthStart : null;
  const mPct = r.monthStart ? (mAbs / r.monthStart) * 100 : null;
  return `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #eef2f7">
          <span style="font-weight:800;font-size:16px;color:#0e1c2e">${r.symbol}</span>
          <span style="color:#5b6b7f;font-size:12px;margin-inline-start:8px">${r.label}</span>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;text-align:center;font-weight:700;font-size:16px;color:#0e1c2e">${r.price.toFixed(2)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eef2f7;width:88px">${changeTag(r.pct, r.net)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eef2f7;width:88px">${changeTag(mPct, mAbs)}</td>
      </tr>`;
}

function futuresTable(title, rows) {
  const body = (rows && rows.length)
    ? rows.map(futuresRow).join('')
    : '<tr><td colspan="4" style="padding:10px;color:#5b6b7f">לא זמין</td></tr>';
  return `
    <div style="font-weight:700;color:#123a86;margin:6px 0 6px">${title}</div>
    <table style="border-collapse:collapse;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
      <tr style="background:#f4f7fb">
        <td style="padding:6px 10px;color:#5b6b7f;font-size:12px">חוזה</td>
        <td style="padding:6px 10px;color:#5b6b7f;font-size:12px;text-align:center">מחיר</td>
        <td style="padding:6px 8px;color:#5b6b7f;font-size:12px;text-align:center">שינוי יומי</td>
        <td style="padding:6px 8px;color:#5b6b7f;font-size:12px;text-align:center">מתחילת החודש</td>
      </tr>
      ${body}
    </table>`;
}

function spotBlock(label, spot, steo) {
  const a = analyze(spot);
  const cur = a?.current?.value ?? null;
  const dPrev = a ? delta(cur, a.prev?.value ?? null) : null;
  const dMonth = a ? delta(cur, a.monthStart?.value ?? null) : null;
  const spotDate = a?.current ? heDate(a.current.period) : '—';
  const steoRows = (steo ?? [])
    .map((p) => `<span style="display:inline-block;margin-inline-end:14px">${heMonth(p.period)}: <b>${fmt(p.value)}</b></span>`)
    .join('') || '<span style="color:#5b6b7f">לא זמין</span>';
  return `
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:14px">
    <div style="font-size:18px;font-weight:800;color:#123a86;margin-bottom:10px">${label}</div>
    <table style="border-collapse:collapse;width:100%;font-size:15px">
      <tr>
        <td style="color:#5b6b7f;padding:6px 0;width:46%">מחיר נוכחי (ספוט רשמי, ${spotDate})</td>
        <td style="font-size:20px;font-weight:800;color:#0e1c2e">${fmt(cur)}</td>
      </tr>
      <tr><td style="color:#5b6b7f;padding:6px 0">שינוי מול יום קודם</td>${deltaCell(dPrev)}</tr>
      <tr><td style="color:#5b6b7f;padding:6px 0">שינוי מול תחילת החודש</td>${deltaCell(dMonth)}</tr>
    </table>
    <div style="margin-top:12px;padding-top:10px;border-top:1px dashed #e2e8f0">
      <div style="color:#5b6b7f;font-size:13px;margin-bottom:4px">תחזית רשמית (EIA STEO)</div>
      <div style="font-size:15px">${steoRows}</div>
    </div>
  </div>`;
}

function renderHtml({ spot, forecast, futures, generatedAt, notes }) {
  const brentSpot = spotBlock('Brent — נפט ים הצפון', spot?.BRENT, forecast?.BRENT);
  const wtiSpot = spotBlock('WTI — נפט אמריקאי', spot?.WTI, forecast?.WTI);
  const noteHtml = notes.length
    ? `<div style="margin-top:14px;color:#b3261e;font-size:13px">${notes.map((n) => `⚠ ${n}`).join('<br>')}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f2f5f9">
  <div style="max-width:660px;margin:0 auto;padding:20px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#0e1c2e">
    <div style="background:#123a86;color:#fff;border-radius:12px;padding:18px 20px;margin-bottom:18px">
      <div style="font-size:22px;font-weight:800">דוח מחירי דלק יומי</div>
      <div style="font-size:14px;opacity:.9;margin-top:4px">Brent &amp; WTI · ${heDate(generatedAt)}</div>
    </div>

    <div style="font-size:16px;font-weight:800;color:#0e1c2e;margin:4px 0 10px">מחיר נוכחי, השוואות ותחזית רשמית</div>
    ${brentSpot}
    ${wtiSpot}

    <div style="font-size:16px;font-weight:800;color:#0e1c2e;margin:20px 0 8px">חוזים עתידיים (מחיר צפוי לפי השוק)</div>
    ${futuresTable('Brent — חוזים עתידיים', futures?.BRENT)}
    <div style="height:14px"></div>
    ${futuresTable('WTI — חוזים עתידיים', futures?.WTI)}

    ${noteHtml}
    <div style="margin-top:18px;color:#5b6b7f;font-size:12px;line-height:1.6">
      מקורות: מחיר ספוט ותחזית — U.S. EIA (רשמי); חוזים עתידיים — Barchart.<br>
      הערה: מחיר הספוט הרשמי של EIA מתעדכן עם עיכוב של מספר ימי מסחר; החוזים העתידיים משקפים
      את ציפיות השוק בזמן אמת.<br>
      דוח אוטומטי — אינו מהווה ייעוץ או המלצה.
    </div>
  </div>
</body></html>`;
}

function renderSubject({ spot, generatedAt }) {
  const parts = [];
  for (const [label, key] of [['Brent', 'BRENT'], ['WTI', 'WTI']]) {
    const a = analyze(spot?.[key]);
    if (a?.current) {
      const d = delta(a.current.value, a.prev?.value ?? null);
      const arrow = d && d.abs !== 0 ? (d.abs > 0 ? '▲' : '▼') : '';
      parts.push(`${label} ${fmt(a.current.value)} ${arrow}`.trim());
    }
  }
  const head = parts.length ? parts.join(' / ') : 'מחירי דלק';
  return `דוח דלק יומי — ${head} — ${heDate(generatedAt)}`;
}

// ── ראשי ───────────────────────────────────────────────────────────────────
async function main() {
  const generatedAt = new Date().toISOString().slice(0, 10);
  const notes = [];

  let spot = null;
  try { spot = await fetchEiaSpot(); }
  catch (e) { notes.push(`טעינת מחירי ספוט מ-EIA נכשלה: ${e.message}`); }

  let forecast = null;
  try { forecast = await fetchSteoForecast(); }
  catch (e) { notes.push(`טעינת תחזית STEO נכשלה: ${e.message}`); }

  let futures = null;
  try { futures = await fetchBarchartFutures(); }
  catch (e) { notes.push(`טעינת חוזים עתידיים (Barchart) נכשלה: ${e.message}`); }

  const html = renderHtml({ spot, forecast, futures, generatedAt, notes });
  const subject = renderSubject({ spot, generatedAt });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'email.html'), html, 'utf8');
  await writeFile(join(OUT_DIR, 'subject.txt'), subject, 'utf8');

  console.log('נוצר out/email.html ו-out/subject.txt');
  console.log('נושא:', subject);
  if (notes.length) {
    console.warn('אזהרות:\n - ' + notes.join('\n - '));
    const noSpot = !spot || (!spot.WTI.length && !spot.BRENT.length);
    const noFut = !futures || (!futures.BRENT.length && !futures.WTI.length);
    if (noSpot && noFut) process.exitCode = 1; // אין נתונים כלל
  }
}

// ── ייצוא לצורכי בדיקה + הרצה ישירה בלבד ────────────────────────────────────
export { analyze, delta, renderHtml, renderSubject, genContracts,
  fetchEiaSpot, fetchSteoForecast, fetchBarchartFutures };

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((e) => {
    console.error('שגיאה קריטית:', e);
    process.exit(1);
  });
}
