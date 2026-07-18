--------------------------------------------------------------------------------
-- email_setup.sql — הגדרת שליחת מייל (Gmail SMTP) עבור מערכת ההזמנות
--
-- הרצה: כ-ADMIN (Database Actions → SQL, מחוברים כ-ADMIN), פעם אחת.
-- לפני ההרצה: החליפו  <APP_PASSWORD>  ב-App Password של arkiapnr@gmail.com
--             (16 תווים; בלי רווחים). ראו ההסבר על יצירת App Password.
--
-- מבצע: (1) הרשאת רשת ל-DB → smtp.gmail.com:587  (2) פרמטרי SMTP של APEX.
--------------------------------------------------------------------------------

-- ── (1) הרשאת רשת יוצאת ל-Gmail SMTP (לכל סכמות ה-APEX/ARKIA הרלוונטיות) ──
BEGIN
  FOR s IN (
    SELECT username FROM all_users
    WHERE username LIKE 'APEX\_2%' ESCAPE '\'
       OR username IN ('ARKIA','APEX_PUBLIC_USER','ORDS_PUBLIC_USER','ADMIN')
  ) LOOP
    BEGIN
      DBMS_NETWORK_ACL_ADMIN.APPEND_HOST_ACE(
        host       => 'smtp.gmail.com',
        ace        => xs$ace_type(
                        privilege_list => xs$name_list('connect','resolve'),
                        principal_name => s.username,
                        principal_type => xs_acl.ptype_db));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END;
/

-- ── (2) פרמטרי SMTP של מופע ה-APEX ──
BEGIN
  APEX_INSTANCE_ADMIN.SET_PARAMETER('SMTP_HOST_ADDRESS', 'smtp.gmail.com');
  APEX_INSTANCE_ADMIN.SET_PARAMETER('SMTP_HOST_PORT',    '587');
  APEX_INSTANCE_ADMIN.SET_PARAMETER('SMTP_TLS_MODE',     'STARTTLS');
  APEX_INSTANCE_ADMIN.SET_PARAMETER('SMTP_USERNAME',     'arkiapnr@gmail.com');
  APEX_INSTANCE_ADMIN.SET_PARAMETER('SMTP_PASSWORD',     '<APP_PASSWORD>');
  APEX_INSTANCE_ADMIN.SET_PARAMETER('SMTP_FROM',         'arkiapnr@gmail.com');
  COMMIT;
END;
/

PROMPT ✔ email_setup.sql — SMTP הוגדר. בדקו שליחה עם bookings/deploy/email_test.sql
