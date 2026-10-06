# פריסה אוטומטית (CI/CD) — מערכת ההזמנות על Oracle

הצינור `.github/workflows/deploy-bookings.yml` מתקין **אוטומטית** את שכבות ה-API וה-UI
על Oracle ADB בכל push לקבצי `bookings/api/**` או `bookings/app/**`. אחרי ההגדרה
החד-פעמית למטה — כל שינוי עתידי נכתב, נדחף, **ומותקן לבד** (בלי הדבקות, בלי F5).

> **בטוח לנתונים:** הצינור מריץ רק `install_api.sql` + `install_ui.sql` — הם לא מוחקים
> טבלאות ולא נוגעים בהזמנות. **שינויי סכמה** (`bookings/db/**`) *אינם* מותקנים
> אוטומטית בכוונה (כי `install_all.sql` בונה טבלאות מחדש). שינוי סכמה = צעד ידני מכוון.

---

## הגדרה חד-פעמית (~5 דקות)

### 1. הורד את ה-Wallet של בסיס הנתונים
1. Oracle Cloud Console → בסיס הנתונים **arkia-bookings** → כפתור **Database connection**.
2. **Download wallet** → סוג **Instance Wallet** → קבע סיסמת wallet כלשהי (לא נשתמש בה
   בצינור, אבל נדרשת להורדה) → הורד קובץ `Wallet_ARKIABKG.zip`.

### 2. הפוך את ה-Wallet ל-base64
- **Windows (PowerShell):**
  ```powershell
  [Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\Wallet_ARKIABKG.zip")) | Set-Clipboard
  ```
  (התוצאה מועתקת ללוח.)
- **Mac/Linux:**
  ```bash
  base64 -w0 ~/Downloads/Wallet_ARKIABKG.zip | pbcopy   # mac
  base64 -w0 ~/Downloads/Wallet_ARKIABKG.zip            # linux (העתק ידנית)
  ```

### 3. הגדר Secrets ב-GitHub
מאגר `rancohen22-eng/tamhir` → **Settings** → **Secrets and variables** → **Actions** →
לשונית **Secrets** → **New repository secret**, פעמיים:

| Secret name | Value |
|---|---|
| `DB_WALLET_BASE64` | ה-base64 שהעתקת בשלב 2 |
| `DB_PASSWORD` | הסיסמה של הסכמה **ARKIA** (`Trip#Secure2026`) |

### 4. (אופציונלי) Variables — רק אם שונה מברירת המחדל
לשונית **Variables** → **New repository variable**:

| Variable | ברירת מחדל | מתי לשנות |
|---|---|---|
| `DB_USER` | `ARKIA` | אם שם הסכמה שונה |
| `DB_CONN` | `arkiabkg_high` | אם ה-TNS alias שונה — ראו `tnsnames.ora` בתוך ה-Wallet |

> **איך למצוא את ה-alias הנכון:** פתח את `Wallet_ARKIABKG.zip` → `tnsnames.ora` →
> קח שם כמו `arkiabkg_high` (או `arkiabkg_tp`). אם ה-DB שלך בשם אחר, החלף בהתאם.

---

## זהו — הפעלה
- כל push עתידי לקבצי ה-API/UI → הצינור רץ ומתקין תוך ~2 דקות.
- להרצה ידנית: **Actions** → *Deploy Arkia Bookings* → **Run workflow**.
- לפני שהסודות מוגדרים, הצינור פשוט **מדלג** (ריצה ירוקה עם הערה) — לא נכשל.

## מה קורה בכל ריצה
```
SQLcl → connect ARKIA (דרך ה-Wallet)
      → @bookings/api/install_api.sql   (חבילת ה-API + מודול ORDS)
      → @bookings/api/install_ui.sql    (טעינת ה-HTML המעודכן)
      → בדיקה: API_PKG = VALID
```

## אבטחה
- הסודות מוצפנים ב-GitHub ונחשפים רק לצינור בזמן ריצה; לוגים ממסכים אותם.
- מומלץ בהמשך: להחליף את סיסמת הדמו `Arkia2026!` של המשתמשים, ולהגביל CORS/טוקנים.
