-- =============================================================================
-- Seed reference data (PostgreSQL). Run after schema.postgres.sql.
--   psql -f seed.postgres.sql
-- Airports: imported from airports.csv (88 rows) — see \copy at the bottom.
-- =============================================================================

-- roles
INSERT INTO roles(role_code,name_he,name_en) VALUES
 ('ADMIN','מנהל מערכת','Administrator'),
 ('INITIATOR','מזמין','Initiator'),
 ('APPROVER','מאשר','Approver'),
 ('AGENT','סוכן','Agent'),
 ('FINANCE','כספים','Finance')
ON CONFLICT DO NOTHING;

-- currencies
INSERT INTO currencies(code,name_he,name_en,symbol,is_default) VALUES
 ('USD','דולר','US Dollar','$','Y'),
 ('EUR','אירו','Euro','€','N'),
 ('ILS','שקל','Shekel','₪','N')
ON CONFLICT DO NOTHING;

-- statuses
INSERT INTO statuses(status_code,label_he,label_en,sort_order,is_terminal) VALUES
 ('NEW','נפתחה','New',0,'N'),
 ('AWAITING_QUOTE','ממתין להצעת מחיר','Awaiting Quote',10,'N'),
 ('QUOTE_RECEIVED','הצעה התקבלה','Quote Received',20,'N'),
 ('APPROVED','אושר','Approved',30,'N'),
 ('TICKETED','כורטס','Ticketed',40,'Y'),
 ('CANCEL_REQUESTED','בקשת ביטול','Cancel Requested',50,'N'),
 ('REJECTED','נדחה','Rejected',90,'Y'),
 ('CANCELLED','בוטל','Cancelled',99,'Y')
ON CONFLICT DO NOTHING;

-- notification templates (status × recipient role). %ID% replaced with booking id.
INSERT INTO notif_templates(status_code,recipient_role,subject_he,subject_en,msg_he,msg_en) VALUES
 ('AWAITING_QUOTE','AGENT','בקשה חדשה להצעת מחיר','New quote request','התקבלה בקשה חדשה להצעת מחיר עבור הזמנה #%ID%.','A new quote request was received for booking #%ID%.'),
 ('QUOTE_RECEIVED','INITIATOR','התקבלה הצעה מהסוכן','Quote received from agent','הסוכן הגיש הצעת מחיר עבור הזמנה #%ID%.','The agent submitted a quote for booking #%ID%.'),
 ('APPROVED','AGENT','אישור לכרטוס','Approved for ticketing','הזמנה #%ID% אושרה — ניתן לכרטס.','Booking #%ID% was approved — you may issue the ticket.'),
 ('APPROVED','INITIATOR','ההזמנה אושרה','Booking approved','הזמנה #%ID% אושרה ע"י הגורם המאשר.','Booking #%ID% was approved by the approver.'),
 ('TICKETED','INITIATOR','ההזמנה כורטסה','Booking ticketed','הזמנה #%ID% כורטסה. מסמך הכרטוס זמין לצפייה.','Booking #%ID% was ticketed. The ticket document is available.'),
 ('TICKETED','APPROVER','ההזמנה כורטסה','Booking ticketed','הזמנה #%ID% כורטסה.','Booking #%ID% was ticketed.'),
 ('REJECTED','INITIATOR','ההזמנה נדחתה','Booking rejected','הזמנה #%ID% נדחתה ע"י הגורם המאשר.','Booking #%ID% was rejected by the approver.'),
 ('REJECTED','AGENT','ההזמנה נדחתה','Booking rejected','הזמנה #%ID% נדחתה.','Booking #%ID% was rejected.'),
 ('CANCEL_REQUESTED','AGENT','התקבלה בקשת ביטול','Cancellation requested','התקבלה בקשת ביטול עבור הזמנה #%ID% — נדרש אישורך.','A cancellation was requested for booking #%ID% — your confirmation is required.'),
 ('CANCEL_REQUESTED','APPROVER','התקבלה בקשת ביטול','Cancellation requested','הוגשה בקשת ביטול עבור הזמנה #%ID%.','A cancellation was requested for booking #%ID%.'),
 ('CANCELLED','INITIATOR','הביטול אושר ע"י הסוכן','Cancellation confirmed by agent','ביטול הזמנה #%ID% אושר ע"י הסוכן.','Cancellation of booking #%ID% was confirmed by the agent.'),
 ('CANCELLED','APPROVER','הביטול אושר ע"י הסוכן','Cancellation confirmed by agent','ביטול הזמנה #%ID% אושר ע"י הסוכן.','Cancellation of booking #%ID% was confirmed by the agent.')
ON CONFLICT DO NOTHING;

-- wet operators (ACMI)
INSERT INTO wet_operators(name_he,name_en) VALUES
 ('פליי-לילי','Flylili'),('הייפליי','HiFly'),('גוליבר','Gulliver'),
 ('אלקטרה','Electra'),('נאוס','Neos')
ON CONFLICT DO NOTHING;

-- initial admin user (set the password via the app, not here — hash in app layer)
INSERT INTO app_users(username,full_name,email,pref_lang,is_active)
 VALUES ('admin','System Admin','admin@arkia.co.il','HE','Y')
ON CONFLICT (username) DO NOTHING;
INSERT INTO user_roles(user_id,role_code)
 SELECT user_id,'ADMIN' FROM app_users WHERE username='admin'
ON CONFLICT DO NOTHING;

-- airports (88) — import the CSV that ships with this kit:
--   \copy airports(iata,name_he,name_en,country) FROM 'airports.csv' WITH (FORMAT csv, HEADER true)
-- (city_he/city_en can be backfilled = name_he/name_en if needed)
