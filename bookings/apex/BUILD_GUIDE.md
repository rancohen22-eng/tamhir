# מדריך בניית אפליקציית APEX — מערכת תיעוד הזמנות טיסות (ארקיע)

מדריך שלב-אחר-שלב להרכבת אפליקציית ה-APEX מעל סכמת בסיס הנתונים שנוצרה ב-`bookings/db/`. מיועד למי שבונה ב-APEX Builder (גרסה 22+ / Autonomous DB).

---

## 0. דרישות מקדימות
1. Oracle Autonomous Database (Always Free מספיק) עם APEX מופעל, ו-Workspace המשויך לסכמת האפליקציה.
2. הרצת הסקריפטים לפי הסדר (SQL Workshop → SQL Scripts, או SQLcl):
   ```
   @db/01_tables.sql
   @db/02_seed.sql
   @db/03_booking_pkg.sql
   @db/04_views.sql
   @db/05_grants.sql   -- לפי הצורך
   ```
3. ודאו שהחבילה קומפלה נקי: `SELECT object_name, status FROM user_objects WHERE object_name='BOOKING_PKG';` → `VALID`.

---

## 1. יצירת האפליקציה
App Builder → **Create** → **New Application**:
- **Name:** תיעוד הזמנות טיסות · Arkia
- **Appearance:** Theme = *Universal Theme*, Theme Style = *Vita*.
- הוסיפו עמוד ריק בשם *Home* (נבנה בהמשך). הסירו את דף ה-Login הדיפולטי — נחליף באימות מותאם (סעיף 3).

---

## 2. תמיכה דו-לשונית (עברית ברירת מחדל / אנגלית)
### 2.1 שפות האפליקציה
- **Shared Components → Globalization → Globalization Attributes:**
  - Application Primary Language = `he` (Hebrew).
  - Application Language Derived From = **Item Preference** → פריט `APP_LANG`.
  - Automatic CSV/Time Zone לפי הצורך.
- **Shared Components → Translation → Translate Application:** הפיקו Application מתורגם לאנגלית (`en`). ייצוא XLIFF → תרגום המחרוזות הסטטיות → ייבוא → *Publish*. (אפשר להתחיל דו-לשונית עם התוויות המובנות ולהשלים תרגום בהדרגה.)

### 2.2 פריט השפה + מתג הדגל
- צרו **Application Item** בשם `APP_LANG` (Scope: Application).
- ב-**Page 0 (Global Page)** או ב-Navigation Bar הוסיפו שני קישורים (דגלים):
  - 🇮🇱 עברית → מפנה לאותו עמוד עם `request=LANG_HE`.
  - 🇺🇸 English → `request=LANG_EN`.
- **Application Process** (On Load: Before Header) שמזהה את ה-request ומעדכן העדפה:
  ```plsql
  IF :REQUEST IN ('LANG_HE','LANG_EN') THEN
     APEX_UTIL.SET_PREFERENCE('APP_LANG', CASE :REQUEST WHEN 'LANG_EN' THEN 'en' ELSE 'he' END);
     UPDATE app_users SET pref_lang = CASE :REQUEST WHEN 'LANG_EN' THEN 'EN' ELSE 'HE' END
      WHERE user_id = :G_USER_ID;
     APEX_UTIL.REDIRECT_URL( APEX_PAGE.GET_URL(p_page => :APP_PAGE_ID) );
  END IF;
  ```
