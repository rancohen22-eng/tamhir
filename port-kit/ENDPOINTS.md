# API & business-logic spec — self-hosted Node port

Rebuild the backend as a small Node (Express/NestJS) service that exposes the
endpoints below and serves the SPA. This replaces the Oracle PL/SQL packages
(`api_pkg`, `booking_pkg`) and ORDS. Every endpoint below maps 1:1 to an ORDS
handler in the original `bookings/api/install_api.sql` — read that file for the
exact SQL when porting a specific rule.

## Conventions
- **Transport:** all app calls are `POST` with `application/x-www-form-urlencoded`
  bodies (the SPA already does this). Media endpoints are `GET`.
- **Auth:** every call except `login`, `act`, `track`, `app`, `assets`, `sw`
  takes a `token` field. Resolve it against `api_sessions` where
  `expires_at > now()`; else return `{ok:false,error:"invalid_or_expired_token"}`.
- **Response:** JSON `{ok:true, ...}` or `{ok:false, error:"<code>"}`. Never throw
  to the client — catch and return `ok:false`.
- **Passwords:** store with **bcrypt or argon2** (replaces Oracle salt+hash).
  `authenticate` = compare. Enforce **min length 8** on create/set.
- **Tokens:** session token = 32 hex bytes; action/pixel tokens = longer random.
- **Email:** send via **internal SMTP/Exchange** (nodemailer). Every HTML email
  embeds a tracking pixel `<img src="<BASE>/track?t=TOKEN" width=1 height=1>` and
  a row in `email_log`. See "Email" below.

## Auth & bootstrap
- `POST /api/login` {username,password}
  1. `ip = X-Forwarded-For || remoteAddr`.
  2. **Lockout:** if `COUNT(login_attempts WHERE username=? AND success='N' AND attempted_at > now()-15min) >= 5` → log a failed attempt, return `error:"locked"`.
  3. authenticate; on fail → insert failed attempt; if that failure makes the count hit exactly 5 → email all ADMINs ("account locked"); return `error:"bad_credentials"`.
  4. on success → insert success attempt + `login_log`; create `api_sessions` row (expires now()+30d); return `{ok,token,user:{id,username,full_name,dept_id,pref_lang,notify_email},roles:[...],agent_id}`.
- `POST /api/bootstrap` {token} → `{departments[], currencies[], statuses[{code,he,en,terminal}], wet_operators[], airports[{iata,name_he,name_en,country}]}` (active rows only).

