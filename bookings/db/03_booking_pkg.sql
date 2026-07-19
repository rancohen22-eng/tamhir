--------------------------------------------------------------------------------
-- מערכת תיעוד הזמנות טיסות (ארקיע)
-- 03_booking_pkg.sql — חבילת ה-workflow המרכזית
--
--   * change_status  — נקודת אמת אחת: עדכון סטטוס + לוג אודיט + התראות פעמון + מייל.
--   * עוטפי מעברים   — send_for_quote / submit_quote / approve / reject /
--                       ticket / request_cancel / confirm_cancel.
--   * אימות          — hash_password / set_password / authenticate (ל-APEX custom auth).
--
-- הצפנת סיסמאות: STANDARD_HASH(SHA-256) עם salt לכל משתמש — ללא תלות ב-DBMS_CRYPTO.
-- מייל: APEX_MAIL.SEND (best-effort; דורש הגדרת APEX Mail + הרצה בהקשר APEX).
--       אם המייל נכשל/לא מוגדר — ההתראה בפעמון עדיין נרשמת.
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE booking_pkg AS

  g_mail_from  CONSTANT VARCHAR2(200) := 'arkiapnr@gmail.com';  -- לשנות לכתובת השולח בפועל
  g_app_url    CONSTANT VARCHAR2(300) := 'https://ga86f4ac04ab998-arkiabkg.adb.il-jerusalem-1.oraclecloudapps.com/ords/arkia/api/app';
  g_assets_url CONSTANT VARCHAR2(300) := 'https://ga86f4ac04ab998-arkiabkg.adb.il-jerusalem-1.oraclecloudapps.com/ords/arkia/api/assets/';

  -- בונה גוף מייל HTML ממותג (ארקיע+טלטוס) עם פרטי ההזמנה וקישור "לחץ כאן".
  -- אם p_approve_url מסופק — מתווסף כפתור "אשר את ההצעה" (אישור ישיר מהמייל).
  FUNCTION booking_email_html (p_booking_id IN NUMBER, p_lang IN VARCHAR2,
                               p_approve_url IN VARCHAR2 DEFAULT NULL) RETURN CLOB;

  -- ── אימות / סיסמאות ──
  FUNCTION  hash_password (p_salt IN VARCHAR2, p_plain IN VARCHAR2) RETURN VARCHAR2;
  PROCEDURE set_password  (p_username IN VARCHAR2, p_plain IN VARCHAR2);
  FUNCTION  authenticate  (p_username IN VARCHAR2, p_password IN VARCHAR2) RETURN BOOLEAN;

  -- ── עזר ──
  FUNCTION current_lang RETURN VARCHAR2;                    -- 'HE'/'EN' משפת הסשן (APP_LANG)
  FUNCTION derive_approver (p_dept_id IN NUMBER) RETURN NUMBER;  -- מאשר ברירת מחדל למחלקה

  -- ── ליבת ה-workflow ──
  PROCEDURE change_status (
    p_booking_id IN NUMBER,
    p_new_status IN VARCHAR2,
    p_actor_id   IN NUMBER,
    p_note       IN VARCHAR2 DEFAULT NULL
  );

  -- ── עוטפי מעברים (לשימוש תהליכי עמוד ב-APEX) ──
  PROCEDURE send_for_quote (p_booking_id IN NUMBER, p_agent_id IN NUMBER, p_actor_id IN NUMBER);
  PROCEDURE submit_quote   (p_booking_id IN NUMBER, p_price IN NUMBER, p_currency IN VARCHAR2,
                            p_trip_details IN CLOB, p_quote_notes IN VARCHAR2, p_actor_id IN NUMBER);
  PROCEDURE approve        (p_booking_id IN NUMBER, p_actor_id IN NUMBER, p_note IN VARCHAR2 DEFAULT NULL);
  PROCEDURE reject         (p_booking_id IN NUMBER, p_actor_id IN NUMBER, p_reason IN VARCHAR2);
  PROCEDURE ticket         (p_booking_id IN NUMBER, p_pnr IN VARCHAR2, p_unique_ref IN VARCHAR2,
                            p_ticketing_date IN DATE, p_actor_id IN NUMBER);
  PROCEDURE request_cancel (p_booking_id IN NUMBER, p_actor_id IN NUMBER, p_reason IN VARCHAR2);
  PROCEDURE confirm_cancel (p_booking_id IN NUMBER, p_actor_id IN NUMBER, p_note IN VARCHAR2 DEFAULT NULL);

