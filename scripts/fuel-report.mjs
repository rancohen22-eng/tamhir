#!/usr/bin/env node
/**
 * fuel-report.mjs — בונה דוח מחירי דלק יומי (Brent & WTI) ושומר אותו כ-HTML למייל.
 *
 * מקורות נתונים (כולם חינמיים):
 *   • EIA API v2 — מחיר ספוט יומי + היסטוריה (להשוואות) + תחזית STEO רשמית.
 *   • Yahoo Finance (chart, ללא מפתח) — עקום חוזים עתידיים (futures) כ"מחיר שוק חי" וצפי שוק.
 *
 * פלט:
 *   out/email.html   — גוף המייל (עברית, RTL).
 *   out/subject.txt  — שורת הנושא.
 *
 * הרצה מקומית:
 *   EIA_API_KEY=xxxxx node scripts/fuel-report.mjs
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

// ── סדרות EIA ──────────────────────────────────────────────────────────────
// ספוט יומי: RWTC = WTI Cushing, RBRTE = Europe Brent.
const EIA_SPOT = { WTI: 'RWTC', BRENT: 'RBRTE' };
// תחזית STEO חודשית: WTIPUUS = WTI spot forecast, BREPUUS = Brent spot forecast.
const STEO_SERIES = { WTI: 'WTIPUUS', BRENT: 'BREPUUS' };

// חוזי futures ב-Yahoo: front-month רציף.
const YF_FRONT = { WTI: 'CL=F', BRENT: 'BZ=F' };
// קודי חודש של חוזים עתידיים (F=ינואר ... Z=דצמבר) לבניית סמלי חוזים קדימה.
const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];

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
  // ודא מיון יורד לפי תאריך.
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
    if (r.period < nowMonth) continue; // רק חודשים נוכחיים/עתידיים = תחזית
    out[key].push({ period: r.period, value: Number(r.value) });
  }
  for (const k of Object.keys(out)) out[k] = out[k].slice(0, 3); // 3 החודשים הקרובים
  return out;
}

// ── Yahoo: עקום חוזים עתידיים (best-effort) ────────────────────────────────
async function fetchYahooLast(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const json = await getJson(url);
  const result = json?.chart?.result?.[0];
  const price = result?.meta?.regularMarketPrice;
  return price == null ? null : Number(price);
}

// בונה סמלי חוזים ל-N החודשים הקרובים (root: 'CL' ל-WTI, 'BZ' ל-Brent).
function futuresSymbols(root, count) {
  const syms = [];
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1); // מתחילים מהחודש הקרוב
  for (let i = 0; i < count; i++) {
    const code = MONTH_CODES[d.getMonth()];
    const yy = String(d.getFullYear()).slice(2);
    syms.push({ symbol: `${root}${code}${yy}.NYM`, period: d.toISOString().slice(0, 7) });
    d.setMonth(d.getMonth() + 1);
  }
  return syms;
}

async function fetchFutures() {
  const out = { WTI: { front: null, curve: [] }, BRENT: { front: null, curve: [] } };
  const roots = { WTI: 'CL', BRENT: 'BZ' };
  for (const fuel of Object.keys(YF_FRONT)) {
    try {
      out[fuel].front = await fetchYahooLast(YF_FRONT[fuel]);
    } catch { /* best-effort */ }
    for (const { symbol, period } of futuresSymbols(roots[fuel], 3)) {
      try {
        const v = await fetchYahooLast(symbol);
        if (v != null) out[fuel].curve.push({ period, value: v });
      } catch { /* best-effort */ }
    }
  }
  return out;
}

