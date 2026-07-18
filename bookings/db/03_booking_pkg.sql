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

  g_mail_from CONSTANT VARCHAR2(200) := 'no-reply@arkia.example';  -- לשנות לכתובת השולח בפועל

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
  -- שליחת התראה (פעמון + מייל) למשתמש בודד, בשפת ההעדפה שלו
  --------------------------------------------------------------------------------
  PROCEDURE push (
    p_user_id    IN NUMBER,
    p_status     IN VARCHAR2,
    p_booking_id IN NUMBER,
    p_subj_he IN VARCHAR2, p_subj_en IN VARCHAR2,
    p_msg_he  IN VARCHAR2, p_msg_en  IN VARCHAR2
  ) IS
    l_lang  app_users.pref_lang%TYPE;
    l_email app_users.email%TYPE;
    l_msg   VARCHAR2(1000);
    l_subj  VARCHAR2(200);
    l_dir   VARCHAR2(3);
  BEGIN
    BEGIN
      SELECT pref_lang, email INTO l_lang, l_email
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

    -- מייל (best-effort)
    IF l_email IS NOT NULL THEN
      BEGIN
        APEX_MAIL.SEND(
          p_to        => l_email,
          p_from      => g_mail_from,
          p_subj      => l_subj,
          p_body      => l_msg,
          p_body_html => '<div dir="' || l_dir || '" style="font-family:Heebo,Arial,sans-serif">'
                         || l_msg || '</div>');
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
-- קביעת סיסמאות ברירת מחדל למשתמשי הדמו (לשנות לפני שימוש אמיתי!)
--------------------------------------------------------------------------------
BEGIN
  booking_pkg.set_password('admin',          'Arkia2026!');
  booking_pkg.set_password('initiator_acmi', 'Arkia2026!');
  booking_pkg.set_password('approver_acmi',  'Arkia2026!');
  booking_pkg.set_password('finance',        'Arkia2026!');
  booking_pkg.set_password('teltos',       'Arkia2026!');
  COMMIT;
END;
/

PROMPT ✔ 03_booking_pkg.sql — החבילה הותקנה וסיסמאות ברירת מחדל נקבעו (Arkia2026!).
