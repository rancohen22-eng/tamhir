--------------------------------------------------------------------------------
-- email_test.sql — בדיקת שליחת מייל. הרצה כ-ARKIA (Database Actions → SQL).
-- החליפו <YOUR_EMAIL> בכתובת שאליה תרצו לקבל את הבדיקה.
--------------------------------------------------------------------------------
BEGIN
  APEX_UTIL.SET_SECURITY_GROUP_ID(APEX_UTIL.FIND_SECURITY_GROUP_ID('ARKIA'));
  APEX_MAIL.SEND(
    p_to   => '<YOUR_EMAIL>',
    p_from => 'arkiapnr@gmail.com',
    p_subj => 'Arkia bookings — בדיקת מייל',
    p_body => 'בדיקת שליחת מייל ממערכת תיעוד ההזמנות. אם קיבלת — ההגדרה עובדת.');
  APEX_MAIL.PUSH_QUEUE;
  COMMIT;
END;
/
-- בדיקת סטטוס: אם mail_send_error ריק והשורה נעלמה מהתור — נשלח.
PROMPT --- תור המיילים (ריק = נשלח בהצלחה) ---
SELECT mail_id, mail_to, mail_send_error FROM apex_mail_queue;
PROMPT --- לוג מיילים אחרונים ---
SELECT mail_to, mail_subject, sent_on FROM apex_mail_log ORDER BY sent_on DESC FETCH FIRST 5 ROWS ONLY;
