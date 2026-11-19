# PORTAL-COMPLIANCE-PROPOSAL (proposal only — nothing implemented)

What must change for this system ("Telegal") to comply with `PORTAL-RULES.md` and run
as a **Finance** sub-system of Arkia's internal portal. **No code was changed.** The
health endpoint (§2) will be added **only after your approval** (per the task).

> ⚠️ **Caveat:** the authoritative `_portal/PORTAL-RULES.md` and
> `_portal/PortalAuditMiddleware.cs` are **not in this repo**, so this proposal is based
> on the rule summary in the task. Please drop `_portal/` into the repo (or confirm the
> inline rules are authoritative) before implementation so signatures/paths match exactly.

## 0. Platform note (important)
The portal rules imply a **.NET stack**: SQL Server, Windows authentication, and a C#
`PortalAuditMiddleware.cs`. Neither current asset matches it:
- the **production** system is Oracle PL/SQL + ORDS + SPA;
- the **port-kit** is Node/Express + PostgreSQL.

**Recommendation:** build the portal sub-system as an **ASP.NET Core** app on **SQL
Server**, reusing the existing **front-end SPA as-is** (it is framework-agnostic) and
porting the server logic from `port-kit/ENDPOINTS.md` + `schema.postgres.sql` to EF
Core + T-SQL. Decide this first — the items below assume an ASP.NET Core host.

## 1. Base path `/Finance/Telegal/` (test: `/Finance/Telegal-Test/`)
- Host the app under `PathBase = /Finance/Telegal` (read from config, not hard-coded),
  so the same build serves the test copy under `/Finance/Telegal-Test/`.
- **All URLs must be relative** — never a leading `/`. Changes required:
  - SPA `const API` must become **relative** (e.g. `./api/` or derived from the page
    location), replacing today's absolute ORDS URL.
  - The manifest/service-worker `start_url`/`scope`, asset `<img src>` and email links
    (`g_app_url`, approve links, tracking-pixel `src`) must be built from a configured
    base, not `/ords/...` or `/`.
  - Serve static assets and API under the same base; avoid any `location.pathname='/'`.
- **Action:** audit `bookings/app/index.html`, `gen_ui.py` (manifest/SW), and the email
  URL builders for any `/`-rooted path.

## 2. Health endpoint (add only after approval)
- `GET /api/health` → **HTTP 200**, body `{"ok":true,"version":"..."}`.
- **No authentication**, **no sensitive data** (version string only; the version comes
  from `deploy-info.json` → `sourceSig`/app version, see §4).
- Must be reachable at `/Finance/Telegal/api/health` and `/Finance/Telegal-Test/api/health`.
- **Proposed only — not added.** On approval, add one trivial anonymous action/route.

## 3. Database — SQL Server, Windows auth, config-driven name
- Target **SQL Server**, instance `localhost\FINANCE`, **Integrated Security
  (Windows authentication) only** — **no username/password in code or config**.
- **DB name from configuration**, never hard-coded:
  - production → `FINANCE_TELEGAL`
  - test → `FINANCE_TELEGAL_TEST`
  - e.g. connection string `Server=localhost\FINANCE;Database=<name-from-config>;Integrated Security=true;Encrypt=...`.
- **Migrations embedded in the application** (e.g. EF Core migrations run on startup),
  replacing the current SQLcl/GitHub-Actions deploy of SQL scripts. Port the schema from
  `port-kit/schema.postgres.sql` to T-SQL (adjust identity/`bytea`→`varbinary(max)`/
  `jsonb`→`nvarchar(max)`/`timestamptz`→`datetime2`).
- **Remove** the Oracle wallet + `DB_PASSWORD` GitHub Secrets path for this deployment.

## 4. Test environment — banner + deploy info
- Read `Telegal:Environment` from config. When = **`Test`**, show a **red banner** at the
  top of every page; banner **text from `Telegal:Banner`** (config).
- Read the running **version and deployment time** from **`deploy-info.json`** in the
  application folder: fields **`deployedAt`** and **`sourceSig`**. Surface `sourceSig`
  (or app version) in the health endpoint's `version` and optionally in the banner.
- **Action:** add a small server-rendered flag (or a `GET /api/env` that returns
  `{environment, banner, version, deployedAt}` from config + `deploy-info.json`) and have
  the SPA render the banner when `environment==='Test'`.

## 5. Sample data (test only)
- Add **`Db/seed/test-sample.sql`** that inserts **fabricated (not real)** data into the
  tables created by the migrations (departments, users, agents, airports, a few
  bookings + files + timeline). Clearly label rows as sample (e.g. names like
  "Test Initiator", obviously fake PNRs/prices, `example.test` emails).
- Wire it to the **"Sample data" button** that appears **only in the test environment**.
  Guard server-side so it can run **only when `Telegal:Environment=Test`** and only
  against `FINANCE_TELEGAL_TEST`.

## 6. Activity log
- Use **`_portal/PortalAuditMiddleware.cs`** (register it in the ASP.NET Core pipeline)
  with **`sys = "telegal"`**.
- Replace/complement the app's own `login_log`/`login_attempts`/`email_log` reporting so
  that portal-level activity is logged through the shared middleware (keep the in-app
  security screens as a convenience, but the system of record for activity is the portal
  audit log).
- **Action depends on the middleware's exact API** — needs the real `_portal/` file.

## 7. Permissions — portal domain sign-in (no separate login)
- Identify the user via the **portal's domain sign-in** (Windows/AD identity passed from
  the portal) — **remove the app's own login screen, password storage, session tokens,
  and brute-force lockout** for the portal build.
- Map the domain identity → application role (ADMIN/INITIATOR/APPROVER/AGENT/FINANCE)
  via a mapping table or portal group claims.
- **Impact:** drop `app_users.password_hash/salt`, `api_sessions`, `login_attempts`,
  the biometric gate, and the login/lockout endpoints. Keep the role model and
  `dept_approvers`. External agent ("Teltos") stays **email-only** (approve-from-email),
  since an external party has no domain account.

## Summary of required changes (for Gil / IT)
1. Decide the stack → **ASP.NET Core + SQL Server** (reuse SPA; port logic from the port-kit spec).
2. Make **all front-end/email URLs relative**; host under `/Finance/Telegal[-Test]/`.
3. **SQL Server + Windows auth**, DB name from config, **EF migrations in-app**.
4. **`GET /api/health`** (anonymous, `{ok,version}`) — add after approval.
5. **Test banner** from `Telegal:Environment`/`Telegal:Banner`; version/time from `deploy-info.json`.
6. **`Db/seed/test-sample.sql`** (fabricated) + test-only "Sample data" button.
7. **`PortalAuditMiddleware.cs`** with `sys=telegal` for activity logging.
8. **Domain sign-in**; remove the app's own auth; map identity → role.
9. Remediate: remove default-password literal + demo creds from docs; bcrypt/argon2 if any local auth remains; re-check `files/:id` authorization.

### Blocked pending `_portal/`
- Reading `PORTAL-RULES.md` (exact wording of the mandatory rules).
- `PortalAuditMiddleware.cs` signature (how to register, what `sys` expects).
- `Pack-Zip.cmd` (the packaging step requested at the end) — **cannot be run; it is not
  present**, and it is a Windows `.cmd` (this environment is Linux).
