#!/bin/sh
set -e
# הרצת migrations (יצירת/עדכון טבלאות) וזריעת נתוני בסיס (אידמפוטנטי)
echo "→ מריץ migrations…"
node_modules/.bin/knex --knexfile server/db/knexfile.js migrate:latest
echo "→ זריעת נתוני בסיס…"
node_modules/.bin/knex --knexfile server/db/knexfile.js seed:run
echo "→ מפעיל שרת…"
exec node server/index.js
