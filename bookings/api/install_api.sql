--------------------------------------------------------------------------------
-- מערכת תיעוד הזמנות טיסות (ארקיע) · install_api.sql
-- שכבת REST (ORDS) מעל סכמת ARKIA — מאפשרת לאפליקציית ה-HTML לעבוד רב-משתמשי
-- על אותה אורקל, בלי לבנות עמודים ב-APEX.
--
-- להרצה בסכמת ARKIA (Database Actions → SQL, מחוברים כ-ARKIA), F5 / Run Script.
-- דורש: 01-04 (install_all.sql) הותקנו כבר; הסכמה ARKIA מופעלת ל-ORDS.
--
-- Base path: /ords/arkia/api/...
-- אימות: POST api/login → token; שאר הקריאות מוסרות token (query/body).
--------------------------------------------------------------------------------

-- ── טבלת סשנים (טוקנים) ──
BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE api_sessions CASCADE CONSTRAINTS PURGE';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
CREATE TABLE api_sessions (
  token      VARCHAR2(64) PRIMARY KEY,
  user_id    NUMBER NOT NULL,
  created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
  expires_at TIMESTAMP DEFAULT SYSTIMESTAMP + INTERVAL '12' HOUR NOT NULL,
  CONSTRAINT api_sessions_user_fk FOREIGN KEY (user_id) REFERENCES app_users (user_id) ON DELETE CASCADE
);

--------------------------------------------------------------------------------
-- חבילת ה-API — בונה JSON ומריצה את זרימת booking_pkg
--------------------------------------------------------------------------------
CREATE OR REPLACE PACKAGE api_pkg AS
  PROCEDURE emit (p_json CLOB);
  PROCEDURE emit_preflight;
  FUNCTION  err (p_msg VARCHAR2) RETURN CLOB;
  FUNCTION  uid (p_token VARCHAR2) RETURN NUMBER;
  FUNCTION  has_role (p_uid NUMBER, p_role VARCHAR2) RETURN VARCHAR2;

  FUNCTION  login        (p_username VARCHAR2, p_password VARCHAR2) RETURN CLOB;
  FUNCTION  bootstrap    (p_token VARCHAR2) RETURN CLOB;
  FUNCTION  list_bookings(p_token VARCHAR2) RETURN CLOB;
  FUNCTION  get_booking  (p_token VARCHAR2, p_id NUMBER) RETURN CLOB;
  FUNCTION  create_booking(p_token VARCHAR2, p_departure VARCHAR2, p_price NUMBER,
                           p_currency VARCHAR2, p_agent_id NUMBER, p_notes VARCHAR2) RETURN CLOB;
  FUNCTION  do_action    (p_token VARCHAR2, p_id NUMBER, p_action VARCHAR2,
                          p_price NUMBER, p_currency VARCHAR2, p_trip CLOB, p_notes VARCHAR2,
                          p_pnr VARCHAR2, p_ref VARCHAR2, p_tdate VARCHAR2, p_reason VARCHAR2) RETURN CLOB;
  FUNCTION  add_file     (p_token VARCHAR2, p_booking_id NUMBER, p_kind VARCHAR2,
                          p_filename VARCHAR2, p_mime VARCHAR2, p_data CLOB) RETURN CLOB;
  PROCEDURE get_file     (p_id NUMBER, o_blob OUT BLOB, o_mime OUT VARCHAR2, o_name OUT VARCHAR2);
  FUNCTION  notifications(p_token VARCHAR2) RETURN CLOB;
  FUNCTION  mark_read    (p_token VARCHAR2) RETURN CLOB;
END api_pkg;
/

