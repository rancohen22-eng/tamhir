# Port kit — Arkia / Teltos flight-booking system → self-hosted (internal)

This folder is a **self-contained handoff** to rebuild the booking system on the
organization's own infrastructure — **no Oracle, no OCI, no GitHub, no external
SaaS**. Move this folder into the internal Git and continue from it (e.g. with
enterprise Claude). It carries everything needed to re-platform.

## What the system is
Internal, multi-user, Hebrew-RTL flight-booking tracker for Arkia (external agent
= Teltos). Lifecycle: initiator opens a request → open pool to agents → agent
quotes → department approver(s) approve → agent tickets. Plus attachments,
audit timeline, finance dashboard, bilingual email notifications with
approve-from-email, login hardening, and an email read-log. Full feature list is
in `ENDPOINTS.md`.

## Target stack (chosen: self-hosted server)
- **DB:** PostgreSQL 14+ on an internal VM.
- **Backend + app server:** Node.js (Express or NestJS) — serves the REST API and
  the SPA.
- **Email:** nodemailer → the organization's **internal SMTP / Exchange** relay.
- **Hosting:** Docker behind an internal reverse proxy (nginx) with TLS from the
  internal CA.
- **Source/CI:** the organization's internal Git (Azure DevOps / GitLab).

## Contents
| File | Purpose |
|---|---|
| `schema.postgres.sql` | Full DB schema (translated from Oracle). Run first. |
| `seed.postgres.sql` | Reference data: roles, statuses, notif templates, currencies, wet operators, admin user. |
| `airports.csv` | 88 destinations — `\copy` into `airports` (see seed file). |
| `ENDPOINTS.md` | **The build spec**: every REST endpoint + the workflow, notification, auth and tracking logic. |
| `spa/index.html` | The front-end SPA (unchanged — only the `API` base URL needs editing). |
| `spa/guide.html`, `spa/assets/` | In-app user guide + branding (Arkia + Teltos logos, app icon). |

## Build steps (short)
1. `createdb arkia && psql -d arkia -f schema.postgres.sql`
2. `psql -d arkia -f seed.postgres.sql` then
   `psql -d arkia -c "\copy airports(iata,name_he,name_en,country) FROM 'airports.csv' WITH (FORMAT csv, HEADER true)"`
3. Build the Node service per `ENDPOINTS.md` (routes map 1:1 to the old ORDS
   handlers). Use **bcrypt/argon2** for passwords, **nodemailer** for mail.
4. In `spa/index.html` set `const API = '<internal base>/api/';`. Serve the SPA
   and `assets/` from the Node app (`GET /api/app`, `GET /api/assets/:name`).
5. Dockerize; put behind internal reverse proxy + TLS; deploy on an internal VM;
   push to internal Git + CI.
6. Create the first real admin (or reuse the seeded `admin` user) and set its
   password through the app.

## Reference (Oracle original, for exact rules)
The authoritative logic lives in the Oracle sources this was ported from:
- `bookings/api/install_api.sql` — all endpoints + business logic (PL/SQL).
- `bookings/db/03_booking_pkg.sql` — workflow engine, email HTML, auth, pixel.
- `bookings/db/01_tables.sql`, `bookings/db/02_seed.sql` — schema + seed.
When a rule is ambiguous in `ENDPOINTS.md`, read the matching function there.

## Secrets (never commit)
DB URL/password, SMTP host/user/password → environment variables / the org secret
store. Nothing sensitive belongs in this kit or in Git.

## What is intentionally out of scope here
- Oracle/ORDS/OCI deploy workflow (replaced by internal CI).
- GitHub Actions (`.github/workflows/*`) — not used internally.
- WebAuthn biometric is a client-side local gate in the SPA; it needs no backend.
