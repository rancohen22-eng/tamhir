# דוח מחירי דלק יומי (Brent & WTI) במייל

תכנית שרצה **פעם ביום** דרך GitHub Actions ושולחת מייל לרשימת נמענים עם מחירי הדלק
**הנוכחיים והצפויים** ל-Brent ו-WTI, כולל השוואה **ליום הקודם** ו**לתחילת החודש**.

בנוסף, לכל חוזה עתידי מוצג עקום חוזים לפי חודש בסגנון Barchart (מחיר, שינוי יומי,
ושינוי מול תחילת החודש).

הכל **חינמי לחלוטין**: GitHub Actions (חינם ל-repo ציבורי) + EIA API (חינם) +
Gmail SMTP (חינם) + Barchart OnDemand (מפתח חינמי).

## קבצים

| קובץ | תפקיד |
|---|---|
| `scripts/fuel-report.mjs` | בונה את הדוח (`out/email.html`, `out/subject.txt`). Node 20, ללא תלויות npm. |
| `.github/workflows/daily-fuel-email.yml` | תזמון יומי (cron) + הרצה ידנית, בונה ושולח את המייל. |

## מקורות נתונים

- **EIA API v2** — מחיר ספוט יומי (`RWTC` = WTI, `RBRTE` = Brent) + היסטוריה להשוואות +
  תחזית רשמית STEO (`WTIPUUS`, `BREPUUS`) לחודשים הקרובים.
- **Barchart OnDemand** — עקום החוזים העתידיים לפי חודש (`getQuote` למחיר ולשינוי היומי,
  `getHistory` למחיר תחילת החודש). סמלים: Brent = `CB`, WTI = `CL` + קוד חודש+שנה
  (למשל `CBU26`, `CLQ26`), נוצרים אוטומטית ל-6 החודשים הקרובים.
- **Yahoo Finance** (ללא מפתח) — מקור **גיבוי** לעקום החוזים: מופעל אוטומטית כשאין `BARCHART_API_KEY`
  (או אם Barchart נכשל). חוזי WTI בכיסוי מלא; חוזי Brent בכיסוי חלקי.
  אם גם זה נכשל, הדוח עדיין נשלח עם נתוני EIA + STEO בלבד.

## הגדרה חד-פעמית — Secrets

יש להוסיף ב-**Settings → Secrets and variables → Actions → New repository secret**:

| Secret | תיאור | איפה משיגים |
|---|---|---|
| `EIA_API_KEY` | מפתח API חינמי של EIA | https://www.eia.gov/opendata/register.php (מיידי במייל) |
| `BARCHART_API_KEY` | מפתח API חינמי של Barchart OnDemand (getQuote + getHistory) | https://www.barchart.com/ondemand/free-market-data-api |
| `MAIL_USERNAME` | כתובת ה-Gmail השולחת | חשבון ה-Gmail שלך |
| `MAIL_APP_PASSWORD` | "סיסמת אפליקציה" של Google (דורש 2FA פעיל) | https://myaccount.google.com/apppasswords |
| `MAIL_TO` | רשימת נמענים מופרדת בפסיקים (למשל `a@x.com,b@y.com`) | — |

> רשימת הנמענים נשמרת כ-Secret כי ה-repo ציבורי — כתובות המייל אינן נחשפות בקוד.

## הרצה ובדיקה

- **בדיקה מקומית:**
  ```bash
  EIA_API_KEY=your_key BARCHART_API_KEY=your_key node scripts/fuel-report.mjs
  # ואז לפתוח את out/email.html בדפדפן
  ```
- **הרצה ידנית ב-GitHub:** לשונית **Actions → Daily Fuel Price Email → Run workflow**.
- **תזמון אוטומטי:** רץ כל יום ב-05:00 UTC (≈ 08:00 בקיץ / 07:00 בחורף בישראל).
  לשינוי השעה — ערכו את שדה ה-`cron` ב-`.github/workflows/daily-fuel-email.yml`
  (הזמן ב-UTC; GitHub אינו מבצע מעבר שעון קיץ/חורף).

## הערות

- מחיר הספוט הרשמי של EIA מתעדכן עם עיכוב של מספר ימי מסחר; החוזים העתידיים מ-Barchart
  משקפים את ציפיות השוק בזמן אמת.
- הדוח אינו מהווה ייעוץ או המלצה.
