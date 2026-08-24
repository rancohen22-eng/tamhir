--------------------------------------------------------------------------------
-- email_sample.sql — שולח מייל דוגמה ממותג (ארקיע+טלטוס) של ההזמנה האחרונה
-- לכתובת ranc@arkia.co.il. הרצה כ-ARKIA (Database Actions → SQL), Run Script.
-- דורש: OCI Email Delivery מוגדר (deploy/email_setup.sql) + booking_pkg מותקן.
--------------------------------------------------------------------------------
DECLARE
  l_id NUMBER;
BEGIN
  SELECT MAX(booking_id) INTO l_id FROM bookings;   -- ההזמנה האחרונה (אם קיימת)
  BEGIN APEX_UTIL.SET_SECURITY_GROUP_ID(APEX_UTIL.FIND_SECURITY_GROUP_ID('ARKIA')); EXCEPTION WHEN OTHERS THEN NULL; END;
  APEX_MAIL.SEND(
    p_to        => 'ranc@arkia.co.il',
    p_from      => 'arkiapnr@gmail.com',
    p_subj      => 'הזמנת טיסות מטלטוס — מייל דוגמה',
    p_body      => TO_CLOB('דוגמת מייל ממערכת הזמנת הטיסות. אם אינך רואה עיצוב — אפשר להציג תמונות/HTML.'),
    p_body_html => booking_pkg.booking_email_html(NVL(l_id, 1), 'HE'));
  APEX_MAIL.PUSH_QUEUE;
  COMMIT;
END;
/
PROMPT --- תור המיילים (ריק = נשלח) ---
SELECT mail_id, mail_to, mail_send_error FROM apex_mail_queue;
