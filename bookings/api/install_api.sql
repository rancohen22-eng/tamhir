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
    owa_util.mime_header('text/plain', TRUE);
  END emit_preflight;

  FUNCTION err (p_msg VARCHAR2) RETURN CLOB IS
  BEGIN
    RETURN '{"ok":false,"error":"'||REPLACE(REPLACE(NVL(p_msg,'error'),'\','\\'),'"','\"')||'"}';
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
    l_uid NUMBER; l_token VARCHAR2(64); l_dept NUMBER; l_lang VARCHAR2(2); l_full VARCHAR2(150); l_agent NUMBER;
  BEGIN
    IF NOT booking_pkg.authenticate(p_username, p_password) THEN RETURN err('bad_credentials'); END IF;
    SELECT user_id, dept_id, pref_lang, full_name INTO l_uid, l_dept, l_lang, l_full
      FROM app_users WHERE LOWER(username) = LOWER(p_username);
    l_token := RAWTOHEX(SYS_GUID());
    INSERT INTO api_sessions (token, user_id) VALUES (l_token, l_uid); COMMIT;
    SELECT MAX(agent_id) INTO l_agent FROM agents WHERE user_id = l_uid;
    APEX_JSON.initialize_clob_output;
    APEX_JSON.open_object;
      APEX_JSON.write('ok', TRUE);
      APEX_JSON.write('token', l_token);
      APEX_JSON.open_object('user');
        APEX_JSON.write('id', l_uid); APEX_JSON.write('username', LOWER(p_username));
        APEX_JSON.write('full_name', l_full); APEX_JSON.write('dept_id', l_dept); APEX_JSON.write('pref_lang', l_lang);
      APEX_JSON.close_object;
      APEX_JSON.open_array('roles');
        FOR r IN (SELECT role_code FROM user_roles WHERE user_id = l_uid) LOOP APEX_JSON.write(r.role_code); END LOOP;
      APEX_JSON.close_array;
      APEX_JSON.write('agent_id', l_agent);
    APEX_JSON.close_object;
    RETURN APEX_JSON.get_clob_output;
  EXCEPTION WHEN OTHERS THEN APEX_JSON.free_output; RETURN err(SQLERRM);
  END login;

  FUNCTION bootstrap (p_token VARCHAR2) RETURN CLOB IS
    l_uid NUMBER := uid(p_token);
  BEGIN
    APEX_JSON.initialize_clob_output;
    APEX_JSON.open_object; APEX_JSON.write('ok', TRUE);
      APEX_JSON.open_array('departments');
        FOR d IN (SELECT dept_id,dept_code,name_he,name_en FROM departments WHERE is_active='Y' ORDER BY dept_id) LOOP
          APEX_JSON.open_object; APEX_JSON.write('id',d.dept_id); APEX_JSON.write('code',d.dept_code);
          APEX_JSON.write('name_he',d.name_he); APEX_JSON.write('name_en',d.name_en); APEX_JSON.close_object;
        END LOOP;
      APEX_JSON.close_array;
      APEX_JSON.open_array('agents');
        FOR a IN (SELECT agent_id,agency_name FROM agents WHERE is_active='Y' ORDER BY agent_id) LOOP
          APEX_JSON.open_object; APEX_JSON.write('id',a.agent_id); APEX_JSON.write('name',a.agency_name); APEX_JSON.close_object;
        END LOOP;
      APEX_JSON.close_array;
      APEX_JSON.open_array('currencies');
        FOR c IN (SELECT code,symbol,is_default FROM currencies ORDER BY DECODE(is_default,'Y',0,1),code) LOOP
          APEX_JSON.open_object; APEX_JSON.write('code',c.code); APEX_JSON.write('symbol',c.symbol);
          APEX_JSON.write('is_default',c.is_default); APEX_JSON.close_object;
        END LOOP;
      APEX_JSON.close_array;
      APEX_JSON.open_array('statuses');
        FOR s IN (SELECT status_code,label_he,label_en,is_terminal FROM statuses ORDER BY sort_order) LOOP
          APEX_JSON.open_object; APEX_JSON.write('code',s.status_code); APEX_JSON.write('he',s.label_he);
          APEX_JSON.write('en',s.label_en); APEX_JSON.write('terminal',s.is_terminal); APEX_JSON.close_object;
        END LOOP;
      APEX_JSON.close_array;
    APEX_JSON.close_object;
    RETURN APEX_JSON.get_clob_output;
  EXCEPTION WHEN OTHERS THEN APEX_JSON.free_output; RETURN err(SQLERRM);
  END bootstrap;

  FUNCTION list_bookings (p_token VARCHAR2) RETURN CLOB IS
    l_uid NUMBER := uid(p_token); l_all VARCHAR2(1); l_agent NUMBER; l_dept NUMBER;
  BEGIN
    l_all := CASE WHEN has_role(l_uid,'ADMIN')='Y' OR has_role(l_uid,'FINANCE')='Y' THEN 'Y' ELSE 'N' END;
    SELECT MAX(agent_id) INTO l_agent FROM agents WHERE user_id = l_uid;
    SELECT dept_id INTO l_dept FROM app_users WHERE user_id = l_uid;
    APEX_JSON.initialize_clob_output;
    APEX_JSON.open_object; APEX_JSON.write('ok', TRUE); APEX_JSON.open_array('bookings');
    FOR b IN (
      SELECT b.booking_id, b.status, b.dept_id, d.name_he dhe, d.name_en den, ini.full_name ininame,
             b.agent_id, ag.agency_name agn, TO_CHAR(b.departure_date,'YYYY-MM-DD') dep,
             TO_CHAR(b.open_date,'YYYY-MM-DD') opn, TO_CHAR(b.ticketing_date,'YYYY-MM-DD') tkt,
             b.price, b.currency_code cur, b.pnr
      FROM bookings b JOIN departments d ON d.dept_id=b.dept_id
           JOIN app_users ini ON ini.user_id=b.initiator_id
           LEFT JOIN agents ag ON ag.agent_id=b.agent_id
      WHERE l_all='Y' OR (l_agent IS NOT NULL AND b.agent_id=l_agent) OR (l_agent IS NULL AND b.dept_id=l_dept)
      ORDER BY b.booking_id DESC) LOOP
      APEX_JSON.open_object;
        APEX_JSON.write('id',b.booking_id); APEX_JSON.write('seq',b.booking_id); APEX_JSON.write('status',b.status);
        APEX_JSON.write('dept_id',b.dept_id); APEX_JSON.write('dept_he',b.dhe); APEX_JSON.write('dept_en',b.den);
        APEX_JSON.write('initiator',b.ininame); APEX_JSON.write('agent_id',b.agent_id); APEX_JSON.write('agent',b.agn);
        APEX_JSON.write('departure_date',b.dep); APEX_JSON.write('open_date',b.opn); APEX_JSON.write('ticketing_date',b.tkt);
        APEX_JSON.write('price',b.price); APEX_JSON.write('currency',b.cur); APEX_JSON.write('pnr',b.pnr);
      APEX_JSON.close_object;
    END LOOP;
    APEX_JSON.close_array; APEX_JSON.close_object;
    RETURN APEX_JSON.get_clob_output;
  EXCEPTION WHEN OTHERS THEN APEX_JSON.free_output; RETURN err(SQLERRM);
  END list_bookings;

  FUNCTION get_booking (p_token VARCHAR2, p_id NUMBER) RETURN CLOB IS
    l_uid NUMBER := uid(p_token); r bookings%ROWTYPE;
    l_dhe VARCHAR2(120); l_den VARCHAR2(120); l_ini VARCHAR2(150); l_agn VARCHAR2(150); l_apr VARCHAR2(150);
  BEGIN
    SELECT * INTO r FROM bookings WHERE booking_id = p_id;
    SELECT name_he,name_en INTO l_dhe,l_den FROM departments WHERE dept_id=r.dept_id;
    SELECT full_name INTO l_ini FROM app_users WHERE user_id=r.initiator_id;
    BEGIN SELECT agency_name INTO l_agn FROM agents WHERE agent_id=r.agent_id; EXCEPTION WHEN NO_DATA_FOUND THEN l_agn:=NULL; END;
    BEGIN SELECT full_name INTO l_apr FROM app_users WHERE user_id=r.approver_id; EXCEPTION WHEN NO_DATA_FOUND THEN l_apr:=NULL; END;
    APEX_JSON.initialize_clob_output;
    APEX_JSON.open_object; APEX_JSON.write('ok', TRUE);
      APEX_JSON.open_object('booking');
        APEX_JSON.write('id',r.booking_id); APEX_JSON.write('seq',r.booking_id); APEX_JSON.write('status',r.status);
        APEX_JSON.write('dept_id',r.dept_id); APEX_JSON.write('dept_he',l_dhe); APEX_JSON.write('dept_en',l_den);
        APEX_JSON.write('initiator_id',r.initiator_id); APEX_JSON.write('initiator',l_ini);
        APEX_JSON.write('agent_id',r.agent_id); APEX_JSON.write('agent',l_agn);
        APEX_JSON.write('approver_id',r.approver_id); APEX_JSON.write('approver',l_apr);
        APEX_JSON.write('departure_date',TO_CHAR(r.departure_date,'YYYY-MM-DD'));
        APEX_JSON.write('open_date',TO_CHAR(r.open_date,'YYYY-MM-DD'));
        APEX_JSON.write('ticketing_date',TO_CHAR(r.ticketing_date,'YYYY-MM-DD'));
        APEX_JSON.write('price',r.price); APEX_JSON.write('currency',r.currency_code);
        APEX_JSON.write('pnr',r.pnr); APEX_JSON.write('unique_ref',r.unique_booking_ref);
        APEX_JSON.write('quote_notes',r.quote_notes); APEX_JSON.write('trip_details',r.trip_details);
        APEX_JSON.write('rejection_reason',r.rejection_reason); APEX_JSON.write('cancel_reason',r.cancel_reason);
      APEX_JSON.close_object;
      APEX_JSON.open_array('files');
        FOR f IN (SELECT file_id,file_kind,filename,mime_type FROM booking_files WHERE booking_id=p_id ORDER BY file_id) LOOP
          APEX_JSON.open_object; APEX_JSON.write('id',f.file_id); APEX_JSON.write('kind',f.file_kind);
          APEX_JSON.write('filename',f.filename); APEX_JSON.write('mime',f.mime_type); APEX_JSON.close_object;
        END LOOP;
      APEX_JSON.close_array;
      APEX_JSON.open_array('log');
        FOR lg IN (SELECT l.from_status fs,l.to_status ts,u.full_name nm,TO_CHAR(l.action_at,'YYYY-MM-DD HH24:MI') atx,l.note nt
                   FROM booking_status_log l JOIN app_users u ON u.user_id=l.action_by
                   WHERE l.booking_id=p_id ORDER BY l.action_at DESC) LOOP
          APEX_JSON.open_object; APEX_JSON.write('from',lg.fs); APEX_JSON.write('to',lg.ts);
          APEX_JSON.write('by',lg.nm); APEX_JSON.write('at',lg.atx); APEX_JSON.write('note',lg.nt); APEX_JSON.close_object;
        END LOOP;
      APEX_JSON.close_array;
    APEX_JSON.close_object;
    RETURN APEX_JSON.get_clob_output;
  EXCEPTION WHEN OTHERS THEN APEX_JSON.free_output; RETURN err(SQLERRM);
  END get_booking;

  FUNCTION create_booking (p_token VARCHAR2, p_departure VARCHAR2, p_price NUMBER,
                           p_currency VARCHAR2, p_agent_id NUMBER, p_notes VARCHAR2) RETURN CLOB IS
    l_uid NUMBER := uid(p_token); l_dept NUMBER; l_id NUMBER;
  BEGIN
    SELECT dept_id INTO l_dept FROM app_users WHERE user_id = l_uid;
    INSERT INTO bookings (dept_id, initiator_id, agent_id, approver_id, status, open_date,
                          departure_date, price, currency_code, quote_notes)
    VALUES (l_dept, l_uid, p_agent_id, booking_pkg.derive_approver(l_dept), 'NEW', TRUNC(SYSDATE),
            TO_DATE(p_departure,'YYYY-MM-DD'), p_price, NVL(p_currency,'USD'), p_notes)
    RETURNING booking_id INTO l_id;
    INSERT INTO booking_status_log (booking_id, from_status, to_status, action_by) VALUES (l_id, NULL, 'NEW', l_uid);
    booking_pkg.send_for_quote(l_id, p_agent_id, l_uid);
    COMMIT;
    RETURN '{"ok":true,"id":'||l_id||'}';
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
    RETURN '{"ok":true}';
  EXCEPTION WHEN OTHERS THEN ROLLBACK; RETURN err(SQLERRM);
  END do_action;

  FUNCTION add_file (p_token VARCHAR2, p_booking_id NUMBER, p_kind VARCHAR2,
                     p_filename VARCHAR2, p_mime VARCHAR2, p_data CLOB) RETURN CLOB IS
    l_uid NUMBER := uid(p_token); l_blob BLOB;
  BEGIN
    l_blob := APEX_WEB_SERVICE.CLOBBASE642BLOB(p_data);
    INSERT INTO booking_files (booking_id, file_kind, filename, mime_type, file_blob, uploaded_by)
    VALUES (p_booking_id, p_kind, p_filename, p_mime, l_blob, l_uid);
    COMMIT;
    RETURN '{"ok":true}';
  EXCEPTION WHEN OTHERS THEN ROLLBACK; RETURN err(SQLERRM);
  END add_file;

  PROCEDURE get_file (p_id NUMBER, o_blob OUT BLOB, o_mime OUT VARCHAR2, o_name OUT VARCHAR2) IS
  BEGIN
    SELECT file_blob, NVL(mime_type,'application/octet-stream'), filename
      INTO o_blob, o_mime, o_name FROM booking_files WHERE file_id = p_id;
  END get_file;

  FUNCTION notifications (p_token VARCHAR2) RETURN CLOB IS
    l_uid NUMBER := uid(p_token);
  BEGIN
    APEX_JSON.initialize_clob_output;
    APEX_JSON.open_object; APEX_JSON.write('ok', TRUE); APEX_JSON.open_array('notifications');
    FOR n IN (SELECT notif_id,booking_id,message,is_read,TO_CHAR(created_at,'YYYY-MM-DD HH24:MI') atx
              FROM notifications WHERE user_id = l_uid ORDER BY created_at DESC) LOOP
      APEX_JSON.open_object; APEX_JSON.write('id',n.notif_id); APEX_JSON.write('booking_id',n.booking_id);
      APEX_JSON.write('message',n.message); APEX_JSON.write('is_read',n.is_read); APEX_JSON.write('at',n.atx); APEX_JSON.close_object;
    END LOOP;
    APEX_JSON.close_array; APEX_JSON.close_object;
    RETURN APEX_JSON.get_clob_output;
  EXCEPTION WHEN OTHERS THEN APEX_JSON.free_output; RETURN err(SQLERRM);
  END notifications;

  FUNCTION mark_read (p_token VARCHAR2) RETURN CLOB IS
    l_uid NUMBER := uid(p_token);
  BEGIN
    UPDATE notifications SET is_read='Y' WHERE user_id = l_uid AND is_read='N';
    COMMIT;
    RETURN '{"ok":true}';
  EXCEPTION WHEN OTHERS THEN RETURN err(SQLERRM);
  END mark_read;

END api_pkg;
/

--------------------------------------------------------------------------------
-- הגדרת מודול ה-ORDS (REST)
-- הערה: ORDS מתיר handler מסוג PL/SQL רק ל-POST/PUT/DELETE (לא GET).
--       לכן כל קריאות הנתונים הן POST (פרמטרים ב-form body), ping=query, files=media.
--       שליחת form-urlencoded מהדפדפן נחשבת "simple request" → אין preflight/OPTIONS.
--------------------------------------------------------------------------------
BEGIN
  BEGIN ORDS.DELETE_MODULE(p_module_name => 'arkia.api'); EXCEPTION WHEN OTHERS THEN NULL; END;

  ORDS.DEFINE_MODULE(
    p_module_name => 'arkia.api',
    p_base_path   => 'api/',
    p_status      => 'PUBLISHED',
    p_comments    => 'Arkia bookings REST API');

  -- ping (GET, query — בדיקת חיים בדפדפן)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'ping');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'ping', p_method=>'GET',
    p_source_type=>ORDS.source_type_query,
    p_source=>q'[SELECT 'ok' AS status, 'arkia-api' AS service FROM dual]');

  -- login (POST)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'login');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'login', p_method=>'POST',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.login(:username, :password)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');

  -- bootstrap (POST)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'bootstrap');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'bootstrap', p_method=>'POST',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.bootstrap(:token)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');

  -- bookings (POST = list)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'bookings');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'bookings', p_method=>'POST',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.list_bookings(:token)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');

  -- bookings/create (POST)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'bookings/create');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'bookings/create', p_method=>'POST',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.create_booking(:token, :departure, :price, :currency, :agent_id, :notes)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');

  -- bookings/get (POST = detail)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'bookings/get');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'bookings/get', p_method=>'POST',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.get_booking(:token, :id)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');

  -- bookings/action (POST = workflow)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'bookings/action');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'bookings/action', p_method=>'POST',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.do_action(:token, :id, :action, :price, :currency, :trip, :notes, :pnr, :ref, :tdate, :reason)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');

  -- notifications (POST = list)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'notifications');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'notifications', p_method=>'POST',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.notifications(:token)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');

  -- notifications/read (POST)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'notifications/read');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'notifications/read', p_method=>'POST',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.mark_read(:token)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');

  -- files/upload (POST)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'files/upload');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'files/upload', p_method=>'POST',
    p_source_type=>ORDS.source_type_plsql,
    p_source=>q'[BEGIN api_pkg.emit(api_pkg.add_file(:token, :booking_id, :kind, :filename, :mime, :data)); EXCEPTION WHEN OTHERS THEN api_pkg.emit(api_pkg.err(SQLERRM)); END;]');

  -- files/:id (GET, media — הורדה/תצוגה של קובץ)
  ORDS.DEFINE_TEMPLATE(p_module_name => 'arkia.api', p_pattern => 'files/:id');
  ORDS.DEFINE_HANDLER(p_module_name=>'arkia.api', p_pattern=>'files/:id', p_method=>'GET',
    p_source_type=>ORDS.source_type_media,
    p_source=>q'[SELECT NVL(mime_type,'application/octet-stream') AS content_type, file_blob FROM booking_files WHERE file_id = :id]');

  COMMIT;
END;
/


--------------------------------------------------------------------------------
-- מיתוג: ודא שם הסוכן הנכון (טלטוס) בנתונים החיים — idempotent, רץ בכל פריסה
--------------------------------------------------------------------------------
BEGIN
  UPDATE app_users SET username='teltos', full_name='טלטוס - סוכן נסיעות' WHERE username='toustous';
  UPDATE app_users SET full_name='טלטוס - סוכן נסיעות' WHERE username='teltos';
  UPDATE agents SET agency_name='טלטוס - מנועי חיפוש טיסות' WHERE agency_name LIKE 'טוסטוס%' OR agency_name LIKE 'טלטוס%';
  COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

PROMPT ✔ install_api.sql — שכבת ה-REST הותקנה. בסיס: /ords/arkia/api/
