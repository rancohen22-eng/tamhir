# SECRETS-INVENTORY

Report only — **no secret values are printed here, and nothing was changed.** This
lists *where* a secret/credential is referenced, the field/parameter name, and the
service it belongs to. Most are **placeholders or external references** (the real
values live outside the repo, in GitHub Secrets / OCI / the runtime config). Items
flagged ⚠️ are things to remediate before portal go-live.

## 1. GitHub Actions Secrets (stored in GitHub, referenced by CI)
| Where (file) | Field / name | Service | Notes |
|---|---|---|---|
| `.github/workflows/deploy-bookings.yml` | `secrets.DB_WALLET_BASE64` | Oracle ADB wallet | Referenced only; value in GitHub Secrets. Written to `wallet.zip` at build time. |
| `.github/workflows/deploy-bookings.yml` | `secrets.DB_PASSWORD` | Oracle DB (schema `ARKIA`) password | Referenced only; value in GitHub Secrets. |
| `.github/workflows/deploy-bookings.yml` | `vars.DB_USER`, `vars.DB_CONN` | Oracle DB user / TNS alias | Non-secret config (GitHub *Variables*), default `ARKIA` / `arkiabkg_high`. |
| `.github/workflows/prod-reset.yml` | `secrets.DB_WALLET_BASE64`, `secrets.DB_PASSWORD`, `vars.DB_USER`, `vars.DB_CONN` | Oracle DB | Same references as above, for the manual reset job. |

## 2. SMTP / OCI Email Delivery credentials (placeholders in repo)
| Where (file) | Field / name | Service | Notes |
|---|---|---|---|
| `bookings/deploy/email_setup.sql` | `SMTP_USERNAME` parameter | OCI Email Delivery SMTP | **Placeholder** `<SMTP_USERNAME>` — real value entered at setup time in the DB (APEX instance params), not in the repo. |
| `bookings/deploy/email_setup.sql` | `SMTP_PASSWORD` parameter | OCI Email Delivery SMTP | **Placeholder** `<SMTP_PASSWORD>`. Real value stored in the DB only. |
| `bookings/deploy/email_setup.sql` | `SMTP_FROM` parameter | Approved-sender address | Not a secret (an email address). |

## 3. Application password handling (DB-stored hashes, not plaintext)
| Where | Field / name | Service | Notes |
|---|---|---|---|
| `bookings/db/01_tables.sql` (`app_users`) | `password_hash`, `password_salt` | App login | User passwords stored as **salted SHA-256** in the DB (no plaintext). ⚠️ SHA-256 is a fast hash — recommend bcrypt/argon2 (port-kit already uses bcrypt). |
| `bookings/db/03_booking_pkg.sql`, `bookings/db/02_seed.sql`, `bookings/db/install_all.sql` | default temporary-password **string literal** | Initial/seed accounts | ⚠️ A hard-coded default temp password is used to seed demo/initial users and as the fallback in `admin_create_user`. **Value not printed here.** Remove/rotate before go-live. |
| `bookings/README.md` | demo-credentials note | Docs | ⚠️ README documents the demo accounts and default password string. Scrub before publishing. |

## 4. Port-kit (self-host) credential references (placeholders)
| Where (file) | Field / name | Service | Notes |
|---|---|---|---|
| `port-kit/server/.env.example` | `DATABASE_URL` | PostgreSQL | **Placeholder** (`CHANGEME`). Real value belongs in the host env / secret store. |
| `port-kit/server/.env.example` | `SMTP_USER`, `SMTP_PASS` | Internal SMTP | Empty placeholders. |
| `port-kit/server/src/db.js` | reads `process.env.DATABASE_URL` | PostgreSQL | No value in code. |
| `port-kit/server/src/mail.js` | reads `process.env.SMTP_USER/SMTP_PASS` | SMTP | No value in code. |

## 5. Unrelated apps (not part of this system, listed for completeness)
| Where | Field / name | Notes |
|---|---|---|
| `loans/rekey.mjs` | `<username> <password>` CLI args | Loans app key-derivation tool; credentials are passed as runtime arguments, **not embedded**. |

## Findings summary (no values shown)
- **No live secret values were found committed** in the repo — DB/SMTP credentials are
  GitHub Secrets or `<placeholders>`; passwords are stored hashed.
- ⚠️ **Default temporary-password literal** present in seed/package/README files — remove/rotate.
- ⚠️ **Salted SHA-256** for passwords — upgrade to bcrypt/argon2 for the portal build.
- For the portal, per the stated rules, **no DB password should exist in code at all**
  (SQL Server **Windows authentication**), and SMTP/other secrets should come from the
  portal's configuration/secret store — see `PORTAL-COMPLIANCE-PROPOSAL.md`.