CREATE OR REPLACE PACKAGE BODY api_pkg AS

  PROCEDURE emit (p_json CLOB) IS
    l_len PLS_INTEGER := DBMS_LOB.getlength(p_json);
    l_off PLS_INTEGER := 1;
  BEGIN
    owa_util.mime_header('application/json', FALSE);
    htp.p('Access-Control-Allow-Origin: *');
    htp.p('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    htp.p('Access-Control-Allow-Headers: Content-Type, Authorization');
    owa_util.http_header_close;
    WHILE l_off <= l_len LOOP
      htp.prn(DBMS_LOB.substr(p_json, 6000, l_off));
      l_off := l_off + 6000;
    END LOOP;
  END emit;

  PROCEDURE emit_preflight IS
  BEGIN
    owa_util.mime_header('text/plain', FALSE);
    htp.p('Access-Control-Allow-Origin: *');
    htp.p('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    htp.p('Access-Control-Allow-Headers: Content-Type, Authorization');
    htp.p('Access-Control-Max-Age: 86400');
    owa_util.http_header_close;
  END emit_preflight;

  FUNCTION err (p_msg VARCHAR2) RETURN CLOB IS
  BEGIN
    RETURN JSON_OBJECT('ok' VALUE 'false' FORMAT JSON, 'error' VALUE p_msg RETURNING CLOB);
  END err;

  FUNCTION uid (p_token VARCHAR2) RETURN NUMBER IS
    l NUMBER;
  BEGIN
    SELECT user_id INTO l FROM api_sessions WHERE token = p_token AND expires_at > SYSTIMESTAMP;
    RETURN l;
  EXCEPTION WHEN NO_DATA_FOUND THEN
    RAISE_APPLICATION_ERROR(-20401, 'invalid_or_expired_token');
  END uid;

  FUNCTION has_role (p_uid NUMBER, p_role VARCHAR2) RETURN VARCHAR2 IS
    n PLS_INTEGER;
  BEGIN
    SELECT COUNT(*) INTO n FROM user_roles WHERE user_id = p_uid AND role_code = p_role;
    RETURN CASE WHEN n > 0 THEN 'Y' ELSE 'N' END;
  END has_role;

  FUNCTION login (p_username VARCHAR2, p_password VARCHAR2) RETURN CLOB IS
    l_uid   NUMBER;
    l_token VARCHAR2(64);
    l_json  CLOB;
  BEGIN
    IF NOT booking_pkg.authenticate(p_username, p_password) THEN
      RETURN err('bad_credentials');
    END IF;
    SELECT user_id INTO l_uid FROM app_users WHERE LOWER(username) = LOWER(p_username);
    l_token := RAWTOHEX(SYS_GUID());
    INSERT INTO api_sessions (token, user_id) VALUES (l_token, l_uid);
    COMMIT;
    SELECT JSON_OBJECT(
             'ok'    VALUE 'true' FORMAT JSON,
             'token' VALUE l_token,
             'user'  VALUE JSON_OBJECT('id' VALUE u.user_id, 'username' VALUE u.username,
                        'full_name' VALUE u.full_name, 'dept_id' VALUE u.dept_id,
                        'pref_lang' VALUE u.pref_lang),
             'roles' VALUE (SELECT JSON_ARRAYAGG(role_code RETURNING CLOB) FROM user_roles WHERE user_id = u.user_id),
             'agent_id' VALUE (SELECT MAX(agent_id) FROM agents WHERE user_id = u.user_id)
             RETURNING CLOB)
      INTO l_json FROM app_users u WHERE u.user_id = l_uid;
    RETURN l_json;
  EXCEPTION WHEN OTHERS THEN RETURN err(SQLERRM);
  END login;

  FUNCTION bootstrap (p_token VARCHAR2) RETURN CLOB IS
    l_uid  NUMBER := uid(p_token);
    l_json CLOB;
  BEGIN
    SELECT JSON_OBJECT(
      'ok' VALUE 'true' FORMAT JSON,
      'departments' VALUE (SELECT JSON_ARRAYAGG(JSON_OBJECT('id' VALUE dept_id,'code' VALUE dept_code,
                             'name_he' VALUE name_he,'name_en' VALUE name_en) RETURNING CLOB)
                           FROM departments WHERE is_active='Y'),
      'agents' VALUE (SELECT JSON_ARRAYAGG(JSON_OBJECT('id' VALUE agent_id,'name' VALUE agency_name) RETURNING CLOB)
                      FROM agents WHERE is_active='Y'),
      'currencies' VALUE (SELECT JSON_ARRAYAGG(JSON_OBJECT('code' VALUE code,'symbol' VALUE symbol,
                            'is_default' VALUE is_default) RETURNING CLOB) FROM currencies),
      'statuses' VALUE (SELECT JSON_ARRAYAGG(JSON_OBJECT('code' VALUE status_code,'he' VALUE label_he,
                          'en' VALUE label_en,'terminal' VALUE is_terminal) RETURNING CLOB) FROM statuses)
      RETURNING CLOB)
    INTO l_json FROM dual;
    RETURN l_json;
  EXCEPTION WHEN OTHERS THEN RETURN err(SQLERRM);
  END bootstrap;

  FUNCTION list_bookings (p_token VARCHAR2) RETURN CLOB IS
    l_uid   NUMBER := uid(p_token);
    l_all   VARCHAR2(1);
    l_agent NUMBER;
    l_dept  NUMBER;
    l_json  CLOB;
  BEGIN
    l_all := CASE WHEN has_role(l_uid,'ADMIN')='Y' OR has_role(l_uid,'FINANCE')='Y' THEN 'Y' ELSE 'N' END;
    SELECT MAX(agent_id) INTO l_agent FROM agents WHERE user_id = l_uid;
    SELECT dept_id INTO l_dept FROM app_users WHERE user_id = l_uid;
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
             'id' VALUE b.booking_id, 'seq' VALUE b.booking_id, 'status' VALUE b.status,
             'dept_id' VALUE b.dept_id, 'dept_he' VALUE d.name_he, 'dept_en' VALUE d.name_en,
             'initiator' VALUE ini.full_name, 'agent_id' VALUE b.agent_id, 'agent' VALUE ag.agency_name,
             'departure_date' VALUE TO_CHAR(b.departure_date,'YYYY-MM-DD'),
             'open_date' VALUE TO_CHAR(b.open_date,'YYYY-MM-DD'),
             'ticketing_date' VALUE TO_CHAR(b.ticketing_date,'YYYY-MM-DD'),
             'price' VALUE b.price, 'currency' VALUE b.currency_code, 'pnr' VALUE b.pnr
             RETURNING CLOB) ORDER BY b.booking_id DESC RETURNING CLOB)
      INTO l_json
      FROM bookings b
      JOIN departments d  ON d.dept_id   = b.dept_id
      JOIN app_users  ini ON ini.user_id = b.initiator_id
      LEFT JOIN agents ag ON ag.agent_id = b.agent_id
     WHERE l_all = 'Y'
        OR (l_agent IS NOT NULL AND b.agent_id = l_agent)
        OR (l_agent IS NULL AND b.dept_id = l_dept);
    RETURN JSON_OBJECT('ok' VALUE 'true' FORMAT JSON,
                       'bookings' VALUE NVL(l_json,'[]') FORMAT JSON RETURNING CLOB);
  EXCEPTION WHEN OTHERS THEN RETURN err(SQLERRM);
  END list_bookings;

  FUNCTION get_booking (p_token VARCHAR2, p_id NUMBER) RETURN CLOB IS
    l_uid  NUMBER := uid(p_token);
    l_json CLOB;
  BEGIN
    SELECT JSON_OBJECT(
      'ok' VALUE 'true' FORMAT JSON,
      'booking' VALUE (SELECT JSON_OBJECT(
          'id' VALUE b.booking_id,'seq' VALUE b.booking_id,'status' VALUE b.status,
          'dept_id' VALUE b.dept_id,'dept_he' VALUE d.name_he,'dept_en' VALUE d.name_en,
          'initiator_id' VALUE b.initiator_id,'initiator' VALUE ini.full_name,
          'agent_id' VALUE b.agent_id,'agent' VALUE ag.agency_name,
          'approver_id' VALUE b.approver_id,'approver' VALUE apr.full_name,
          'departure_date' VALUE TO_CHAR(b.departure_date,'YYYY-MM-DD'),
          'open_date' VALUE TO_CHAR(b.open_date,'YYYY-MM-DD'),
          'ticketing_date' VALUE TO_CHAR(b.ticketing_date,'YYYY-MM-DD'),
          'price' VALUE b.price,'currency' VALUE b.currency_code,'pnr' VALUE b.pnr,
          'unique_ref' VALUE b.unique_booking_ref,'quote_notes' VALUE b.quote_notes,
          'trip_details' VALUE b.trip_details,'rejection_reason' VALUE b.rejection_reason,
          'cancel_reason' VALUE b.cancel_reason RETURNING CLOB)
        FROM bookings b JOIN departments d ON d.dept_id=b.dept_id
             JOIN app_users ini ON ini.user_id=b.initiator_id
             LEFT JOIN agents ag ON ag.agent_id=b.agent_id
             LEFT JOIN app_users apr ON apr.user_id=b.approver_id
        WHERE b.booking_id=p_id),
      'files' VALUE (SELECT JSON_ARRAYAGG(JSON_OBJECT('id' VALUE file_id,'kind' VALUE file_kind,
                       'filename' VALUE filename,'mime' VALUE mime_type) RETURNING CLOB)
                     FROM booking_files WHERE booking_id=p_id),
      'log' VALUE (SELECT JSON_ARRAYAGG(JSON_OBJECT('from' VALUE l.from_status,'to' VALUE l.to_status,
                     'by' VALUE u.full_name,'at' VALUE TO_CHAR(l.action_at,'YYYY-MM-DD HH24:MI'),
                     'note' VALUE l.note) ORDER BY l.action_at DESC RETURNING CLOB)
                   FROM booking_status_log l JOIN app_users u ON u.user_id=l.action_by
                   WHERE l.booking_id=p_id)
      RETURNING CLOB) INTO l_json FROM dual;
    RETURN l_json;
  EXCEPTION WHEN OTHERS THEN RETURN err(SQLERRM);
  END get_booking;

  FUNCTION create_booking (p_token VARCHAR2, p_departure VARCHAR2, p_price NUMBER,
                           p_currency VARCHAR2, p_agent_id NUMBER, p_notes VARCHAR2) RETURN CLOB IS
    l_uid  NUMBER := uid(p_token);
    l_dept NUMBER;
    l_id   NUMBER;
  BEGIN
    SELECT dept_id INTO l_dept FROM app_users WHERE user_id = l_uid;
    INSERT INTO bookings (dept_id, initiator_id, agent_id, approver_id, status, open_date,
                          departure_date, price, currency_code, quote_notes)
    VALUES (l_dept, l_uid, p_agent_id, booking_pkg.derive_approver(l_dept), 'NEW', TRUNC(SYSDATE),
            TO_DATE(p_departure,'YYYY-MM-DD'), p_price, NVL(p_currency,'USD'), p_notes)
    RETURNING booking_id INTO l_id;
    INSERT INTO booking_status_log (booking_id, from_status, to_status, action_by)
    VALUES (l_id, NULL, 'NEW', l_uid);
    booking_pkg.send_for_quote(l_id, p_agent_id, l_uid);
    COMMIT;
    RETURN JSON_OBJECT('ok' VALUE 'true' FORMAT JSON, 'id' VALUE l_id RETURNING CLOB);
  EXCEPTION WHEN OTHERS THEN ROLLBACK; RETURN err(SQLERRM);
  END create_booking;

  FUNCTION do_action (p_token VARCHAR2, p_id NUMBER, p_action VARCHAR2,
                      p_price NUMBER, p_currency VARCHAR2, p_trip CLOB, p_notes VARCHAR2,
                      p_pnr VARCHAR2, p_ref VARCHAR2, p_tdate VARCHAR2, p_reason VARCHAR2) RETURN CLOB IS
    l_uid NUMBER := uid(p_token);
  BEGIN
    CASE p_action
      WHEN 'submit_quote'   THEN booking_pkg.submit_quote(p_id, p_price, p_currency, p_trip, p_notes, l_uid);
      WHEN 'approve'        THEN booking_pkg.approve(p_id, l_uid, p_notes);
      WHEN 'reject'         THEN booking_pkg.reject(p_id, l_uid, p_reason);
      WHEN 'ticket'         THEN booking_pkg.ticket(p_id, p_pnr, p_ref, TO_DATE(p_tdate,'YYYY-MM-DD'), l_uid);
      WHEN 'request_cancel' THEN booking_pkg.request_cancel(p_id, l_uid, p_reason);
      WHEN 'confirm_cancel' THEN booking_pkg.confirm_cancel(p_id, l_uid, p_notes);
      ELSE RETURN err('unknown_action');
    END CASE;
    COMMIT;
    RETURN JSON_OBJECT('ok' VALUE 'true' FORMAT JSON RETURNING CLOB);
  EXCEPTION WHEN OTHERS THEN ROLLBACK; RETURN err(SQLERRM);
  END do_action;

  FUNCTION add_file (p_token VARCHAR2, p_booking_id NUMBER, p_kind VARCHAR2,
                     p_filename VARCHAR2, p_mime VARCHAR2, p_data CLOB) RETURN CLOB IS
    l_uid  NUMBER := uid(p_token);
    l_blob BLOB;
  BEGIN
    l_blob := APEX_WEB_SERVICE.CLOBBASE642BLOB(p_data);
    INSERT INTO booking_files (booking_id, file_kind, filename, mime_type, file_blob, uploaded_by)
    VALUES (p_booking_id, p_kind, p_filename, p_mime, l_blob, l_uid);
    COMMIT;
    RETURN JSON_OBJECT('ok' VALUE 'true' FORMAT JSON RETURNING CLOB);
  EXCEPTION WHEN OTHERS THEN ROLLBACK; RETURN err(SQLERRM);
  END add_file;

  PROCEDURE get_file (p_id NUMBER, o_blob OUT BLOB, o_mime OUT VARCHAR2, o_name OUT VARCHAR2) IS
  BEGIN
    SELECT file_blob, NVL(mime_type,'application/octet-stream'), filename
      INTO o_blob, o_mime, o_name FROM booking_files WHERE file_id = p_id;
  END get_file;

  FUNCTION notifications (p_token VARCHAR2) RETURN CLOB IS
    l_uid  NUMBER := uid(p_token);
    l_json CLOB;
  BEGIN
    SELECT JSON_ARRAYAGG(JSON_OBJECT('id' VALUE notif_id,'booking_id' VALUE booking_id,
             'message' VALUE message,'is_read' VALUE is_read,
             'at' VALUE TO_CHAR(created_at,'YYYY-MM-DD HH24:MI') RETURNING CLOB)
             ORDER BY created_at DESC RETURNING CLOB)
      INTO l_json FROM notifications WHERE user_id = l_uid;
    RETURN JSON_OBJECT('ok' VALUE 'true' FORMAT JSON,
                       'notifications' VALUE NVL(l_json,'[]') FORMAT JSON RETURNING CLOB);
  EXCEPTION WHEN OTHERS THEN RETURN err(SQLERRM);
  END notifications;

  FUNCTION mark_read (p_token VARCHAR2) RETURN CLOB IS
    l_uid NUMBER := uid(p_token);
  BEGIN
    UPDATE notifications SET is_read = 'Y' WHERE user_id = l_uid AND is_read = 'N';
    COMMIT;
    RETURN JSON_OBJECT('ok' VALUE 'true' FORMAT JSON RETURNING CLOB);
  EXCEPTION WHEN OTHERS THEN RETURN err(SQLERRM);
  END mark_read;

