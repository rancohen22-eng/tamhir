--------------------------------------------------------------------------------
-- מערכת תיעוד הזמנות טיסות (ארקיע)
-- 02_seed.sql — נתוני יסוד (ייחוס + משתמשי דמו + סוכן טלטוס)
--
-- נטען אחרי 01_tables.sql. הסיסמאות למשתמשים נקבעות ב-03_booking_pkg.sql
-- (בלוק שמריץ BOOKING_PKG.set_password לאחר קומפילציית החבילה).
-- אין להזין כאן IDs מפורשים — ה-identity מקצה, וה-FKs מתייחסים לפי code/username.
--------------------------------------------------------------------------------

-- ── תפקידים ──
INSERT INTO roles (role_code, name_he, name_en) VALUES ('ADMIN',     'מנהל מערכת',  'Administrator');
INSERT INTO roles (role_code, name_he, name_en) VALUES ('INITIATOR', 'מזמין',       'Initiator');
INSERT INTO roles (role_code, name_he, name_en) VALUES ('APPROVER',  'גורם מאשר',   'Approver');
INSERT INTO roles (role_code, name_he, name_en) VALUES ('AGENT',     'סוכן נסיעות', 'Travel Agent');
INSERT INTO roles (role_code, name_he, name_en) VALUES ('FINANCE',   'כספים',       'Finance');

-- ── מטבעות (USD = ברירת מחדל) ──
INSERT INTO currencies (code, name_he, name_en, symbol, is_default) VALUES ('USD', 'דולר אמריקאי', 'US Dollar', '$',  'Y');
INSERT INTO currencies (code, name_he, name_en, symbol, is_default) VALUES ('EUR', 'אירו',         'Euro',      '€',  'N');
INSERT INTO currencies (code, name_he, name_en, symbol, is_default) VALUES ('ILS', 'שקל חדש',      'Israeli Shekel', '₪', 'N');
INSERT INTO currencies (code, name_he, name_en, symbol, is_default) VALUES ('GBP', 'לירה שטרלינג', 'British Pound',  '£', 'N');

-- ── סטטוסים (דו-לשוני) ──
INSERT INTO statuses (status_code, label_he, label_en, sort_order, is_terminal) VALUES ('NEW',              'נפתחה',            'New',              0,  'N');
INSERT INTO statuses (status_code, label_he, label_en, sort_order, is_terminal) VALUES ('AWAITING_QUOTE',   'ממתין להצעת מחיר', 'Awaiting Quote',   10, 'N');
INSERT INTO statuses (status_code, label_he, label_en, sort_order, is_terminal) VALUES ('QUOTE_RECEIVED',   'הצעה התקבלה',      'Quote Received',   20, 'N');
INSERT INTO statuses (status_code, label_he, label_en, sort_order, is_terminal) VALUES ('APPROVED',         'אושר',             'Approved',         30, 'N');
INSERT INTO statuses (status_code, label_he, label_en, sort_order, is_terminal) VALUES ('TICKETED',         'כורטס',            'Ticketed',         40, 'Y');
INSERT INTO statuses (status_code, label_he, label_en, sort_order, is_terminal) VALUES ('CANCEL_REQUESTED', 'בקשת ביטול',       'Cancel Requested', 50, 'N');
INSERT INTO statuses (status_code, label_he, label_en, sort_order, is_terminal) VALUES ('REJECTED',         'נדחה',             'Rejected',         90, 'Y');
INSERT INTO statuses (status_code, label_he, label_en, sort_order, is_terminal) VALUES ('CANCELLED',        'בוטל',             'Cancelled',        99, 'Y');

-- ── תבניות התראה דו-לשוניות (סטטוס × תפקיד נמען) ──
INSERT INTO notif_templates (status_code, recipient_role, subject_he, subject_en, msg_he, msg_en) VALUES
 ('AWAITING_QUOTE','AGENT',
  'בקשה חדשה להצעת מחיר', 'New quote request',
  'התקבלה בקשה חדשה להצעת מחיר עבור הזמנה #%ID%.', 'A new quote request was received for booking #%ID%.');