- הכיוון (RTL/LTR) מתחלף אוטומטית לפי שפת הריצה של APEX. ה-Views (`v_bookings` וכו') כבר בוחרים תווית `label_he/label_en` לפי `booking_pkg.current_lang`, שקורא את `APP_LANG` — כך הסטטוסים מתחלפים יחד עם הממשק.

---

## 3. אימות מותאם (Custom Authentication) מול `APP_USERS`
Shared Components → **Authentication Schemes** → Create → *Custom*:
- **Authentication Function Name:** פונקציה עוטפת שמחזירה BOOLEAN. הוסיפו ל-`booking_pkg` או צרו סטנד-אלון:
  ```plsql
  CREATE OR REPLACE FUNCTION app_authenticate(p_username VARCHAR2, p_password VARCHAR2)
  RETURN BOOLEAN IS
  BEGIN
    RETURN booking_pkg.authenticate(p_username, p_password);
  END;
  ```
  (הפונקציה `booking_pkg.authenticate` כבר קיימת — אפשר להצביע עליה ישירות אם ה-signature תואם.)
- **Post-Authentication Procedure:** טוענת הקשר משתמש ל-Application Items:
  ```plsql
  BEGIN
    SELECT user_id, dept_id, pref_lang
      INTO :G_USER_ID, :G_DEPT_ID, :G_PREF_LANG
      FROM app_users WHERE LOWER(username) = LOWER(:APP_USER);
    APEX_UTIL.SET_PREFERENCE('APP_LANG', LOWER(:G_PREF_LANG));
  END;
  ```
- צרו Application Items: `G_USER_ID`, `G_DEPT_ID`, `G_PREF_LANG`.

---

## 4. הרשאות (Authorization Schemes) לכל תפקיד
Shared Components → **Authorization Schemes** → לכל תפקיד סכימת *Exists*/*PLSQL Function Returning Boolean*:
```plsql
-- דוגמה ל-ROLE_APPROVER (שכפלו לכל role_code)
RETURN EXISTS (
  SELECT 1 FROM user_roles
   WHERE user_id = :G_USER_ID AND role_code = 'APPROVER'
);
```
צרו: `ROLE_ADMIN`, `ROLE_INITIATOR`, `ROLE_APPROVER`, `ROLE_AGENT`, `ROLE_FINANCE`.
שייכו כל עמוד/כפתור/אזור לסכימת ההרשאה המתאימה.

---

## 5. העמודים
> טיפ: לרוב העמודים השתמשו ב-**Create Page → From a Table/View** מעל `V_BOOKINGS`, ואז התאימו.

### 5.1 Home / הזמנות המחלקה (Interactive Report)
- מקור: `V_BOOKINGS`.
- **WHERE** לפי תפקיד:
  - מזמין/מאשר: `dept_id = :G_DEPT_ID`.
  - סוכן: `agent_id = (SELECT agent_id FROM agents WHERE user_id = :G_USER_ID)`.
  - כספים/אדמין: ללא סינון.
- עמודות: מזהה, סטטוס (`status_label`), מזמין, סוכן, תאריך פתיחה, תאריך יציאה, מחיר+מטבע, PNR. Link לעמוד הפירוט.
- בכותרת: מתג הדגל (סעיף 2.2) + פעמון (סעיף 7).
- זה גם הבסיס למחולל טמפלט הדוחות — IR מאפשר בחירת עמודות, סינון, *Save Report* וייצוא Excel.

### 5.2 הזמנה חדשה (Form) — מינימום שדות
- מקור: `BOOKINGS`. שדות גלויים: תאריך יציאה, מחיר משוער (אופציונלי), מטבע (ברירת מחדל USD), בחירת סוכן (LOV מ-`agents`), הערה.
- ערכי ברירת מחדל בתהליך *Before Insert*: `dept_id := :G_DEPT_ID; initiator_id := :G_USER_ID; open_date := SYSDATE; status := 'NEW'`.
- כפתור **"שלח לסוכן"** → תהליך `booking_pkg.send_for_quote(:P_ID, :P_AGENT_ID, :G_USER_ID);`
- הרשאה: `ROLE_INITIATOR`.

### 5.3 פירוט הזמנה (Detail)
- אזור פרטים מ-`V_BOOKINGS`.
- **ציר זמן סטטוסים:** Classic Report / Timeline מ-`V_BOOKING_TIMELINE WHERE booking_id = :P_ID ORDER BY action_at` — מציג מי/מתי/ממה-למה/הערה.
- **קבצים:** אזור המציג `booking_files` (הורדה/תצוגה), עם **לוגו טוסטוס** בראש כרטיס ההזמנה כשמשויך סוכן (סעיף 8).
- **כפתורי פעולה מותנים** (לפי סטטוס + תפקיד):
  | כפתור | תנאי הצגה | תהליך |
  |---|---|---|
  | הגש הצעת מחיר | סטטוס `AWAITING_QUOTE` + `ROLE_AGENT` | פותח עמוד 5.4 |
  | אשר | `QUOTE_RECEIVED` + `ROLE_APPROVER` | `booking_pkg.approve(:P_ID,:G_USER_ID)` |
  | דחה | `QUOTE_RECEIVED` + `ROLE_APPROVER` | `booking_pkg.reject(:P_ID,:G_USER_ID,:P_REASON)` |
  | כרטס | `APPROVED` + `ROLE_AGENT` | פותח עמוד 5.5 |
  | בקש ביטול | סטטוס לא-סופי + `ROLE_INITIATOR`/`ROLE_APPROVER` | `booking_pkg.request_cancel(:P_ID,:G_USER_ID,:P_REASON)` |
  | אשר ביטול | `CANCEL_REQUESTED` + `ROLE_AGENT` | `booking_pkg.confirm_cancel(:P_ID,:G_USER_ID)` |

### 5.4 הצעת מחיר (סוכן)
- שדות: מחיר, מטבע, פרטי נסיעה, הערות + **העלאת צילום** (File Browse → `booking_files`, `file_kind='QUOTE_SCREENSHOT'`).
- תהליך שמירה: הכנס קובץ ל-`booking_files`, ואז `booking_pkg.submit_quote(:P_ID,:P_PRICE,:P_CCY,:P_TRIP,:P_NOTES,:G_USER_ID)`.
- הרשאה: `ROLE_AGENT`.

### 5.5 כרטוס (סוכן)
- שדות: `pnr`, מזהה חד-ערכי (`unique_booking_ref`), תאריך כרטוס + **העלאת מסמך/תמונת כרטוס** (`file_kind='FINAL_TICKET'`).
- תהליך: הכנס קובץ, ואז `booking_pkg.ticket(:P_ID,:P_PNR,:P_UREF,:P_TDATE,:G_USER_ID)`.
- הרשאה: `ROLE_AGENT`.

### 5.6 דשבורד כספים
- IR/IG מעל `V_BOOKINGS` (ללא סינון מחלקה) + כרטיסי סיכום מ-`V_FINANCE_SUMMARY` (סה"כ לפי מחלקה/מטבע/חודש).
- גרפים: הזמנות לפי סטטוס/חודש. ייצוא Excel מובנה ב-IR (Actions → Download → XLSX).
- הרשאה: `ROLE_FINANCE` (+`ROLE_ADMIN`).

### 5.7 מחולל טמפלט דוחות
- **בסיס:** ה-IR של עמוד הכספים כבר נותן *Save Report* בשם, בחירת עמודות, מסננים וייצוא — זו הליבה.
- **תוספת מפורשת:** עמוד "בונה טמפלט": Checkbox Group של שדות זמינים → שמירה ל-`REPORT_TEMPLATES(columns_json,filters_json,owner_id,is_shared)`. עמוד "הרצת דוח" בונה IR דינמי לפי הטמפלט שנבחר.

### 5.8 מסכי ניהול (אדמין)
Interactive Grid לכל טבלה: `DEPARTMENTS`, `APP_USERS`(+`USER_ROLES`), `DEPT_APPROVERS`, `AGENTS`, `CURRENCIES`. הרשאה: `ROLE_ADMIN`.
- ב-Grid של סוכנים אפשרו העלאת `logo_blob` (File Browse) — כך כל סוכן מקבל לוגו משלו.
- שינוי סיסמת משתמש: כפתור שקורא `booking_pkg.set_password(:USERNAME,:NEW_PW)`.

---

## 6. התראות אימייל (APEX_MAIL)
1. **Instance/Workspace mail:** הגדירו SMTP (או OCI Email Delivery) ב-App Builder → Workspace/Instance settings, וכתובת שולח מאושרת.
2. עדכנו את `booking_pkg.g_mail_from` לכתובת השולח האמיתית.
3. המיילים נשלחים אוטומטית מתוך `booking_pkg.change_status` (best-effort). אם המייל אינו מוגדר, **הפעמון עדיין עובד** — לא נכשלת הפעולה.
4. (אופציונלי) ג'וב לשליחת מייל אסינכרונית: `APEX_MAIL.PUSH_QUEUE` או שאירו את ברירת המחדל.

---

## 7. פעמון התראות (בתוך המערכת)
- **Navigation Bar entry** עם Badge: מקור מונה
  ```sql
  SELECT COUNT(*) FROM notifications WHERE user_id = :G_USER_ID AND is_read = 'N'
  ```
- עמוד "התראות": Report מ-`notifications WHERE user_id=:G_USER_ID ORDER BY created_at DESC`, עם כפתור "סמן כנקרא" (`UPDATE notifications SET is_read='Y' ...`). לחיצה על התראה מנווטת להזמנה.

---

## 8. מיתוג ארקיע + לוגו טוסטוס
- **Theme Roller:** Primary `#123a86`, Accent `#1e63b8`, Success `#0e7a4e`; גופן Heebo. שמרו כ-Theme Style.
- **לוגו ארקיע:** Shared Components → App Logo → Image, העלו `assets/arkia-logo.svg` (או השתמשו ב-data-URI מ-`index.html`).
- **לוגו טוסטוס (co-branding):**
  - העלו `assets/toustous-logo.jpeg` ל-`agents.logo_blob` של הסוכן טוסטוס (דרך Grid הניהול או File Browse).
  - הציגו אותו ב: עמוד הצעת מחיר/כרטוס (מסכי הסוכן), כרטיס ההזמנה בפירוט כשמשויך סוכן, וראש מסמך ההצעה/כרטוס המיוצא — לצד לוגו ארקיע, בגודל משני.
  - הצגה מ-BLOB: אזור עם `<img src="#APP_FILES#...">` או דרך `apex_util.get_blob_file_src`, או Report Column מסוג *Display Image* מ-`booking_files`/`agents`.

---

## 9. שמירת האפליקציה ב-Git
לאחר הבנייה, ייצאו את האפליקציה וה-DDL וכיתבו למאגר:
```bash
# עם SQLcl מחובר לסכמה:
apex export -applicationid <APP_ID> -dir bookings/apex -expType APPLICATION_SOURCE,READABLE_YAML
```
Commit את התיקייה `bookings/apex/f<APP_ID>.sql` (או ה-YAML) יחד עם שאר הקבצים לניהול גרסאות.

---

## 10. בדיקת קצה-לקצה (Verification)
1. התחבר כ-`initiator_acmi` → פתח הזמנה חדשה → שלח לסוכן. ודא סטטוס `AWAITING_QUOTE`.
2. התחבר כ-`toustous` → פתח את הבקשה → הגש הצעת מחיר + העלה צילום. ודא `QUOTE_RECEIVED` והתראה (פעמון) ל-`initiator_acmi`.
3. התחבר כ-`approver_acmi` → אשר. ודא `APPROVED` והתראה לסוכן.
4. חזור כ-`toustous` → כרטס: PNR + מזהה חד-ערכי + מסמך. ודא `TICKETED` והתראות למזמין+מאשר.
5. בפירוט ההזמנה — ודא **ציר זמן** מלא (מי/מתי) והקבצים המצורפים.
6. **ביטול:** כ-`initiator_acmi` בקש ביטול → כ-`toustous` אשר ביטול → ודא `CANCELLED` + התראות.
7. **דו-לשוניות:** החלף דגל 🇺🇸/🇮🇱 — ודא שהממשק, הכיוון (RTL/LTR), הסטטוסים וההתראות מתחלפים.
8. **כספים:** כ-`finance` פתח דשבורד → ייצא Excel → צור טמפלט דוח בבחירת שדות.