// ── חישוב השוואות ──────────────────────────────────────────────────────────
// series ממוין יורד (חדש→ישן). מחזיר את הערכים הרלוונטיים להשוואה.
function analyze(series) {
  if (!series || series.length === 0) return null;
  const current = series[0];
  const prev = series[1] ?? null;
  const curMonth = current.period.slice(0, 7);
  // הערך המוקדם ביותר בתוך החודש הנוכחי = "תחילת החודש".
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

function fuelBlock(label, spot, fut, steo) {
  const a = analyze(spot);
  const cur = a?.current?.value ?? null;
  const dPrev = a ? delta(cur, a.prev?.value ?? null) : null;
  const dMonth = a ? delta(cur, a.monthStart?.value ?? null) : null;

  const spotDate = a?.current ? heDate(a.current.period) : '—';
  const front = fut?.front != null ? fmt(fut.front) : '—';

  const steoRows = (steo ?? [])
    .map((p) => `<span style="display:inline-block;margin-inline-end:14px">${heMonth(p.period)}: <b>${fmt(p.value)}</b></span>`)
    .join('') || '<span style="color:#5b6b7f">לא זמין</span>';

  const curveRows = (fut?.curve ?? [])
    .map((p) => `<span style="display:inline-block;margin-inline-end:14px">${heMonth(p.period)}: <b>${fmt(p.value)}</b></span>`)
    .join('') || '<span style="color:#5b6b7f">לא זמין</span>';

  return `
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:16px">
    <div style="font-size:18px;font-weight:800;color:#123a86;margin-bottom:10px">${label}</div>
    <table style="border-collapse:collapse;width:100%;font-size:15px">
      <tr>
        <td style="color:#5b6b7f;padding:6px 0;width:42%">מחיר נוכחי (ספוט רשמי, ${spotDate})</td>
        <td style="font-size:20px;font-weight:800;color:#0e1c2e">${fmt(cur)}</td>
      </tr>
      <tr>
        <td style="color:#5b6b7f;padding:6px 0">שינוי מול יום קודם</td>
        ${deltaCell(dPrev)}
      </tr>
      <tr>
        <td style="color:#5b6b7f;padding:6px 0">שינוי מול תחילת החודש</td>
        ${deltaCell(dMonth)}
      </tr>
      <tr>
        <td style="color:#5b6b7f;padding:6px 0">מחיר שוק חי (חוזה קרוב)</td>
        <td style="font-weight:600">${front}</td>
      </tr>
    </table>
    <div style="margin-top:12px;padding-top:10px;border-top:1px dashed #e2e8f0">
      <div style="color:#5b6b7f;font-size:13px;margin-bottom:4px">תחזית רשמית (EIA STEO)</div>
      <div style="font-size:15px">${steoRows}</div>
    </div>
    <div style="margin-top:8px">
      <div style="color:#5b6b7f;font-size:13px;margin-bottom:4px">עקום חוזים עתידיים (ציפיות שוק)</div>
      <div style="font-size:15px">${curveRows}</div>
    </div>
  </div>`;
}

function renderHtml({ spot, forecast, futures, generatedAt, notes }) {
  const brent = fuelBlock('Brent (נפט ים הצפון)', spot?.BRENT, futures?.BRENT, forecast?.BRENT);
  const wti = fuelBlock('WTI (נפט אמריקאי)', spot?.WTI, futures?.WTI, forecast?.WTI);
  const noteHtml = notes.length
    ? `<div style="margin-top:14px;color:#b3261e;font-size:13px">${notes.map((n) => `⚠ ${n}`).join('<br>')}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f2f5f9">
  <div style="max-width:640px;margin:0 auto;padding:20px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#0e1c2e">
    <div style="background:#123a86;color:#fff;border-radius:12px;padding:18px 20px;margin-bottom:18px">
      <div style="font-size:22px;font-weight:800">דוח מחירי דלק יומי</div>
      <div style="font-size:14px;opacity:.9;margin-top:4px">Brent &amp; WTI · ${heDate(generatedAt)}</div>
    </div>
    ${brent}
    ${wti}
    ${noteHtml}
    <div style="margin-top:18px;color:#5b6b7f;font-size:12px;line-height:1.6">
      מקורות: מחיר ספוט ותחזית — U.S. EIA (רשמי); חוזים עתידיים — Yahoo Finance.<br>
      הערה: מחיר הספוט הרשמי של EIA מתעדכן עם עיכוב של מספר ימי מסחר; "מחיר שוק חי" משקף את החוזה הקרוב במסחר.<br>
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
  try {
    spot = await fetchEiaSpot();
  } catch (e) {
    notes.push(`טעינת מחירי ספוט מ-EIA נכשלה: ${e.message}`);
  }

  let forecast = null;
  try {
    forecast = await fetchSteoForecast();
  } catch (e) {
    notes.push(`טעינת תחזית STEO נכשלה: ${e.message}`);
  }

  let futures = null;
  try {
    futures = await fetchFutures();
  } catch (e) {
    notes.push(`טעינת חוזים עתידיים נכשלה: ${e.message}`);
  }

  // אם אין בכלל נתוני ספוט — עדיין נפיק מייל עם ההערות, אבל נצא בקוד שגיאה כדי
  // שה-workflow יסמן כשל וניתן לחקור. (המייל עדיין נשלח בשלב הבא של ה-Action.)
  const html = renderHtml({ spot, forecast, futures, generatedAt, notes });
  const subject = renderSubject({ spot, generatedAt });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'email.html'), html, 'utf8');
  await writeFile(join(OUT_DIR, 'subject.txt'), subject, 'utf8');

  console.log('נוצר out/email.html ו-out/subject.txt');
  console.log('נושא:', subject);
  if (notes.length) {
    console.warn('אזהרות:\n - ' + notes.join('\n - '));
    if (!spot || (!spot.WTI.length && !spot.BRENT.length)) {
      process.exitCode = 1; // כשל אמיתי — אין נתוני מחיר כלל
    }
  }
}

// ── ייצוא לצורכי בדיקה + הרצה ישירה בלבד ────────────────────────────────────
export { analyze, delta, renderHtml, renderSubject, fetchEiaSpot, fetchSteoForecast, fetchFutures };

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((e) => {
    console.error('שגיאה קריטית:', e);
    process.exit(1);
  });
}