## Bookings
- `POST /api/bookings` {token} → list visible to the caller (initiator sees own dept; agents see pool/assigned; finance/admin see all). Include `low_cost`, `urgent`, route, updated-by.
- `POST /api/bookings/get` {token,id} → full booking + `files[]` + `log[]` (timeline) + **`can_approve`** ('Y' if caller is ADMIN, pinned approver, or in `dept_approvers` for the booking's dept).
- `POST /api/bookings/create` {token,departure,notes,pax,pref_time,wet_op,origin,dest} → insert booking (dept from initiator), status `AWAITING_QUOTE`, approver_id = first dept approver; then **notify_agents** (email every active agent — open pool). Returns `{id}`.
- `POST /api/bookings/action` {token,id,action,price,currency,trip,notes,pnr,ref,tdate,reason,low_cost} — action ∈:
  - `submit_quote`: assign caller's agent if unassigned; set `low_cost`; set price/currency/trip/notes; status→`QUOTE_RECEIVED`; **notify_approver_quote** (email every dept approver, each with own approve token).
  - `approve` / `reject`: **guard** — caller must satisfy `can_approve`, else `forbidden`. status→`APPROVED`/`REJECTED`.
  - `ticket`: set pnr, ticketing_date=today; status→`TICKETED`.
  - `request_cancel`: if current status `TICKETED` → status→`CANCEL_REQUESTED` (two-step, agent must confirm); else → immediate `CANCELLED`.
  - `confirm_cancel`: status→`CANCELLED`.
- `POST /api/bookings/edit` {token,id,departure,agent_id,notes,pax,pref_time,wet_op,origin,dest} — allowed for initiator, ADMIN, or any dept approver; blocked once TICKETED/CANCELLED/REJECTED.
- `POST /api/agent/quote/create` {token,dept_id,departure,pax,pref_time,origin,dest,price,currency,trip,notes,low_cost} — AGENT only; opens a booking directly at `QUOTE_RECEIVED`, `urgent='Y'`, approver=first dept approver; notify_approver_quote.

## Files
- `POST /api/files/upload` {token,booking_id,kind,filename,mime,data(base64)} → store bytea. kind ∈ QUOTE_SCREENSHOT/FINAL_TICKET/OTHER.
- `GET /api/files/:id` → stream the file (content-type from mime).

## Workflow engine (replaces booking_pkg.change_status)
On every status change: (1) update `bookings.status`; (2) insert `booking_status_log`
(from,to,action_by,note); (3) for each row in `notif_templates WHERE status_code=<new>`,
resolve recipients by `recipient_role` and insert a `notifications` row + send email
(honor `notify_email='N'` → bell only). Recipient resolution:
- `AGENT` → the booking's assigned agent's user.
- `INITIATOR` → `initiator_id`.
- `APPROVER` → **all** users in `dept_approvers` for the booking's dept **∪** pinned `approver_id`.
`%ID%` in templates → booking id. Recipient language from `app_users.pref_lang`.

Two direct emails outside the template loop:
- **notify_agents** (on create): email every active agent (open pool).
- **notify_approver_quote** (on quote submit / urgent): email every dept approver,
  each with a one-time `booking_action_tokens` row (action='approve', 7-day expiry)
  → approve-from-email link `<BASE>/act?t=TOKEN`.

## Approve / track from email (anonymous)
- `GET /api/act?t=TOKEN` → validate token (exists, not expired, not used); perform
  `approve`; mark used; return a small branded HTML confirmation page. Idempotent.
- `GET /api/track?t=TOKEN` → set `email_log.opened='Y', opened_at=coalesce(opened_at,now()), open_count+1`; return a 1×1 transparent GIF. **Read-tracking is best-effort only** (Apple MPP / image blocking).

## Notifications
- `POST /api/notifications` {token} → caller's notifications (newest first).
- `POST /api/notifications/read` {token} → mark all read.
- `POST /api/notify/set` {token,on} → set caller's `notify_email`.

## Admin (all guarded: caller must have ADMIN role)
- `POST /api/admin/users` → list users (+roles, dept, email).
- `POST /api/admin/user/create` {username,full,email,dept_id,role,password} → create user (+role, +agent row if AGENT, +dept_approver if APPROVER). **min password 8** else `weak_password`. Then **send branded welcome/login email** (username + temp password + link) and return `{emailed:true|false}`.
- `POST /api/admin/user/update` {user_id,full,email,dept_id,is_active}
- `POST /api/admin/user/delete` {user_id} — blocked if FK-referenced by bookings (clear message).
- `POST /api/admin/resetpw` {user_id} → generate temp password, set it, **email it** to the user; return emailed flag.
- `POST /api/admin/setpw` {username,password} → set password (min 8 else `weak_password`).
- `POST /api/admin/dept/create` {code,name_he,name_en}
- `POST /api/admin/dept/update` {dept_id,code,name_he,name_en} — edit department name/code.
- `POST /api/admin/dept_approvers` → list all (dept_id,user_id,name) — multiple per dept.
- `POST /api/admin/dept_approver/set` {dept_id,user_id} → **add** approver (grant APPROVER role; backfill null approver_id on open bookings of that dept).
- `POST /api/admin/dept_approver/del` {dept_id,user_id} → remove; null out that approver on open bookings of the dept.
- `POST /api/admin/airports` → list all airports (incl. inactive).
- `POST /api/admin/airport/save` {iata,name_he,name_en,country,is_active} → upsert.
- `POST /api/admin/wetop/create` {name_he,name_en}
- `POST /api/admin/logins` → recent successful logins.
- `POST /api/admin/attempts` → recent login attempts (username, ip, success, time).
- `POST /api/admin/emaillog` → sent emails + read status (recipient, kind, subject, booking_id, sent, opened, opened_at, open_count).
- `POST /api/admin/usage` → `{storage_gb, storage_limit_gb, emails_month, emails_limit}` (reinterpret for the internal DB/host: e.g. `pg_database_size`, and count rows in `email_log` this month).

## Static (serve the SPA)
- `GET /api/app` → the SPA HTML (`bookings/app/index.html`), content-type text/html.
- `GET /api/assets/:name` → logos (arkia svg, teltos jpeg, appicon png), manifest, guide html, sw js.
- `GET /api/sw` → service worker JS.

## SPA change needed (only one)
In `bookings/app/index.html` set `const API = '<internal base>/api/';` (currently
points to the Oracle ORDS URL). Everything else (session persistence in
localStorage, WebAuthn biometric local-gate, airport combobox, admin screens)
works unchanged — it's all client-side.

## Security notes carried over
- Passwords: hashed (bcrypt/argon2), never returned or logged.
- Brute-force: 5 failed/15 min lockout + admin email + attempt log with IP.
- Approve/reject authorization enforced **server-side** (not just UI).
- One-time, expiring tokens for email actions.
- Put SMTP creds / DB creds in environment variables / the org secret store — never in code.
