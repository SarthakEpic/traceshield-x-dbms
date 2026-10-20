# TraceShield X Operations Runbook

This runbook describes how to operate the TraceShield X academic prototype safely. It is written for the PostgreSQL-first demonstration and for the handoff from the two-person team. It does not claim that the prototype is approved for live banking or law-enforcement data.

## 1. Runtime modes

| Mode | Intended use | Authentication | Persistence | Production-safe? |
| --- | --- | --- | --- | --- |
| PostgreSQL + session | final viva, integration testing, controlled deployment | database-backed session | real PostgreSQL | yes, only after the deployment checklist |
| PostgreSQL + env | short local DBMS troubleshooting | explicit environment actor | real PostgreSQL | no |
| mock + demo | unit tests and zero-setup frontend development | synthetic demo actor | process memory | no |

The application now fails closed for a production configuration that is missing PostgreSQL, session authentication, a token secret, an adapter signing secret, or an allowed origin. Mock mode and environment authentication must be selected deliberately.

## 2. Required production invariants

Set these values through the deployment platform or a secret manager, not a committed `.env` file:

```env
NODE_ENV=production
DATA_MODE=postgres
AUTH_MODE=session
DATABASE_URL=postgresql://traceshield_app:<managed-secret>@db.internal:5432/traceshield
DB_SCHEMA=traceshield
TRACESHIELD_TOKEN_SECRET=<at-least-32-random-characters>
TRACESHIELD_ADAPTER_SIGNING_SECRET=<different-at-least-32-random-characters>
REQUIRE_ADAPTER_SIGNATURE=true
ENABLE_CONSOLE_INGESTION=false
ALLOW_ORIGIN=https://investigator.example
TRUST_PROXY=1
```

The application should run behind a TLS-terminating reverse proxy. `Secure` session cookies are enabled automatically when `NODE_ENV=production`; the proxy must forward HTTPS correctly. Do not expose the Node process directly to an untrusted network.

## 3. PostgreSQL installation order

Run the following as a database owner or administrator. The application role must not own the tables.

```powershell
createdb -U postgres traceshield
psql -U postgres -d traceshield -f "D:\Projects\DBMS Project\TraceShield_X_schema.sql"
psql -U postgres -d traceshield -f "D:\Projects\DBMS Project\TraceShield_X_demo_seed.sql"
psql -U postgres -d traceshield -f "D:\Projects\DBMS Project\TraceShield_X_person1_migration.sql"
```

Then edit the placeholder password in `TraceShield_X_least_privilege.sql` outside Git, create the dedicated role, and apply the grants as an administrator. The grant list intentionally excludes `SELECT ON ALL TABLES`; credential and session columns are granted only where the current application contract still needs them. A future production hardening step should replace those direct authentication-table grants with security-definer functions in a restricted schema.

After the role is created, verify the role posture:

```sql
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin
FROM pg_roles
WHERE rolname = 'traceshield_app';

SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'traceshield_app'
ORDER BY table_name, privilege_type;
```

