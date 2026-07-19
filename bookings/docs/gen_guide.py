#!/usr/bin/env python3
"""
gen_guide.py — מייצר את מדריך המשתמש הממותג (app/guide.html).
מטמיע את לוגו ארקיע וטלטוס כ-data URI כך שהמסמך עצמאי (עובד גם מוגש וגם כ-PDF).
הרצה: python3 docs/gen_guide.py
"""
import base64, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # bookings/
ARKIA  = os.path.join(ROOT, 'assets', 'arkia-logo.svg')
TELTOS = os.path.join(ROOT, 'assets', 'teltos-logo.jpeg')
OUT    = os.path.join(ROOT, 'app', 'guide.html')


def data_uri(path, mime):
    with open(path, 'rb') as f:
        return 'data:%s;base64,%s' % (mime, base64.b64encode(f.read()).decode('ascii'))


ARKIA_URI  = data_uri(ARKIA, 'image/svg+xml')
TELTOS_URI = data_uri(TELTOS, 'image/jpeg')

HTML = r"""<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>מדריך משתמש · הזמנת טיסות מטלטוס · ארקיע</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Heebo", Arial, sans-serif; color:#0e1c2e; margin:0; background:#fff; line-height:1.5; font-size:14px; }
  .wrap { max-width: 820px; margin:0 auto; padding: 20px; }
  header.top { display:flex; align-items:center; gap:14px; border-bottom:3px solid #123a86; padding-bottom:14px; margin-bottom:18px; }
  header.top img { height:40px; background:#fff; }
  header.top .x { color:#5b6b7f; font-size:18px; }
  header.top h1 { font-size:22px; color:#123a86; margin:0; flex:1; }
  header.top .sub { font-size:12px; color:#5b6b7f; }
  h2 { color:#fff; background:#123a86; padding:7px 12px; border-radius:8px; font-size:16px; margin:22px 0 10px; }
  h2.role { background:#0e7a4e; }
  .lead { color:#5b6b7f; margin:0 0 14px; }
  ul { margin:6px 0 12px; padding-inline-start:20px; }
  li { margin:4px 0; }
  b { color:#123a86; }
  .pill { display:inline-block; background:#e8eff7; color:#123a86; border-radius:999px; padding:1px 9px; font-size:12px; font-weight:700; }
  .steps { counter-reset: s; list-style:none; padding-inline-start:0; }
  .steps li { counter-increment:s; position:relative; padding-inline-start:30px; margin:6px 0; }
  .steps li::before { content: counter(s); position:absolute; inset-inline-start:0; top:0; width:22px; height:22px; background:#1e63b8; color:#fff; border-radius:50%; text-align:center; font-weight:700; font-size:12px; line-height:22px; }
  .note { background:#f2f5f9; border-inline-start:4px solid #1e63b8; border-radius:6px; padding:8px 12px; font-size:13px; margin:10px 0; }
  footer { margin-top:24px; border-top:1px solid #e2e8f0; padding-top:10px; color:#5b6b7f; font-size:11px; text-align:center; }
  .role-tag { font-size:12px; color:#0e7a4e; font-weight:700; }
</style>
</head>
<body>
<div class="wrap">

  <header class="top">
    <img src="__ARKIA__" alt="Arkia">
    <span class="x">✕</span>
    <img src="__TELTOS__" alt="Teltos">
    <h1>מדריך משתמש<div class="sub">מערכת הזמנת טיסות מטלטוס · ארקיע</div></h1>
  </header>

  <p class="lead">מדריך קצר לשימוש במערכת. חלק כללי לכולם, ואחריו הנחיות לפי תפקיד.</p>

  <h2>כללי — לכל המשתמשים</h2>
  <ul>
    <li><b>כניסה:</b> פותחים את קישור המערכת ומזינים שם משתמש וסיסמה. אחרי כניסה ראשונה נשארים מחוברים.</li>
    <li><b>במובייל:</b> אפשר להוסיף את האפליקציה למסך הבית (שיתוף → "הוסף למסך בית" באייפון; תפריט → "התקן אפליקציה" באנדרואיד) ולפתוח כמו אפליקציה.</li>
    <li><b>מסך ההזמנות:</b> דשבורד עם סיכומים בראש העמוד, וטבלת ההזמנות עם סטטוס, נתיב, מבצע אחרון ועוד. לחיצה על שורה פותחת את פירוט ההזמנה.</li>
    <li><b>פירוט הזמנה:</b> כל הפרטים, המסמכים המצורפים, ו<b>ציר זמן</b> שמראה מי עשה מה ומתי.</li>
    <li><b>התראות:</b> פעמון 🔔 בראש המסך (מונה לא-נקראו) + מייל. אפשר לכבות מייל לעצמך במסך ההתראות.</li>
    <li><b>שפה:</b> כפתור הדגל בכותרת מחליף עברית/אנגלית.</li>
  </ul>

  <h2 class="role">מזמין <span class="role-tag">(פותח הזמנות)</span></h2>
  <ol class="steps">
    <li>לוחצים <b>"הזמנה חדשה"</b>.</li>
    <li>ממלאים: <b>תאריך יציאה</b> (חובה), מספר נוסעים, שעה מועדפת (רשות), <b>נתיב</b> (מוצא/יעד לפי קוד/שם). למחלקת ACMI — גם <b>מפעיל רטוב</b>. אין צורך במחיר בשלב זה.</li>
    <li>לוחצים <b>"שלח לכל הסוכנים"</b> — ההזמנה נפתחת לכל הסוכנים לקבלת הצעה.</li>
    <li>עוקבים אחר הסטטוס בציר הזמן ומקבלים התראה כשמתקבלת הצעה.</li>
  </ol>
  <div class="note"><b>ביטול:</b> לפני כרטוס — ביטול מיידי ("בטל הזמנה"). לאחר כרטוס — "בקש ביטול", והסוכן צריך לאשר.</div>

  <h2 class="role">מאשר <span class="role-tag">(מאשר הצעות של המחלקה)</span></h2>
  <ul>
    <li>כשמוגשת הצעת מחיר מקבלים <b>מייל</b> עם פרטי ההזמנה, הצילום, וכפתור <b>"✔ אשר את ההצעה"</b> — אפשר לאשר <b>ישירות מהמייל</b>, בלי להיכנס למערכת.</li>
    <li>לחלופין נכנסים למערכת, פותחים את ההזמנה ולוחצים <b>אשר</b> או <b>דחה</b>.</li>
    <li>מאשר יכול גם <b>לפתוח הזמנה חדשה</b> וגם <b>לערוך</b> הזמנה (עד שלב הכרטוס).</li>
  </ul>

  <h2 class="role">סוכן <span class="role-tag">(טלטוס)</span></h2>
  <ol class="steps">
    <li>מקבלים התראה (פעמון + מייל) על <b>בקשה חדשה</b> להצעת מחיר.</li>
    <li>פותחים את ההזמנה ולוחצים <b>"הגש הצעת מחיר"</b>: מזינים מחיר, פרטי נסיעה, ומעלים <b>צילום ממערכת ההזמנות</b>.</li>
    <li>לאחר אישור המאשר — לוחצים <b>"כרטס"</b>: מזינים <b>PNR</b> ומעלים מסמך/תמונת כרטוס. (התאריך נקבע אוטומטית להיום.)</li>
    <li>לבקשת ביטול לאחר כרטוס — מאשרים את הביטול.</li>
  </ol>

  <h2 class="role">כספים</h2>
  <ul>
    <li>מסך <b>כספים</b>: דשבורד סיכומים + טבלת כל ההזמנות.</li>
    <li><b>סינון לפני הפקה:</b> טווח תאריכי כרטוס, מחלקה, סטטוס.</li>
    <li><b>ייצוא Excel/CSV</b> של הנתונים המסוננים.</li>
  </ul>

  <h2 class="role">מנהל מערכת</h2>
  <ul>
    <li><b>משתמשים:</b> הוספה, עריכה, מחיקה, ואיפוס סיסמה (נשלחת סיסמה זמנית במייל למשתמש).</li>
    <li><b>מאשר לפי מחלקה:</b> שיוך/החלפת המאשר לכל מחלקה.</li>
    <li><b>טבלאות ניהול:</b> מחלקות, מפעילים רטובים, שדות תעופה, מטבעות.</li>
    <li><b>דוחות:</b> מחולל תבניות לייצוא במסך הכספים.</li>
    <li><b>לוג כניסות:</b> מי נכנס למערכת ומתי.</li>
  </ul>

  <div class="note">סיסמאות נשמרות מוצפנות ואינן ניתנות לצפייה. אם שכחתם סיסמה — פנו למנהל המערכת לאיפוס (תישלח סיסמה זמנית במייל).</div>

  <footer>מערכת הזמנת טיסות מטלטוס · ארקיע · לשימוש פנימי</footer>
</div>
</body>
</html>
"""

HTML = HTML.replace('__ARKIA__', ARKIA_URI).replace('__TELTOS__', TELTOS_URI)

with open(OUT, 'w', encoding='utf-8') as f:
    f.write(HTML)
print("wrote", OUT, "(%d bytes)" % len(HTML))
