# Node server skeleton (Express + PostgreSQL)

Runnable skeleton of the booking backend. It serves the SPA and the REST API.
Core paths are implemented; a few are stubs marked `not_implemented` (TODO) — port
the remaining logic from `../ENDPOINTS.md` and the Oracle `bookings/api/install_api.sql`.

## Run locally
```bash
cd server
cp .env.example .env            # fill DATABASE_URL, SMTP_*, APP_BASE_URL
npm install
# make sure the DB is created & seeded (see ../schema.postgres.sql, ../seed.postgres.sql)
npm start                       # http://localhost:8080/api/app
```

## Run with Docker (from the port-kit/ dir, so spa/ is in the build context)
```bash
docker build -f Dockerfile -t arkia-bookings .
docker run --env-file server/.env -p 8080:8080 arkia-bookings
```

## Layout
- `src/server.js` — app bootstrap, static SPA/assets/sw, tracking pixel, route mounting.
- `src/db.js` — pg pool + `q`/`one` helpers.
- `src/auth.js` — session tokens, bcrypt password hash/verify, `requireAuth`/`requireAdmin`.
- `src/mail.js` — nodemailer transport, `sendTracked` (logs email_log + pixel), `markOpened`.
- `src/routes/public.js` — **login (full: lockout + attempt log + admin alert)**, bootstrap, act-from-email (TODO), logout.
- `src/routes/bookings.js` — **workflow engine** (changeStatus + template notifications), list/get/create/action, files; edit + agent urgent-quote are TODO.
- `src/routes/notifications.js` — bell list/read + email opt-out.
- `src/routes/admin.js` — users/create(+welcome mail)/logins/attempts/emaillog/usage/dept-approvers/depts/airports/wetops/setpw; user update/delete + resetpw are TODO.

## Implemented vs TODO
**Implemented:** auth + 30-day sessions, login brute-force lockout + security email,
bootstrap, bookings list/detail (with `can_approve`), create (+open-pool email),
workflow transitions (quote/approve/reject/ticket/cancel) with template-driven
notifications + emails, approve-token emails to all dept approvers, file
upload/download, read-tracking pixel, admin user-create with welcome email, and the
security/monitoring + reference-data admin endpoints.

**TODO (stubs return `not_implemented`):** `bookings/edit`, `agent/quote/create`
(urgent), `admin/user/update`, `admin/user/delete`, `admin/resetpw`, and
`GET /api/act` (approve-from-email page). Each has a one-line pointer in code.

## Notes
- Passwords use **bcrypt** (replaces the Oracle salt+hash). The seeded `admin` user
  has no password until you set one via `admin/setpw` or create a fresh admin.
- Replace `emailHtml()` in `bookings.js` with the full branded template if you want
  parity with the Oracle emails (Arkia+Teltos header, full detail table).
- Put real secrets in the org secret store / env, never in the image or Git.