END api_pkg;
/

--------------------------------------------------------------------------------
-- הגדרת מודול ה-ORDS (REST)
--------------------------------------------------------------------------------
BEGIN
  BEGIN ORDS.DELETE_MODULE(p_module_name => 'arkia.api'); EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_MODULE(
    p_module_name => 'arkia.api',
    p_base_path   => 'api/',
    p_status      => 'PUBLISHED',
    p_comments    => 'Arkia bookings REST API');

  -- ping (בדיקת חיים)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'ping');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'ping', p_method=>'GET',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(JSON_OBJECT('ok' VALUE 'true' FORMAT JSON, 'service' VALUE 'arkia-api' RETURNING CLOB)); END;]');

  -- login
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'login');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'login', p_method=>'POST',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.login(:username, :password)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'login', p_method=>'OPTIONS',
    p_source_type=>ORDS.source_type_plsql, p_source=>q'[BEGIN api_pkg.emit_preflight; END;]');

  -- bootstrap
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'bootstrap');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'bootstrap', p_method=>'GET',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.bootstrap(:token)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');

  -- bookings (list + create)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'bookings');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'bookings', p_method=>'GET',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.list_bookings(:token)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'bookings', p_method=>'POST',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.create_booking(:token, :departure, :price, :currency, :agent_id, :notes)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'bookings', p_method=>'OPTIONS',
    p_source_type=>ORDS.source_type_plsql, p_source=>q'[BEGIN api_pkg.emit_preflight; END;]');

  -- bookings/:id (detail)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'bookings/:id');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'bookings/:id', p_method=>'GET',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.get_booking(:token, :id)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');

  -- bookings/:id/action
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'bookings/:id/action');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'bookings/:id/action', p_method=>'POST',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.do_action(:token, :id, :action, :price, :currency, :trip, :notes, :pnr, :ref, :tdate, :reason)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'bookings/:id/action', p_method=>'OPTIONS',
    p_source_type=>ORDS.source_type_plsql, p_source=>q'[BEGIN api_pkg.emit_preflight; END;]');

  -- notifications
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'notifications');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'notifications', p_method=>'GET',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.notifications(:token)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');

  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'notifications/read');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'notifications/read', p_method=>'POST',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.mark_read(:token)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'notifications/read', p_method=>'OPTIONS',
    p_source_type=>ORDS.source_type_plsql, p_source=>q'[BEGIN api_pkg.emit_preflight; END;]');

  -- files (upload)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'files');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'files', p_method=>'POST',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.add_file(:token, :booking_id, :kind, :filename, :mime, :data)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'files', p_method=>'OPTIONS',
    p_source_type=>ORDS.source_type_plsql, p_source=>q'[BEGIN api_pkg.emit_preflight; END;]');

  -- files/:id (download)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'files/:id');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'files/:id', p_method=>'GET',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[DECLARE l_blob BLOB; l_mime VARCHAR2(200); l_name VARCHAR2(400);
BEGIN
  api_pkg.get_file(:id, l_blob, l_mime, l_name);
  owa_util.mime_header(l_mime, FALSE);
  htp.p('Access-Control-Allow-Origin: *');
  htp.p('Content-Disposition: inline; filename="'||l_name||'"');
  owa_util.http_header_close;
  wpg_docload.download_file(l_blob);
EXCEPTION WHEN OTHERS THEN
  owa_util.mime_header('application/json', TRUE); htp.p(api_pkg.err(SQLERRM));
END;]');

  COMMIT;
END;
/

PROMPT ✔ install_api.sql — שכבת ה-REST הותקנה. בסיס: /ords/arkia/api/