INSERT INTO notif_templates (status_code, recipient_role, subject_he, subject_en, msg_he, msg_en) VALUES
 ('QUOTE_RECEIVED','INITIATOR',
  'התקבלה הצעה מהסוכן', 'Quote received from agent',
  'הסוכן הגיש הצעת מחיר עבור הזמנה #%ID%.', 'The agent submitted a quote for booking #%ID%.');
INSERT INTO notif_templates (status_code, recipient_role, subject_he, subject_en, msg_he, msg_en) VALUES
 ('APPROVED','AGENT',
  'אישור לכרטוס', 'Approved for ticketing',
  'הזמנה #%ID% אושרה — ניתן לכרטס.', 'Booking #%ID% was approved — you may issue the ticket.');
INSERT INTO notif_templates (status_code, recipient_role, subject_he, subject_en, msg_he, msg_en) VALUES
 ('APPROVED','INITIATOR',
  'ההזמנה אושרה', 'Booking approved',
  'הזמנה #%ID% אושרה ע"י הגורם המאשר.', 'Booking #%ID% was approved by the approver.');
INSERT INTO notif_templates (status_code, recipient_role, subject_he, subject_en, msg_he, msg_en) VALUES
 ('TICKETED','INITIATOR',
  'ההזמנה כורטסה', 'Booking ticketed',
  'הזמנה #%ID% כורטסה. מסמך הכרטוס זמין לצפייה.', 'Booking #%ID% was ticketed. The ticket document is available.');
INSERT INTO notif_templates (status_code, recipient_role, subject_he, subject_en, msg_he, msg_en) VALUES
 ('TICKETED','APPROVER',
  'ההזמנה כורטסה', 'Booking ticketed',
  'הזמנה #%ID% כורטסה.', 'Booking #%ID% was ticketed.');
INSERT INTO notif_templates (status_code, recipient_role, subject_he, subject_en, msg_he, msg_en) VALUES
 ('REJECTED','INITIATOR',
  'ההזמנה נדחתה', 'Booking rejected',
  'הזמנה #%ID% נדחתה ע"י הגורם המאשר.', 'Booking #%ID% was rejected by the approver.');
INSERT INTO notif_templates (status_code, recipient_role, subject_he, subject_en, msg_he, msg_en) VALUES
 ('REJECTED','AGENT',
  'ההזמנה נדחתה', 'Booking rejected',
  'הזמנה #%ID% נדחתה.', 'Booking #%ID% was rejected.');
INSERT INTO notif_templates (status_code, recipient_role, subject_he, subject_en, msg_he, msg_en) VALUES
 ('CANCEL_REQUESTED','AGENT',
  'התקבלה בקשת ביטול', 'Cancellation requested',
  'התקבלה בקשת ביטול עבור הזמנה #%ID% — נדרש אישורך.', 'A cancellation was requested for booking #%ID% — your confirmation is required.');
INSERT INTO notif_templates (status_code, recipient_role, subject_he, subject_en, msg_he, msg_en) VALUES
 ('CANCEL_REQUESTED','APPROVER',
  'התקבלה בקשת ביטול', 'Cancellation requested',
  'הוגשה בקשת ביטול עבור הזמנה #%ID%.', 'A cancellation was requested for booking #%ID%.');
INSERT INTO notif_templates (status_code, recipient_role, subject_he, subject_en, msg_he, msg_en) VALUES
 ('CANCELLED','INITIATOR',
  'הביטול אושר ע"י הסוכן', 'Cancellation confirmed by agent',
  'ביטול הזמנה #%ID% אושר ע"י הסוכן.', 'Cancellation of booking #%ID% was confirmed by the agent.');
