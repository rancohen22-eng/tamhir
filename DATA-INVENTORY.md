# DATA-INVENTORY — personal / sensitive data

Report only. Lists **field names** of personal or sensitive data, where it is stored
today, and who can access it. No data values are shown; nothing was changed.

## Where data lives today
All application data is in the **Oracle Autonomous Database** (schema `ARKIA`).
Email bodies/attachments also transit the **OCI Email Delivery** relay and land in
recipients' mailboxes. (The `port-kit` target would store the same data in
**PostgreSQL**.)

## Personal data (people)
| Field(s) | Table | Sensitivity | Who can access |
|---|---|---|---|
| `full_name`, `username` | `app_users` | Personal (identity) | All signed-in users see names in bookings/timeline; full user list = **ADMIN** only. |
| `email` | `app_users`, `agents.contact_email` | Personal (contact) | ADMIN (user admin); also used as email recipient by the system. |
| `contact_phone` | `agents` | Personal (contact) | ADMIN. |
| `password_hash`, `password_salt` | `app_users` | **Credential** (hashed) | No user-facing access; DB only. Never returned by the API. |
| `ip` | `login_attempts` | Personal (network identifier) | **ADMIN** (login-log screen). Captured on each login attempt. |
| `username`, `login_at` | `login_log` | Activity/personal | **ADMIN**. |
| `recipient` (email), `subject`, `opened`, `opened_at` | `email_log` | Personal + behavioral (email open tracking) | **ADMIN** (email-log screen). ⚠️ Open-tracking is a privacy-relevant behavioral signal. |
| `action_by`, `action_at` + `note` | `booking_status_log` | Activity (who did what, when) | Visible to users who can open the booking. |
| `user_id`, `message` | `notifications` | Personal (per-user messages) | The target user; ADMIN via DB. |
| sender/recipient addresses, booking details, **attachments** | outbound **email** (OCI relay + mailboxes) | Personal + business | Anyone with the email; outside the app's access control once sent. |

## Business / commercial-sensitive data
| Field(s) | Table | Sensitivity | Who can access |
|---|---|---|---|
| `price`, `currency_code`, `quote_notes`, `trip_details` | `bookings` | Commercial (pricing) | Department members, the assigned agent, approvers; **FINANCE/ADMIN** see all. |
| `pnr`, `unique_booking_ref`, `ticketing_date` | `bookings` | Booking identifiers (sensitive — a PNR can expose a passenger's reservation) | Same as above. |
| `file_blob`, `filename`, `mime_type` (quote screenshots, **ticket documents**) | `booking_files` | Business + possibly personal (ticket docs may contain passenger details) | Users who can open the booking; downloadable via `GET /files/:id`. |
| `pax_count`, `pref_time`, route (`origin_iata`/`dest_iata`) | `bookings` | Business | Department members / agents / approvers. |
| one-time approve tokens | `booking_action_tokens` | Sensitive (grant action without login) | Emailed to approvers; single-use, 7-day expiry. |
| session tokens | `api_sessions` | **Credential** (bearer) | Held by the signed-in client (localStorage); DB only otherwise. |

## Access-control model (today)
- Access is by **application role** (ADMIN / INITIATOR / APPROVER / AGENT / FINANCE),
  enforced server-side in PL/SQL; row visibility is by department / agent assignment;
  approve/reject is restricted to a department's approvers (or ADMIN).
- There is **no portal/domain SSO yet** — the app has its own username/password login.
  (The portal requires domain sign-in with no separate login — see the proposal.)

## Notes / flags for the portal review
- `GET /api/files/:id` currently streams an attachment **without re-checking** that the
  caller may see that booking — review for the portal (attachments can hold passenger
  data). ⚠️
- `ip` capture and **email open-tracking** are privacy-relevant — confirm they are
  acceptable under the portal/organization policy, and covered by the activity-log and
  retention rules.
- Ticket documents / PNRs may constitute **passenger personal data** even though the
  app's own users are staff — treat `booking_files` and `pnr` as sensitive.
- No special-category data (health, biometric templates, government IDs) is stored. The
  "biometric" login keeps **no biometric data** server-side (device-local WebAuthn).
