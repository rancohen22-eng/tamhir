# דוח מחירי דלק יומי (Brent & WTI) במייל

תכנית שרצה **פעם ביום** דרך GitHub Actions ושולחת מייל לרשימת נמענים עם מחירי הדלק
**הנוכחיים והצפויים** ל-Brent ו-WTI, כולל השוואה **ליום הקודם** ו**לתחילת החודש**.

הכל **חינמי לחלוטין**: GitHub Actions (חינם ל-repo ציבורי) + EIA API (חינם) +
Gmail SMTP (חינם) + Yahoo Finance (ללא מפתח).

## קבצים

| קובץ | תפקיד |
|---|---|
| `scripts/fuel-report.mjs` | בונה את הדוח (`out/email.html`, `out/subject.txt`). Node 20, ללא תלויות npm. |
| `.github/workflows/daily-fuel-email.yml` | תזמון יומי (cron) + הרצה ידנית, בונה ושולח את המייל. |

## מקורות נתונים

- **EIA API v2** — מחיר ספוט יומי (`RWTC` = WTI, `RBRTE` = Brent) + היסטוריה להשוואות +
  תחזית רשמית STEO (`WTIPUUS`, `BREPUUS`) לחודשים הקרובים.
- **Yahoo Finance** (ללא מפתח, best-effort) — "מחיר שוק חי" מהחוזה הקרוב ועקום חוזים עתידיים.
  אם Yahoo אינו זמין, הדוח עדיין נשלח עם נתוני EIA + STEO בלבד.

## הגדרה חד-פעמית — Secrets

יש להוסיף ב-**Settings → Secrets and variables → Actions → New repository secret**:

| Secret | תיאור | איפה משיגים |
|---|---|---|
| `EIA_API_KEY` | מפתח API חינמי של EIA | https://www.eia.gov/opendata/register.php (מיידי במייל) |
| `MAIL_USERNAME` | כתובת ה-Gmail השולחת | חשבון ה-Gmail שלך |
| `MAIL_APP_PASSWORD` | "סיסמת אפליקציה" של Google (דורש 2FA פעיל) | https://myaccount.google.com/apppasswords |
| `MAIL_TO` | רשימת נמענים מופרדת בפסיקים (למשל `a@x.com,b@y.com`) | — |

> רשימת הנמענים נשמרת כ-Secret כי ה-repo ציבורי — כתובות המייל אינן נחשפות בקוד.

## הרצה ובדיקה

- **בדיקה מקומית:**
  ```bash
  EIA_API_KEY=your_key node scripts/fuel-report.mjs
  # ואז לפתוח את out/email.html בדפדפן
  ```
- **הרצה ידנית ב-GitHub:** לשונית **Actions → Daily Fuel Price Email → Run workflow**.
- **תזמון אוטומטי:** רץ כל יום ב-05:00 UTC (≈ 08:00 בקיץ / 07:00 בחורף בישראל).
  לשינוי השעה — ערכו את שדה ה-`cron` ב-`.github/workflows/daily-fuel-email.yml`
  (הזמן ב-UTC; GitHub אינו מבצע מעבר שעון קיץ/חורף).

## הערות

- מחיר הספוט הרשמי של EIA מתעדכן עם עיכוב של מספר ימי מסחר; לכן מוצג לצדו "מחיר שוק חי"
  מהחוזה הקרוב, כדי לשקף גם את הרמה העדכנית בשוק.
- הדוח אינו מהווה ייעוץ או המלצה.