The application role must be `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, and must not be the owner of the `traceshield` tables.

## 4. Credential provisioning and startup

Provision a synthetic/local investigator credential before starting session mode. The password is scrypt-hashed and is never stored in the repository:

```powershell
cd "D:\Projects\DBMS Project\investigation-app"
$env:DATA_MODE = "postgres"
$env:AUTH_MODE = "session"
$env:DATABASE_URL = "postgresql://traceshield_app:<password>@localhost:5432/traceshield"
$env:DB_SCHEMA = "traceshield"
$env:TRACESHIELD_TOKEN_SECRET = "<local-or-managed-token-secret>"
$env:TRACESHIELD_ADAPTER_SIGNING_SECRET = "<different-local-or-managed-adapter-secret>"
$env:REQUIRE_ADAPTER_SIGNATURE = "true"
$env:TRACESHIELD_CREDENTIAL_INVESTIGATOR_ID = "1"
$env:TRACESHIELD_LOGIN_NAME = "asingh"
$env:TRACESHIELD_LOGIN_PASSWORD = "<local-password-at-least-12-chars>"
npm run bootstrap:credential
npm start
```

Check the service without exposing secrets:

```powershell
Invoke-RestMethod http://127.0.0.1:4170/api/health
```

The health response should report `mode=postgres`, `status=ok`, `authMode=session`, and `adapterSignatureRequired=true`.

## 5. Institution adapter contract

The real adapter calls `POST /api/ingestion/batches`. It must send:

- `X-TraceShield-Adapter-Timestamp` — Unix seconds;
- `X-TraceShield-Adapter-Nonce` — a unique request value;
- `X-TraceShield-Adapter-Signature` — `sha256=<HMAC-SHA-256>`;
- a stable `batchReference` for idempotent delivery.

The signed payload is the canonical JSON body joined as `timestamp.nonce.canonicalJson`. The server rejects expired timestamps, bad signatures, and reused nonces. The included `npm run adapter:demo` client signs requests, retries temporary failures, and reports the committed batch status. Never put the adapter secret in frontend JavaScript.

For a local academic walkthrough, the UI's “Send batch” control calls `/api/ingestion/console`. This is an in-process adapter helper enabled by default only outside production; it signs the body on the server and is disabled by the production configuration validator. The actual institution endpoint remains `/api/ingestion/batches`.

## 6. Monitoring and alerting

At minimum, monitor:

- repeated `401` login responses and `429` rate-limit responses;
- `409` conflicting batch references and `422` rollback/rejection responses;
- health failures and database connection errors;
- audit verification failures;
- unexpected changes to token-context expiry, reveal approvals, or case status;
- adapter delivery latency and retry counts.

Application logs must contain request IDs and outcome metadata only. Do not log request bodies, source-local identifiers, session tokens, password values, HMAC secrets, or raw identity values. PostgreSQL logs should use the same redaction policy.

## 7. Backup and recovery

Use a managed PostgreSQL backup policy for any non-demo deployment. A minimum local rehearsal is:

```powershell
pg_dump -Fc --no-owner --dbname="postgresql://<admin>@localhost:5432/traceshield" -f "traceshield-backup.dump"
createdb -U postgres traceshield_restore_check
pg_restore --exit-on-error --dbname=traceshield_restore_check "traceshield-backup.dump"
```

The team should record the backup frequency, retention duration, encryption location, restore owner, and target recovery time before claiming operational readiness. Do not use the restore command against the live database.

## 8. Key rotation and incident response

The current prototype supports one active token secret and one active adapter secret at a time. Rotate them during a short maintenance window, restart all application instances, and invalidate sessions if compromise is suspected. A production evolution should add a key identifier and a two-key verification window so rotation does not require a synchronized restart.

If an adapter secret, session secret, database credential, or raw identity is exposed:

1. stop the affected adapter/application path;
2. revoke active sessions and rotate the affected secret;
3. preserve the request ID and audit event IDs for investigation;
4. verify the audit chain and inspect conflicting/replayed batches;
5. determine the retention and notification obligations with the institution owner;
6. record the corrective action as a new case note or operational event, never by rewriting history.

## 9. Final academic demonstration checklist

```text
[ ] PostgreSQL is running and the final DB role is not postgres/superuser.
[ ] Schema, seed, and migration have been applied in that order.
[ ] A local credential exists and AUTH_MODE=session is active.
[ ] REQUIRE_ADAPTER_SIGNATURE=true and the adapter secret is not in frontend code.
[ ] npm run check passes.
[ ] npm test passes.
[ ] scripts/postgres-integration-check.js passes.
[ ] npm run adapter:demo produces APPLIED then DUPLICATE on replay.
[ ] The query transcript is generated from real psql execution.
[ ] The UI shows masked values only and the audit chain verifies.
[ ] The browser console helper is disabled for any production-like run.
[ ] Synthetic records shown during the viva are intentional and documented.
```
