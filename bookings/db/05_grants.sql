--------------------------------------------------------------------------------
-- מערכת תיעוד הזמנות טיסות (ארקיע)
-- 05_grants.sql — הרשאות והערות פריסה
--
-- ברוב המקרים אין צורך בהרשאות נוספות: אפליקציית APEX רצה באותה סכמת parsing
-- שבה הותקנו הטבלאות/החבילה, ולכן היא ניגשת אליהן ישירות.
-- הקובץ מרכז את המקרים החריגים — הפעילו רק את מה שרלוונטי לסביבה שלכם.
--------------------------------------------------------------------------------

-- 1) STANDARD_HASH ו-SYS_GUID (לאימות) — פונקציות SQL מובנות, ללא צורך ב-GRANT.

-- 2) APEX_MAIL — זמין לאפליקציות APEX כברירת מחדל. ההגדרה עצמה (SMTP host/port,
--    כתובת שולח מאושרת) נעשית ב-Instance Admin / OCI Email Delivery. ראו BUILD_GUIDE.

-- 3) אם אפליקציית ה-APEX או ORDS ניגשים מסכמה אחרת (למשל APEX_PUBLIC_USER
--    או parsing schema שונה), הריצו את ההרשאות הבאות מסכמת הבעלים.
--    החליפו &APP_SCHEMA בשם הסכמה של האפליקציה:
/*
GRANT SELECT, INSERT, UPDATE, DELETE ON departments        TO &APP_SCHEMA;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_users          TO &APP_SCHEMA;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_roles         TO &APP_SCHEMA;
GRANT SELECT, INSERT, UPDATE, DELETE ON dept_approvers     TO &APP_SCHEMA;
GRANT SELECT, INSERT, UPDATE, DELETE ON agents             TO &APP_SCHEMA;
GRANT SELECT                          ON roles             TO &APP_SCHEMA;
GRANT SELECT                          ON statuses          TO &APP_SCHEMA;
GRANT SELECT                          ON currencies        TO &APP_SCHEMA;
GRANT SELECT                          ON notif_templates   TO &APP_SCHEMA;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings           TO &APP_SCHEMA;
GRANT SELECT, INSERT, UPDATE, DELETE ON booking_files      TO &APP_SCHEMA;
GRANT SELECT, INSERT                 ON booking_status_log TO &APP_SCHEMA;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications      TO &APP_SCHEMA;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_templates   TO &APP_SCHEMA;
GRANT SELECT                          ON v_bookings         TO &APP_SCHEMA;
GRANT SELECT                          ON v_booking_timeline TO &APP_SCHEMA;
GRANT SELECT                          ON v_finance_summary  TO &APP_SCHEMA;
GRANT EXECUTE                         ON booking_pkg        TO &APP_SCHEMA;
*/

-- 4) (אופציונלי) חשיפת בסיס-הנתונים כ-REST דרך ORDS — רק אם רוצים API חיצוני
--    בנוסף לאפליקציית APEX. להריץ מסכמת הבעלים:
/*
BEGIN
  ORDS.ENABLE_SCHEMA(
    p_enabled             => TRUE,
    p_schema              => USER,
    p_url_mapping_type    => 'BASE_PATH',
    p_url_mapping_pattern => 'bookings',
    p_auto_rest_auth      => TRUE);
  COMMIT;
END;
/
*/

PROMPT ✔ 05_grants.sql — עיינו בהערות והריצו רק את הרלוונטי לסביבה.
