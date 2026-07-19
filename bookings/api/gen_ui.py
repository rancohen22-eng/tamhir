#!/usr/bin/env python3
"""
gen_ui.py — מחולל את bookings/api/install_ui.sql.

קורא את אפליקציית ה-SPA (app/index.html) ואת הלוגואים (assets/), מקודד ל-base64,
ומייצר את install_ui.sql שמגיש אותם מ-ORDS:
    /ords/arkia/api/app             ← האפליקציה (text/html)
    /ords/arkia/api/assets/arkia    ← לוגו ארקיע (image/svg+xml)
    /ords/arkia/api/assets/teltos   ← לוגו טלטוס (image/jpeg)

הרצה (מתוך תיקיית bookings/):  python3 api/gen_ui.py
לאחר כל שינוי ב-app/index.html או ב-assets/ — יש להריץ מחדש ולבצע commit.
"""
import base64, json, os, textwrap

HERE   = os.path.dirname(os.path.abspath(__file__))
ROOT   = os.path.dirname(HERE)                       # bookings/
APP     = os.path.join(ROOT, 'app', 'index.html')
ARKIA   = os.path.join(ROOT, 'assets', 'arkia-logo.svg')
TELTOS  = os.path.join(ROOT, 'assets', 'teltos-logo.jpeg')
APPICON = os.path.join(ROOT, 'assets', 'appicon.png')
OUT     = os.path.join(HERE, 'install_ui.sql')
CHUNK   = 3800                                        # < 4000 (מגבלת ליטרל VARCHAR2)

# מניפסט PWA (הוספה למסך הבית). מוגש מ-ORDS same-origin עם האפליקציה.
MANIFEST = {
    "name": "הזמנת טיסות מטלטוס",
    "short_name": "הזמנות",
    "start_url": "/ords/arkia/api/app",
    "scope": "/ords/arkia/api/",
    "display": "standalone",
    "background_color": "#123a86",
    "theme_color": "#123a86",
    "lang": "he", "dir": "rtl",
    "icons": [
        {"src": "/ords/arkia/api/assets/appicon", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "/ords/arkia/api/assets/appicon", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}


def b64(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')


def appends(target_where, data):
    """מחזיר שורות UPDATE שמצרפות את ה-base64 במקטעים."""
    out = []
    for i in range(0, len(data), CHUNK):
        out.append("UPDATE %s b64=b64||'%s' %s;" % (
            target_where[0], data[i:i+CHUNK], target_where[1]))
    return out


def main():
    app_b64      = b64(APP)
    arkia_b64    = b64(ARKIA)
    teltos_b64   = b64(TELTOS)
    appicon_b64  = b64(APPICON)
    manifest_b64 = base64.b64encode(
        json.dumps(MANIFEST, ensure_ascii=False).encode('utf-8')).decode('ascii')

    L = []
    L.append("--------------------------------------------------------------------------------")
    L.append("-- מערכת תיעוד הזמנות טיסות (ארקיע) · install_ui.sql (נוצר אוטומטית ע\"י gen_ui.py)")
    L.append("-- מגיש מ-ORDS: /ords/arkia/api/app + /ords/arkia/api/assets/arkia|teltos")
    L.append("-- לעריכה: שנו את app/index.html או את assets/ והריצו מחדש api/gen_ui.py")
    L.append("--------------------------------------------------------------------------------")
    L.append("")
    L.append("BEGIN EXECUTE IMMEDIATE 'DROP TABLE api_app CASCADE CONSTRAINTS PURGE'; EXCEPTION WHEN OTHERS THEN NULL; END;")
    L.append("/")
    L.append("BEGIN EXECUTE IMMEDIATE 'DROP TABLE api_assets CASCADE CONSTRAINTS PURGE'; EXCEPTION WHEN OTHERS THEN NULL; END;")
    L.append("/")
    L.append("CREATE TABLE api_app (id NUMBER PRIMARY KEY, b64 CLOB);")
    L.append("CREATE TABLE api_assets (name VARCHAR2(40) PRIMARY KEY, mime VARCHAR2(80), b64 CLOB);")
    L.append("INSERT INTO api_app (id, b64) VALUES (1, EMPTY_CLOB());")
    L.append("INSERT INTO api_assets (name, mime, b64) VALUES ('arkia', 'image/svg+xml', EMPTY_CLOB());")
    L.append("INSERT INTO api_assets (name, mime, b64) VALUES ('teltos', 'image/jpeg', EMPTY_CLOB());")
    L.append("INSERT INTO api_assets (name, mime, b64) VALUES ('appicon', 'image/png', EMPTY_CLOB());")
    L.append("INSERT INTO api_assets (name, mime, b64) VALUES ('manifest', 'application/manifest+json', EMPTY_CLOB());")

    L += appends(("api_app SET",       "WHERE id=1"),              app_b64)
    L += appends(("api_assets SET",    "WHERE name='arkia'"),      arkia_b64)
    L += appends(("api_assets SET",    "WHERE name='teltos'"),     teltos_b64)
    L += appends(("api_assets SET",    "WHERE name='appicon'"),    appicon_b64)
    L += appends(("api_assets SET",    "WHERE name='manifest'"),   manifest_b64)

    L.append("COMMIT;")
    L.append("")
    L.append("BEGIN")
    L.append("  BEGIN ORDS.DEFINE_TEMPLATE(p_module_name=>'arkia.api',p_pattern=>'app'); EXCEPTION WHEN OTHERS THEN NULL; END;")
    L.append("  BEGIN ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api',p_pattern=>'app',p_method=>'GET',p_source_type=>ORDS.source_type_media,")
    L.append("    p_source=>q'~SELECT 'text/html; charset=utf-8' AS content_type, APEX_WEB_SERVICE.CLOBBASE642BLOB(b64) AS content FROM api_app WHERE id=1~'); EXCEPTION WHEN OTHERS THEN NULL; END;")
    L.append("  BEGIN ORDS.DEFINE_TEMPLATE(p_module_name=>'arkia.api',p_pattern=>'assets/:name'); EXCEPTION WHEN OTHERS THEN NULL; END;")
    L.append("  BEGIN ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api',p_pattern=>'assets/:name',p_method=>'GET',p_source_type=>ORDS.source_type_media,")
    L.append("    p_source=>q'~SELECT mime AS content_type, APEX_WEB_SERVICE.CLOBBASE642BLOB(b64) AS content FROM api_assets WHERE name=:name~'); EXCEPTION WHEN OTHERS THEN NULL; END;")
    L.append("  COMMIT;")
    L.append("END;")
    L.append("/")
    L.append("PROMPT ✔ install_ui.sql — אפליקציה + לוגואים מוגשים מ-ORDS.")
    L.append("")

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write("\n".join(L))
    print("wrote %s  (app=%d B64, arkia=%d, teltos=%d)" % (OUT, len(app_b64), len(arkia_b64), len(teltos_b64)))


if __name__ == '__main__':
    main()
