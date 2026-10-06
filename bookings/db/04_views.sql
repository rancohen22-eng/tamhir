--------------------------------------------------------------------------------
-- מערכת תיעוד הזמנות טיסות (ארקיע)
-- 04_views.sql — Views לדוחות, לדשבורד הכספים ולציר-הזמן
--
-- תוויות הסטטוס/המחלקה נבחרות לפי שפת הסשן (booking_pkg.current_lang):
-- HE → עברית, EN → אנגלית. כך אותו Report מוצג דו-לשונית ללא שכפול.
--------------------------------------------------------------------------------

-- תצוגת הזמנות מועשרת — הבסיס להזמנות המחלקה, למסך הסוכן ולדשבורד הכספים
CREATE OR REPLACE VIEW v_bookings AS
SELECT
  b.booking_id,
  b.status                                   AS status_code,
  CASE booking_pkg.current_lang WHEN 'EN' THEN st.label_en ELSE st.label_he END AS status_label,
  st.is_terminal,
  b.dept_id,
  CASE booking_pkg.current_lang WHEN 'EN' THEN NVL(d.name_en, d.name_he) ELSE d.name_he END AS dept_name,
  b.open_date,
  b.departure_date,
  b.ticketing_date,
  b.price,
  b.currency_code,
  cur.symbol                                 AS currency_symbol,
  b.pnr,
  b.unique_booking_ref,
  b.initiator_id,
  ini.full_name                              AS initiator_name,
  b.agent_id,
  ag.agency_name                             AS agency_name,
  b.approver_id,
  apr.full_name                              AS approver_name,
  b.quote_notes,
  b.trip_details,
  b.rejection_reason,
  b.cancel_reason,
  b.cancel_requested_at,
  b.created_at,
  b.updated_at,
  (SELECT COUNT(*) FROM booking_files f WHERE f.booking_id = b.booking_id AND f.file_kind = 'QUOTE_SCREENSHOT') AS has_quote_file,
  (SELECT COUNT(*) FROM booking_files f WHERE f.booking_id = b.booking_id AND f.file_kind = 'FINAL_TICKET')     AS has_ticket_file
FROM bookings b
JOIN statuses    st  ON st.status_code   = b.status
JOIN departments d   ON d.dept_id        = b.dept_id
JOIN currencies  cur ON cur.code         = b.currency_code
JOIN app_users   ini ON ini.user_id      = b.initiator_id
LEFT JOIN agents    ag  ON ag.agent_id    = b.agent_id
LEFT JOIN app_users apr ON apr.user_id    = b.approver_id;

-- ציר-זמן הסטטוסים של הזמנה: מי ביצע, מתי, ממה למה (למסך הפירוט)
CREATE OR REPLACE VIEW v_booking_timeline AS
SELECT
  l.log_id,
  l.booking_id,
  l.action_at,
  u.full_name AS action_by_name,
  l.from_status,
  CASE booking_pkg.current_lang WHEN 'EN' THEN sf.label_en ELSE sf.label_he END AS from_label,
  l.to_status,
  CASE booking_pkg.current_lang WHEN 'EN' THEN st.label_en ELSE st.label_he END AS to_label,
  l.note
FROM booking_status_log l
JOIN app_users u  ON u.user_id      = l.action_by
LEFT JOIN statuses sf ON sf.status_code = l.from_status
JOIN statuses st ON st.status_code   = l.to_status;

-- סיכום כספים — צבירה לפי מחלקה / סטטוס / מטבע / חודש (לכרטיסי הדשבורד)
CREATE OR REPLACE VIEW v_finance_summary AS
SELECT
  b.dept_id,
  CASE booking_pkg.current_lang WHEN 'EN' THEN NVL(d.name_en, d.name_he) ELSE d.name_he END AS dept_name,
  b.status                                   AS status_code,
  CASE booking_pkg.current_lang WHEN 'EN' THEN st.label_en ELSE st.label_he END AS status_label,
  b.currency_code,
  TO_CHAR(b.open_date, 'YYYY-MM')            AS open_month,
  COUNT(*)                                    AS bookings_cnt,
  SUM(b.price)                                AS total_price,
  AVG(b.price)                                AS avg_price
FROM bookings b
JOIN departments d ON d.dept_id     = b.dept_id
JOIN statuses    st ON st.status_code = b.status
GROUP BY
  b.dept_id, d.name_en, d.name_he, b.status, st.label_en, st.label_he,
  b.currency_code, TO_CHAR(b.open_date, 'YYYY-MM');

PROMPT ✔ 04_views.sql — ה-Views נוצרו בהצלחה.