END booking_pkg;
/

CREATE OR REPLACE PACKAGE BODY booking_pkg AS

  --------------------------------------------------------------------------------
  -- אימות / סיסמאות
  --------------------------------------------------------------------------------
  FUNCTION hash_password (p_salt IN VARCHAR2, p_plain IN VARCHAR2) RETURN VARCHAR2 IS
    -- STANDARD_HASH הוא אופרטור SQL — חייב להיקרא מתוך SELECT (לא ישירות ב-PL/SQL)
    l_hash VARCHAR2(100);
  BEGIN
    SELECT LOWER(RAWTOHEX(STANDARD_HASH(p_salt || p_plain, 'SHA256'))) INTO l_hash FROM dual;
    RETURN l_hash;
  END hash_password;

  PROCEDURE set_password (p_username IN VARCHAR2, p_plain IN VARCHAR2) IS
    l_salt VARCHAR2(60) := RAWTOHEX(SYS_GUID());
  BEGIN
    UPDATE app_users
       SET password_salt = l_salt,
           password_hash = hash_password(l_salt, p_plain)
     WHERE LOWER(username) = LOWER(p_username);
    IF SQL%ROWCOUNT = 0 THEN
      RAISE_APPLICATION_ERROR(-20001, 'משתמש לא קיים: ' || p_username);
    END IF;
  END set_password;

  FUNCTION authenticate (p_username IN VARCHAR2, p_password IN VARCHAR2) RETURN BOOLEAN IS
    l_hash   app_users.password_hash%TYPE;
    l_salt   app_users.password_salt%TYPE;
    l_active app_users.is_active%TYPE;
  BEGIN
    SELECT password_hash, password_salt, is_active
      INTO l_hash, l_salt, l_active
      FROM app_users
     WHERE LOWER(username) = LOWER(p_username);
    RETURN (l_active = 'Y'
            AND l_hash IS NOT NULL
            AND l_hash = hash_password(l_salt, p_password));
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN FALSE;
  END authenticate;

  --------------------------------------------------------------------------------
  -- עזר
  --------------------------------------------------------------------------------
  FUNCTION current_lang RETURN VARCHAR2 IS
    l VARCHAR2(10);
  BEGIN
    l := V('APP_LANG');
    IF UPPER(l) IN ('EN','HE') THEN RETURN UPPER(l); END IF;
    RETURN 'HE';
  EXCEPTION
    WHEN OTHERS THEN RETURN 'HE';
  END current_lang;

  FUNCTION derive_approver (p_dept_id IN NUMBER) RETURN NUMBER IS
    l_uid NUMBER;
  BEGIN
    SELECT MIN(approver_user_id) INTO l_uid
      FROM dept_approvers WHERE dept_id = p_dept_id;
    RETURN l_uid;
  END derive_approver;

  --------------------------------------------------------------------------------
  -- גוף מייל HTML ממותג עם פרטי ההזמנה + קישור "לחץ כאן"
  --------------------------------------------------------------------------------
  FUNCTION booking_email_html (p_booking_id IN NUMBER, p_lang IN VARCHAR2,
                               p_approve_url IN VARCHAR2 DEFAULT NULL) RETURN CLOB IS
    l_en   BOOLEAN := (UPPER(p_lang) = 'EN');
    l_dir  VARCHAR2(3) := CASE WHEN l_en THEN 'ltr' ELSE 'rtl' END;
    r      bookings%ROWTYPE;
    l_dep  VARCHAR2(120); l_ini VARCHAR2(150); l_agn VARCHAR2(150); l_apr VARCHAR2(150);
    l_st   VARCHAR2(80); l_wo VARCHAR2(80); l_link VARCHAR2(400); l_route VARCHAR2(60);
    l_h    CLOB;
    FUNCTION lbl (p_he VARCHAR2, p_en VARCHAR2) RETURN VARCHAR2 IS BEGIN RETURN CASE WHEN l_en THEN p_en ELSE p_he END; END;
    FUNCTION row_html (p_label VARCHAR2, p_val VARCHAR2) RETURN VARCHAR2 IS BEGIN
      IF p_val IS NULL THEN RETURN ''; END IF;
      RETURN '<tr><td style="color:#5b6b7f;padding:5px 10px;white-space:nowrap;border-bottom:1px solid #eef2f7">'||p_label||
             '</td><td style="padding:5px 10px;font-weight:600;border-bottom:1px solid #eef2f7">'||p_val||'</td></tr>';
    END;
  BEGIN
    SELECT * INTO r FROM bookings WHERE booking_id = p_booking_id;
    BEGIN SELECT CASE WHEN UPPER(p_lang)='EN' THEN name_en ELSE name_he END INTO l_dep FROM departments WHERE dept_id = r.dept_id; EXCEPTION WHEN OTHERS THEN l_dep := NULL; END;
    BEGIN SELECT full_name INTO l_ini FROM app_users WHERE user_id = r.initiator_id; EXCEPTION WHEN OTHERS THEN l_ini := NULL; END;
    BEGIN SELECT agency_name INTO l_agn FROM agents WHERE agent_id = r.agent_id; EXCEPTION WHEN OTHERS THEN l_agn := NULL; END;
    BEGIN SELECT full_name INTO l_apr FROM app_users WHERE user_id = r.approver_id; EXCEPTION WHEN OTHERS THEN l_apr := NULL; END;
    BEGIN SELECT CASE WHEN UPPER(p_lang)='EN' THEN label_en ELSE label_he END INTO l_st FROM statuses WHERE status_code = r.status; EXCEPTION WHEN OTHERS THEN l_st := r.status; END;
    BEGIN SELECT CASE WHEN UPPER(p_lang)='EN' THEN name_en ELSE name_he END INTO l_wo FROM wet_operators WHERE operator_id = r.wet_operator_id; EXCEPTION WHEN OTHERS THEN l_wo := NULL; END;
    IF r.origin_iata IS NOT NULL OR r.dest_iata IS NOT NULL THEN
      l_route := NVL(r.origin_iata,'?') || ' → ' || NVL(r.dest_iata,'?');
    END IF;
    l_link := g_app_url || '#b=' || p_booking_id;

    l_h :=
      '<div dir="'||l_dir||'" style="font-family:Heebo,Arial,sans-serif;background:#f2f5f9;padding:16px">'||
      '<div style="max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">'||
      '<div style="background:#123a86;padding:14px 18px;text-align:center">'||
        '<img src="'||g_assets_url||'arkia" alt="Arkia" height="26" style="vertical-align:middle;background:#fff;border-radius:6px;padding:3px 7px">'||
        '<span style="color:#ffffff;margin:0 10px;font-size:14px">&#10005;</span>'||
        '<img src="'||g_assets_url||'teltos" alt="Teltos" height="26" style="vertical-align:middle;background:#fff;border-radius:6px;padding:3px 7px">'||
      '</div>'||
      '<div style="padding:18px">'||
        '<h2 style="color:#123a86;margin:0 0 8px;font-size:18px">'||lbl('הזמנת טיסות מטלטוס','Flight Booking by Teltos')||
          ' &middot; '||lbl('הזמנה','Booking')||' #'||p_booking_id||'</h2>'||
        '<span style="display:inline-block;background:#e8eff7;color:#123a86;border-radius:999px;padding:3px 12px;font-size:13px;font-weight:700">'||l_st||'</span>'||
        '<table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:14px">'||
          row_html(lbl('מחלקה','Department'), l_dep)||
          row_html(lbl('נתיב','Route'), l_route)||
          row_html(lbl('מספר נוסעים','Passengers'), TO_CHAR(r.pax_count))||
          row_html(lbl('תאריך יציאה','Departure'), TO_CHAR(r.departure_date,'DD/MM/YYYY'))||
          row_html(lbl('שעה מועדפת','Preferred time'), r.pref_time)||
          row_html(lbl('מפעיל רטוב','Wet operator'), l_wo)||
          row_html(lbl('מזמין','Initiator'), l_ini)||
          row_html(lbl('סוכן','Agent'), l_agn)||
          row_html(lbl('מאשר','Approver'), l_apr)||
          row_html(lbl('מחיר','Price'), CASE WHEN r.price IS NOT NULL THEN TO_CHAR(r.price)||' '||r.currency_code END)||
          row_html('PNR', r.pnr)||
          row_html(lbl('תאריך כרטוס','Ticketing date'), TO_CHAR(r.ticketing_date,'DD/MM/YYYY'))||
          row_html(lbl('הערות','Notes'), r.quote_notes)||
        '</table>'||
        '<div style="text-align:center;margin-top:20px">'||
          CASE WHEN p_approve_url IS NOT NULL THEN
            '<a href="'||p_approve_url||'" style="display:inline-block;background:#0e7a4e;color:#fff;text-decoration:none;padding:12px 26px;border-radius:9px;font-weight:800;font-size:15px;margin:0 6px 10px">'||
            lbl('✔ אשר את ההצעה','✔ Approve the quote')||'</a>' ELSE '' END||
          '<a href="'||l_link||'" style="display:inline-block;background:'||CASE WHEN p_approve_url IS NOT NULL THEN '#123a86' ELSE '#0e7a4e' END||';color:#fff;text-decoration:none;padding:12px 26px;border-radius:9px;font-weight:700;font-size:15px;margin:0 6px 10px">'||
          lbl('לצפייה בהזמנה','View the booking')||'</a>'||
        '</div>'||
      '</div>'||
      '<div style="background:#f7fafc;padding:10px 18px;color:#5b6b7f;font-size:11px;text-align:center">'||
        lbl('הזמנת טיסות מטלטוס','Flight Booking by Teltos')||' &middot; '||lbl('ארקיע','Arkia')||'</div>'||
      '</div></div>';
    RETURN l_h;
  EXCEPTION WHEN OTHERS THEN
    RETURN '<div>'||lbl('הזמנה','Booking')||' #'||p_booking_id||' &middot; <a href="'||g_app_url||'#b='||p_booking_id||'">'||
           lbl('לחץ כאן','Click here')||'</a></div>';
  END booking_email_html;

  --------------------------------------------------------------------------------
  -- שליחת התראה (פעמון + מייל) למשתמש בודד, בשפת ההעדפה שלו
  --------------------------------------------------------------------------------
  PROCEDURE push (
    p_user_id    IN NUMBER,
    p_status     IN VARCHAR2,
    p_booking_id IN NUMBER,
    p_subj_he IN VARCHAR2, p_subj_en IN VARCHAR2,
    p_msg_he  IN VARCHAR2, p_msg_en  IN VARCHAR2
  ) IS
    l_lang    app_users.pref_lang%TYPE;
    l_email   app_users.email%TYPE;
    l_notify  VARCHAR2(1);
    l_msg     VARCHAR2(1000);
    l_subj    VARCHAR2(200);
    l_dir     VARCHAR2(3);
    l_mail_id NUMBER;
  BEGIN
    BEGIN
      SELECT pref_lang, email, NVL(notify_email,'Y') INTO l_lang, l_email, l_notify
        FROM app_users WHERE user_id = p_user_id AND is_active = 'Y';
    EXCEPTION
      WHEN NO_DATA_FOUND THEN RETURN;   -- נמען לא פעיל/לא קיים — דילוג
    END;

    IF l_lang = 'EN' THEN
      l_msg := p_msg_en; l_subj := p_subj_en; l_dir := 'ltr';
    ELSE
      l_msg := p_msg_he; l_subj := p_subj_he; l_dir := 'rtl';
    END IF;
    l_msg  := REPLACE(l_msg,  '%ID%', TO_CHAR(p_booking_id));
    l_subj := REPLACE(l_subj, '%ID%', TO_CHAR(p_booking_id));

    -- פעמון בתוך המערכת
    INSERT INTO notifications (user_id, booking_id, notif_type, message)
    VALUES (p_user_id, p_booking_id, p_status, l_msg);

    -- מייל (best-effort). עובד גם מהקשר ORDS (לא רק מתוך APEX):
    -- קובעים security group של ה-Workspace לפני APEX_MAIL, ודוחפים את התור מיד.
    -- מכובד אם המשתמש כיבה התראות מייל (notify_email='N') — הפעמון עדיין נרשם.
    IF l_email IS NOT NULL AND l_notify = 'Y' THEN
      BEGIN
        BEGIN
          APEX_UTIL.SET_SECURITY_GROUP_ID(APEX_UTIL.FIND_SECURITY_GROUP_ID('ARKIA'));
        EXCEPTION WHEN OTHERS THEN NULL; END;
        -- p_body ו-p_body_html חייבים להיות מאותו טיפוס (CLOB) כדי למנוע PLS-00307
        -- (APEX_MAIL.SEND עמוס-הגדרות ל-VARCHAR2/CLOB). צורת הפונקציה מחזירה mail_id
        -- כדי לצרף את קבצי ההזמנה (צילום ההצעה / מסמך הכרטוס).
        l_mail_id := APEX_MAIL.SEND(
          p_to        => l_email,
          p_from      => g_mail_from,
          p_subj      => l_subj,
          p_body      => TO_CLOB(l_msg || CHR(10) || g_app_url || '#b=' || p_booking_id),
          p_body_html => booking_email_html(p_booking_id, l_lang));
        FOR f IN (SELECT filename, mime_type, file_blob FROM booking_files WHERE booking_id = p_booking_id) LOOP
          BEGIN
            APEX_MAIL.ADD_ATTACHMENT(p_mail_id => l_mail_id, p_attachment => f.file_blob,
              p_filename => f.filename, p_mime_type => NVL(f.mime_type,'application/octet-stream'));
          EXCEPTION WHEN OTHERS THEN NULL; END;
        END LOOP;
        BEGIN APEX_MAIL.PUSH_QUEUE; EXCEPTION WHEN OTHERS THEN NULL; END;
      EXCEPTION
        WHEN OTHERS THEN NULL;  -- מייל לא מוגדר/נכשל — הפעמון כבר נרשם
      END;
    END IF;
  END push;

  --------------------------------------------------------------------------------
  -- ליבת ה-workflow
  --------------------------------------------------------------------------------
  PROCEDURE change_status (
    p_booking_id IN NUMBER,
    p_new_status IN VARCHAR2,
    p_actor_id   IN NUMBER,
    p_note       IN VARCHAR2 DEFAULT NULL
  ) IS
    l_row bookings%ROWTYPE;
    l_old bookings.status%TYPE;
  BEGIN
    SELECT * INTO l_row FROM bookings WHERE booking_id = p_booking_id FOR UPDATE;
    l_old := l_row.status;

    UPDATE bookings
       SET status = p_new_status, updated_at = SYSTIMESTAMP
     WHERE booking_id = p_booking_id;

    -- לוג אודיט: מי / מתי / ממה-למה
    INSERT INTO booking_status_log (booking_id, from_status, to_status, action_by, note)
    VALUES (p_booking_id, l_old, p_new_status, p_actor_id, p_note);

    -- התראות לפי תבניות הסטטוס החדש (לכל תפקיד נמען)
    FOR t IN (SELECT * FROM notif_templates WHERE status_code = p_new_status) LOOP
      IF t.recipient_role = 'AGENT' THEN
        FOR u IN (SELECT user_id FROM agents WHERE agent_id = l_row.agent_id) LOOP
          push(u.user_id, p_new_status, p_booking_id, t.subject_he, t.subject_en, t.msg_he, t.msg_en);
        END LOOP;

      ELSIF t.recipient_role = 'INITIATOR' THEN
        IF l_row.initiator_id IS NOT NULL THEN
          push(l_row.initiator_id, p_new_status, p_booking_id, t.subject_he, t.subject_en, t.msg_he, t.msg_en);
        END IF;

      ELSIF t.recipient_role = 'APPROVER' THEN
        IF l_row.approver_id IS NOT NULL THEN
          push(l_row.approver_id, p_new_status, p_booking_id, t.subject_he, t.subject_en, t.msg_he, t.msg_en);
        ELSE
          FOR u IN (SELECT approver_user_id AS uid FROM dept_approvers WHERE dept_id = l_row.dept_id) LOOP
            push(u.uid, p_new_status, p_booking_id, t.subject_he, t.subject_en, t.msg_he, t.msg_en);
          END LOOP;
        END IF;
      END IF;
    END LOOP;
  END change_status;

  --------------------------------------------------------------------------------
  -- עוטפי מעברים
  --------------------------------------------------------------------------------
  -- ייזום → הפניה לסוכן (הגדרת סוכן + מאשר אוטומטי)
  PROCEDURE send_for_quote (p_booking_id IN NUMBER, p_agent_id IN NUMBER, p_actor_id IN NUMBER) IS
    l_dept bookings.dept_id%TYPE;
  BEGIN
    SELECT dept_id INTO l_dept FROM bookings WHERE booking_id = p_booking_id;
    UPDATE bookings
       SET agent_id    = p_agent_id,
           approver_id = NVL(approver_id, derive_approver(l_dept))
     WHERE booking_id  = p_booking_id;
    change_status(p_booking_id, 'AWAITING_QUOTE', p_actor_id);
  END send_for_quote;

  -- סוכן מגיש הצעת מחיר (הצילום מועלה בנפרד ל-booking_files)
  PROCEDURE submit_quote (p_booking_id IN NUMBER, p_price IN NUMBER, p_currency IN VARCHAR2,
                          p_trip_details IN CLOB, p_quote_notes IN VARCHAR2, p_actor_id IN NUMBER) IS
  BEGIN
    UPDATE bookings
       SET price         = p_price,
           currency_code = NVL(p_currency, currency_code),
           trip_details  = p_trip_details,
           quote_notes   = p_quote_notes
     WHERE booking_id = p_booking_id;
    change_status(p_booking_id, 'QUOTE_RECEIVED', p_actor_id);
  END submit_quote;

  PROCEDURE approve (p_booking_id IN NUMBER, p_actor_id IN NUMBER, p_note IN VARCHAR2 DEFAULT NULL) IS
  BEGIN
    change_status(p_booking_id, 'APPROVED', p_actor_id, p_note);
  END approve;

  PROCEDURE reject (p_booking_id IN NUMBER, p_actor_id IN NUMBER, p_reason IN VARCHAR2) IS
  BEGIN
    UPDATE bookings SET rejection_reason = p_reason WHERE booking_id = p_booking_id;
    change_status(p_booking_id, 'REJECTED', p_actor_id, p_reason);
  END reject;

  -- סוכן מכרטס: מזהה חד-ערכי + PNR + תאריך כרטוס (מסמך הכרטוס מועלה ל-booking_files)
  PROCEDURE ticket (p_booking_id IN NUMBER, p_pnr IN VARCHAR2, p_unique_ref IN VARCHAR2,
                    p_ticketing_date IN DATE, p_actor_id IN NUMBER) IS
  BEGIN
    UPDATE bookings
       SET pnr                = p_pnr,
           unique_booking_ref = p_unique_ref,
           ticketing_date     = NVL(p_ticketing_date, TRUNC(SYSDATE))
     WHERE booking_id = p_booking_id;
    change_status(p_booking_id, 'TICKETED', p_actor_id);
  END ticket;

  -- בקשת ביטול (יוזם/מאשר) — שלב 1
  PROCEDURE request_cancel (p_booking_id IN NUMBER, p_actor_id IN NUMBER, p_reason IN VARCHAR2) IS
  BEGIN
    UPDATE bookings
       SET cancel_reason       = p_reason,
           cancel_requested_by = p_actor_id,
           cancel_requested_at = SYSTIMESTAMP
     WHERE booking_id = p_booking_id;
    change_status(p_booking_id, 'CANCEL_REQUESTED', p_actor_id, p_reason);
  END request_cancel;

  -- אישור ביטול ע"י הסוכן — שלב 2
  PROCEDURE confirm_cancel (p_booking_id IN NUMBER, p_actor_id IN NUMBER, p_note IN VARCHAR2 DEFAULT NULL) IS
  BEGIN
    change_status(p_booking_id, 'CANCELLED', p_actor_id, p_note);
  END confirm_cancel;

END booking_pkg;
/

SHOW ERRORS

--------------------------------------------------------------------------------
-- קביעת סיסמת ברירת מחדל למשתמשי הדמו — רק אם עדיין אין להם סיסמה.
-- (בטוח להרצה חוזרת ב-CI: לא דורס סיסמאות שכבר נקבעו/שונו.)
--------------------------------------------------------------------------------
BEGIN
  FOR u IN (SELECT username FROM app_users
             WHERE username IN ('admin','initiator_acmi','approver_acmi','finance','teltos')
               AND password_hash IS NULL) LOOP
    booking_pkg.set_password(u.username, 'Arkia2026!');
  END LOOP;
  COMMIT;
END;
/

PROMPT ✔ 03_booking_pkg.sql — החבילה הותקנה וסיסמאות ברירת מחדל נקבעו (Arkia2026!).
