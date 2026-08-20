#!/usr/bin/env bash
#
# התקנה בפקודה אחת של מערכת הדוחות הכספיים · ארקיע, על שרת Ubuntu (OCI).
# הרצה:
#   curl -fsSL https://raw.githubusercontent.com/rancohen22-eng/tamhir/claude/financial-reports-system-w7dkhk/financial-reports/deploy/install.sh | bash
# או אחרי clone:
#   bash financial-reports/deploy/install.sh
#
set -euo pipefail

REPO_URL="https://github.com/rancohen22-eng/tamhir.git"
BRANCH="claude/financial-reports-system-w7dkhk"
APP_DIR="/opt/arkia"
FR_DIR="$APP_DIR/financial-reports"

echo "════════════════════════════════════════════════"
echo "  התקנת מערכת דוחות כספיים · ארקיע"
echo "════════════════════════════════════════════════"

# ── 1. Docker ──
if ! command -v docker >/dev/null 2>&1; then
  echo "→ מתקין Docker…"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi
DC="docker compose"
if ! docker compose version >/dev/null 2>&1; then DC="docker-compose"; fi

# ── 2. קוד ──
if [ -d "$FR_DIR/.git" ] || [ -d "$APP_DIR/.git" ]; then
  echo "→ מעדכן קוד קיים…"
  sudo git -C "$APP_DIR" fetch origin "$BRANCH"
  sudo git -C "$APP_DIR" checkout "$BRANCH"
  sudo git -C "$APP_DIR" pull origin "$BRANCH"
else
  echo "→ מוריד את הקוד…"
  sudo git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
sudo chown -R "$USER":"$USER" "$APP_DIR"
cd "$FR_DIR"

# ── 3. Wallet ──
mkdir -p wallet
if [ -z "$(ls -A wallet 2>/dev/null)" ]; then
  WZIP="$(ls -1 "$HOME"/Wallet_*.zip "$HOME"/wallet*.zip 2>/dev/null | head -1 || true)"
  if [ -n "$WZIP" ]; then
    echo "→ מחלץ wallet מ-$WZIP…"
    unzip -o "$WZIP" -d wallet >/dev/null
  else
    echo "⚠ תיקיית wallet ריקה. העלו את קובץ ה-Wallet_*.zip ל-$HOME וחלצו ל-$FR_DIR/wallet,"
    echo "  או הריצו:  unzip ~/Wallet_XXX.zip -d $FR_DIR/wallet"
  fi
fi

# ── 4. .env ──
if [ ! -f .env ]; then
  echo "→ יוצר קובץ .env…"
  SECRET="$(openssl rand -hex 32)"
  read -rp "Oracle DB user  [ARKIA_FR]: " ORA_USER; ORA_USER="${ORA_USER:-ARKIA_FR}"
  read -rsp "Oracle DB password: " ORA_PASS; echo
  # ניחוש שם החיבור מתוך tnsnames.ora (מעדיף _high)
  GUESS="$(grep -oE '^[a-zA-Z0-9_]+_high' wallet/tnsnames.ora 2>/dev/null | head -1 || true)"
  read -rp "Oracle connect string [${GUESS:-dbname_high}]: " ORA_CS; ORA_CS="${ORA_CS:-${GUESS:-dbname_high}}"
  cat > .env <<EOF
NODE_ENV=production
PORT=3000
SESSION_SECRET=$SECRET
ORACLE_USER=$ORA_USER
ORACLE_PASSWORD=$ORA_PASS
ORACLE_CONNECT_STRING=$ORA_CS
TNS_ADMIN=/opt/oracle/wallet
EOF
  echo "  ✓ .env נוצר"
else
  echo "→ .env קיים — משאיר כפי שהוא"
fi

# ── 5. חומת אש (פתיחת פורטים) ──
sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
sudo netfilter-persistent save 2>/dev/null || true

# ── 6. בנייה והפעלה ──
echo "→ בונה ומעלה קונטיינר…"
sudo $DC up -d --build

echo ""
echo "════════════════════════════════════════════════"
echo "  ✓ הותקן! המערכת רצה על פורט 3000"
echo "    כניסה:  http://<PUBLIC_IP>:3000   (admin / Arkia2026!)"
echo "    ⚠ החליפו את סיסמת admin מיד לאחר הכניסה."
echo ""
echo "  ל-HTTPS עם דומיין:"
echo "    DOMAIN=your-domain.com sudo $DC --profile https up -d"
echo "  לוגים:   sudo $DC logs -f app"
echo "════════════════════════════════════════════════"