INSERT INTO notif_templates (status_code, recipient_role, subject_he, subject_en, msg_he, msg_en) VALUES
 ('CANCELLED','APPROVER',
  'הביטול אושר ע"י הסוכן', 'Cancellation confirmed by agent',
  'ביטול הזמנה #%ID% אושר ע"י הסוכן.', 'Cancellation of booking #%ID% was confirmed by the agent.');

-- ── מחלקות (הרשימה ניתנת לשינוי ע"י מנהל המערכת) ──
INSERT INTO departments (dept_code, name_he, name_en) VALUES ('ACMI',      'ACMI',      'ACMI');
INSERT INTO departments (dept_code, name_he, name_en) VALUES ('INTERLINE', 'אינטרליין', 'Interline');
INSERT INTO departments (dept_code, name_he, name_en) VALUES ('COMMERCE',  'מסחר',      'Commerce');
INSERT INTO departments (dept_code, name_he, name_en) VALUES ('AGENTS',    'סוכנים',    'Agents');

--------------------------------------------------------------------------------
-- משתמשי דמו (להחליף/להוסיף במסך הניהול). סיסמאות נקבעות ב-03_booking_pkg.sql.
--------------------------------------------------------------------------------
-- מנהל מערכת
INSERT INTO app_users (username, full_name, email, dept_id, pref_lang)
VALUES ('admin', 'מנהל מערכת', 'admin@arkia.example', NULL, 'HE');

-- מזמין ומאשר במחלקת ACMI (לבדיקת קצה-לקצה)
INSERT INTO app_users (username, full_name, email, dept_id, pref_lang)
VALUES ('initiator_acmi', 'יוזם ACMI', 'initiator.acmi@arkia.example',
        (SELECT dept_id FROM departments WHERE dept_code='ACMI'), 'HE');

INSERT INTO app_users (username, full_name, email, dept_id, pref_lang)
VALUES ('approver_acmi', 'מאשר ACMI', 'approver.acmi@arkia.example',
        (SELECT dept_id FROM departments WHERE dept_code='ACMI'), 'HE');

-- משתמש כספים
INSERT INTO app_users (username, full_name, email, dept_id, pref_lang)
VALUES ('finance', 'משתמש כספים', 'finance@arkia.example', NULL, 'HE');

-- משתמש הסוכן (טלטוס)
INSERT INTO app_users (username, full_name, email, dept_id, pref_lang)
VALUES ('teltos', 'טלטוס - סוכן נסיעות', 'agent@teltos.example',
        (SELECT dept_id FROM departments WHERE dept_code='AGENTS'), 'HE');

-- ── תפקידים למשתמשים ──
INSERT INTO user_roles (user_id, role_code) SELECT user_id, 'ADMIN'     FROM app_users WHERE username='admin';
INSERT INTO user_roles (user_id, role_code) SELECT user_id, 'INITIATOR' FROM app_users WHERE username='initiator_acmi';
INSERT INTO user_roles (user_id, role_code) SELECT user_id, 'APPROVER'  FROM app_users WHERE username='approver_acmi';
INSERT INTO user_roles (user_id, role_code) SELECT user_id, 'FINANCE'   FROM app_users WHERE username='finance';
INSERT INTO user_roles (user_id, role_code) SELECT user_id, 'AGENT'     FROM app_users WHERE username='teltos';

-- ── גורם מאשר למחלקת ACMI ──
INSERT INTO dept_approvers (dept_id, approver_user_id)
SELECT (SELECT dept_id FROM departments WHERE dept_code='ACMI'),
       (SELECT user_id FROM app_users WHERE username='approver_acmi')
FROM dual;

-- ── סוכן טלטוס (הלוגו נטען בנפרד — ראו BUILD_GUIDE / bookings/assets) ──
INSERT INTO agents (user_id, agency_name, contact_email, contact_phone)
SELECT user_id, 'טלטוס - מנועי חיפוש טיסות', 'agent@teltos.example', '000-0000000'
FROM app_users WHERE username='teltos';

COMMIT;

PROMPT ✔ 02_seed.sql — נתוני היסוד נטענו בהצלחה.
