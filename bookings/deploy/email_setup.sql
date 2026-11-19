--------------------------------------------------------------------------------
-- email_setup.sql — הגדרת שליחת מייל דרך OCI Email Delivery עבור מערכת ההזמנות
--
-- הרצה: כ-ADMIN (Database Actions → SQL, מחוברים כ-ADMIN), פעם אחת.
--
-- לפני ההרצה מלאו 2 ערכים (מתוך OCI → Email Delivery → SMTP Credentials):
--   <SMTP_USERNAME>  — שם המשתמש של אישור ה-SMTP (מחרוזת ארוכה, ocid...@ocid...)
--   <SMTP_PASSWORD>  — הסיסמה של אישור ה-SMTP (מוצגת פעם אחת בעת היצירה)
-- אין להדביק ערכים אלה בצ'אט — רק כאן, בסקריפט שאתם מריצים.
--
-- כתובת השולח (SMTP_FROM) חייבת להיות Approved Sender מאושר ב-OCI.
-- כאן: arkiapnr@gmail.com — ודאו שהיא מופיעה תחת Email Delivery → Approved Senders.
--
-- מבצע: (1) הרשאת רשת יוצאת ל-OCI SMTP  (2) פרמטרי SMTP של מופע ה-APEX.
--------------------------------------------------------------------------------

-- ── (1) הרשאת רשת יוצאת ל-OCI Email Delivery SMTP (לכל סכמות ה-APEX/ARKIA) ──
BEGIN
  FOR s IN (
    SELECT username FROM all_users
    WHERE username LIKE 'APEX\_2%' ESCAPE '\'
       OR username IN ('ARKIA','APEX_PUBLIC_USER','ORDS_PUBLIC_USER','ADMIN')
  ) LOOP
    BEGIN
      DBMS_NETWORK_ACL_ADMIN.APPEND_HOST_ACE(
        host       => 'smtp.email.il-jerusalem-1.oci.oraclecloud.com',
        ace        => xs$ace_type(
                        privilege_list => xs$name_list('connect','resolve'),
                        principal_name => s.username,
                        principal_type => xs_acl.ptype_db));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END;
/

-- ── (2) פרמטרי SMTP של מופע ה-APEX (OCI Email Delivery) ──
BEGIN
  APEX_INSTANCE_ADMIN.SET_PARAMETER('SMTP_HOST_ADDRESS', 'smtp.email.il-jerusalem-1.oci.oraclecloud.com');
  APEX_INSTANCE_ADMIN.SET_PARAMETER('SMTP_HOST_PORT',    '587');           -- STARTTLS (TLS 1.2)
  APEX_INSTANCE_ADMIN.SET_PARAMETER('SMTP_TLS_MODE',     'STARTTLS');
  APEX_INSTANCE_ADMIN.SET_PARAMETER('SMTP_USERNAME',     '<SMTP_USERNAME>');
  APEX_INSTANCE_ADMIN.SET_PARAMETER('SMTP_PASSWORD',     '<SMTP_PASSWORD>');
  APEX_INSTANCE_ADMIN.SET_PARAMETER('SMTP_FROM',         'arkiapnr@gmail.com');  -- Approved Sender
  COMMIT;
END;
/

PROMPT ✔ email_setup.sql — OCI Email Delivery הוגדר. בדקו שליחה עם bookings/deploy/email_test.sql
