# התקנת מערכת הדוחות הכספיים על Oracle Cloud (OCI) — מדריך שלב-אחר-שלב

מדריך זה מתאר התקנה מלאה של המערכת על תשתית Oracle: **Oracle Autonomous Database**
לבסיס הנתונים, ושרת Node.js (מכונת Compute של OCI) שמריץ את האפליקציה.

> סימון: פקודות מריצים בטרמינל של שרת ה-Compute אלא אם צוין אחרת. ערכים בסוגריים
> משולשים `<...>` יש להחליף בערכים שלכם.

---

## שלב 0 — דרישות מקדימות
- חשבון Oracle Cloud (OCI) עם הרשאות ליצירת Autonomous Database ו-Compute.
- שם דומיין (אופציונלי, מומלץ ל-HTTPS).
- היכרות בסיסית עם SSH.

---

## שלב 1 — יצירת Autonomous Database
1. ב-OCI Console: **Menu → Oracle Database → Autonomous Database → Create**.
2. בחרו **Workload type: Transaction Processing** (ATP), שם תצוגה, ו-Database name
   (למשל `ARKIAFR`).
3. הגדירו סיסמת **ADMIN** חזקה ושמרו אותה.
4. **Network access**: לפיתוח ראשוני אפשר "Secure access from everywhere"; לפרודקשן
   מומלץ Private Endpoint / רשימת IP מורשים.
5. לאחר שה-DB במצב **Available**, לחצו **Database Connection → Download Wallet**,
   בחרו סוג **Instance Wallet**, קבעו סיסמת wallet ושמרו את קובץ ה-ZIP.
   בתוך ה-ZIP נמצא `tnsnames.ora` — שם החיבור לשימוש יהיה למשל `arkiafr_high`.

---

## שלב 2 — יצירת סכימת משתמש ל-DB (לא ADMIN)
מומלץ לא להשתמש ב-ADMIN לאפליקציה. דרך **Database Actions → SQL** (בקונסולת ה-DB),
הריצו:
```sql
CREATE USER ARKIA_FR IDENTIFIED BY "<StrongPassword#123>";
GRANT CONNECT, RESOURCE TO ARKIA_FR;
ALTER USER ARKIA_FR QUOTA UNLIMITED ON DATA;
```
המשתמש `ARKIA_FR` ישמש את האפליקציה (בעל הטבלאות).

---

## שלב 3 — הקמת שרת Compute להרצת Node.js
1. **Menu → Compute → Instances → Create instance**. בחרו Image **Ubuntu 22.04**,
   Shape קטן (למשל VM.Standard.E4.Flex, 1 OCPU / 8GB), והעלו/צרו מפתח SSH.
2. ב-**Networking**: ודאו Public IP; ב-Security List/NSG פתחו פורטים **22** (SSH),
   **443** (HTTPS) ו-**80** (HTTP, ל-Let's Encrypt).
3. התחברו: `ssh ubuntu@<PUBLIC_IP>`.

התקינו Node.js 20 וכלים:
```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs git nginx
node --version   # אמור להראות v20+
```

---

## שלב 4 — העתקת ה-Wallet לשרת
העלו את קובץ ה-wallet מהמחשב שלכם לשרת (מהמחשב המקומי):
```bash
scp Wallet_ARKIAFR.zip ubuntu@<PUBLIC_IP>:/home/ubuntu/
```
בשרת:
```bash
sudo mkdir -p /opt/oracle/wallet
sudo unzip /home/ubuntu/Wallet_ARKIAFR.zip -d /opt/oracle/wallet
sudo chown -R ubuntu:ubuntu /opt/oracle/wallet
```

---

## שלב 5 — הבאת הקוד והתקנת תלויות
```bash
cd /opt
sudo git clone <REPO_URL> arkia
sudo chown -R ubuntu:ubuntu /opt/arkia
cd /opt/arkia/financial-reports
npm install --omit=dev
```
> `oracledb` נטען כתלות (Thin mode) — אין צורך ב-Oracle Instant Client.

---

## שלב 6 — קובץ סביבה (.env)
צרו `/opt/arkia/financial-reports/.env`:
```bash
NODE_ENV=production
PORT=3000
SESSION_SECRET=<הריצו: openssl rand -hex 32>

ORACLE_USER=ARKIA_FR
ORACLE_PASSWORD=<StrongPassword#123>
ORACLE_CONNECT_STRING=arkiafr_high
TNS_ADMIN=/opt/oracle/wallet
```
> `ORACLE_CONNECT_STRING` = שם החיבור מתוך `tnsnames.ora` שב-wallet (למשל `_high`).
> `TNS_ADMIN` מצביע לתיקיית ה-wallet — node-oracledb מוצא דרכו את ה-TLS/tnsnames.

---

## שלב 7 — יצירת הטבלאות וזריעת נתוני בסיס
```bash
cd /opt/arkia/financial-reports
npm run migrate     # יוצר את כל הטבלאות ב-Oracle
npm run seed        # משתמש admin / Arkia2026! + חברות + תקופה
```
> **חשוב**: התחברו מיד לאחר מכן והחליפו את סיסמת ה-admin (מסך משתמשים / שינוי סיסמה).

בדיקה מהירה:
```bash
node server/index.js   # אמור להדפיס "פועלת על פורט 3000"; עצרו עם Ctrl+C
```

---

## שלב 8 — הרצה כשירות קבוע (systemd)
צרו `/etc/systemd/system/arkia-fr.service`:
```ini
[Unit]
Description=Arkia Financial Reports
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/arkia/financial-reports
ExecStart=/usr/bin/node server/index.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```
הפעלה:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now arkia-fr
sudo systemctl status arkia-fr    # אמור להיות active (running)
```

---

## שלב 9 — Nginx כ-Reverse Proxy + HTTPS
צרו `/etc/nginx/sites-available/arkia-fr`:
```nginx
server {
    listen 80;
    server_name <your-domain-or-ip>;
    client_max_body_size 50M;   # להעלאת קובצי אקסל גדולים

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/arkia-fr /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```
HTTPS (אם יש דומיין) עם Let's Encrypt:
```bash
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d <your-domain>
```

---

## שלב 10 — עדכוני גרסה
```bash
cd /opt/arkia/financial-reports
git pull
npm install --omit=dev
npm run migrate        # מריץ migrations חדשים בלבד
sudo systemctl restart arkia-fr
```

---

## אבטחה וגיבוי
- **גיבוי DB**: Autonomous Database מגובה אוטומטית; ניתן גם Manual Backup בקונסולה.
- **סודות**: אל תכניסו את `.env` ל-git (כבר ב-.gitignore). שמרו סיסמאות ב-OCI Vault.
- **רשת**: הגבילו את גישת ה-DB ל-Private Endpoint או IP של שרת ה-Compute בלבד.
- **הרשאות**: כל משתמש עם הרשאת צפייה/עריכה per חברה; המנהל מנהל זאת במסך "משתמשים".

## פתרון תקלות
- `ORA-12154 / TNS could not resolve`: ודאו ש-`TNS_ADMIN` מצביע לתיקיית ה-wallet
  ושם `ORACLE_CONNECT_STRING` תואם ל-`tnsnames.ora`.
- `ORA-01017 invalid credentials`: בדקו `ORACLE_USER`/`ORACLE_PASSWORD`.
- שגיאת TLS/wallet: ודאו שכל קובצי ה-wallet (כולל `cwallet.sso`, `ewallet.pem`)
  קיימים בתיקייה ושהרשאות הקריאה תקינות.
- העלאת אקסל נכשלת ב-413: הגדילו `client_max_body_size` ב-nginx.
