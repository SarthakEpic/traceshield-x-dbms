# TraceShield X

TraceShield X is a DBMS project for privacy-preserving investigation of cross-institution digital-payment fraud.

The project follows a simple principle: investigators should be able to follow suspicious money movement and explain why a path is risky without receiving raw customer identity data by default.

## What is included

### Shared database foundation

- `TraceShield_X_schema.sql` — PostgreSQL schema, constraints, recursive trace function, RLS policies, audit hashing, append-only protections, and reveal governance.
- `TraceShield_X_demo_seed.sql` — synthetic institutions, investigators, accounts, transactions, evidence, signals, notes, and audit events.
- `ER Diagram TraceShield X.drawio` — redesigned ER diagram.
- `TraceShield_X_Project_Design.md` — detailed architecture and patent-oriented technical contribution map.
- `TraceShield_X_least_privilege.sql` — administrator-run role/grant template with explicit business-table and restricted authentication-column privileges.
- `TraceShield_X_Operations_Runbook.md` — PostgreSQL-first deployment, signed-adapter, monitoring, backup, and incident-response checklist.
- `TraceShield_X_Patent_Evidence.md` — reproducible evidence map, benchmark plan, and cautious prior-art comparison.

### Person 2 investigation application

The `investigation-app` folder contains the complete investigator-facing vertical slice:

- Express API with mock and PostgreSQL repositories.
- Bounded fund tracing and explainable risk analysis.
- Masked graph and minimum-disclosure reveal planner.
- Dual-control supervisor and auditor approval workflow.
- Case notes, lifecycle updates, timelines, audit verification, and privacy-safe report export.
- Responsive investigator console with accessible modal interactions and reduced-motion support.
- Case-level ingestion/provenance panel showing committed institution batches, status, record counts, and token-context identifiers.
- Unit and HTTP integration tests.
- Executable PostgreSQL query pack with saved evidence transcripts.

### Person 1 data and privacy engine

- `TraceShield_X_person1_migration.sql` — upgrade migration for credential, session, ingestion-batch, and source-provenance tables.
- Database-backed investigator login with scrypt password hashing, lockout protection, HttpOnly sessions, and server-resolved actor context.
- Case-bound HMAC token derivation for accounts, identities, devices, networks, and transaction references.
- Transactional, idempotent source ingestion with validation, source commitments, duplicate detection, RLS-aware writes, and `DATA_INGESTED` audit events.
- Timestamped HMAC-signed adapter requests with nonce replay protection and a runnable synthetic institution adapter.
- Development-only server-side console adapter for demonstrating a real PostgreSQL ingestion commit without exposing the signing secret to browser code.
- `TraceShield_X_Person1_API_Contract.md` — exact payload and ownership contract for institution adapters.

## Quick start: PostgreSQL demo

Complete the PostgreSQL setup below first. This quick start intentionally does not fall back to mock data.

```powershell
cd "investigation-app"
npm install
$env:DATA_MODE = "postgres"
$env:AUTH_MODE = "session"
$env:DATABASE_URL = "postgresql://traceshield_app:<your-password>@localhost:5432/traceshield"
$env:DB_SCHEMA = "traceshield"
$env:TRACESHIELD_TOKEN_SECRET = "replace-with-at-least-32-random-characters"
$env:TRACESHIELD_ADAPTER_SIGNING_SECRET = "replace-with-a-different-at-least-32-random-characters"
$env:REQUIRE_ADAPTER_SIGNATURE = "true"
$env:ENABLE_CONSOLE_INGESTION = "true"
npm start
```

Open `http://localhost:4170`.

Run the quality checks:

```powershell
npm run check
npm test
npm run benchmark
```

For the real PostgreSQL acceptance check, start the app in session mode and run the committed integration script. It verifies unauthenticated rejection, login/logout, automatic token-context creation, ten-record protected ingestion, duplicate replay, conflicting replay rejection, rollback on invalid evidence, provenance listing, and audit verification:

```powershell
cd "investigation-app"
$env:TRACESHIELD_BASE_URL = "http://127.0.0.1:4170"
$env:TRACESHIELD_TEST_LOGIN = "your-login"
$env:TRACESHIELD_TEST_PASSWORD = "your-local-password"
node scripts/postgres-integration-check.js
```

## PostgreSQL mode

PostgreSQL 15 or newer is recommended. Apply the schema first, then the synthetic seed. The schema now includes the Person 1 operational tables:

```powershell
createdb -U postgres traceshield
psql -U postgres -d traceshield -f "TraceShield_X_schema.sql"
psql -U postgres -d traceshield -f "TraceShield_X_demo_seed.sql"
```

For a database created before the Person 1 tables were added, apply the upgrade once:

```powershell
psql -U postgres -d traceshield -f "TraceShield_X_person1_migration.sql"
```

Copy `investigation-app/.env.example` to `investigation-app/.env`, set the database connection string, and use:

```env
DATA_MODE=postgres
AUTH_MODE=session
DATABASE_URL=postgresql://traceshield_app:password@localhost:5432/traceshield
DB_SCHEMA=traceshield
TRACESHIELD_TOKEN_SECRET=replace-with-at-least-32-random-characters
TRACESHIELD_ADAPTER_SIGNING_SECRET=replace-with-a-different-at-least-32-random-characters
REQUIRE_ADAPTER_SIGNATURE=true
ENABLE_CONSOLE_INGESTION=true
PORT=4170
```

Create the local credential for the seeded investigator before starting session mode. The password is hashed with scrypt and is never written to Git:

```powershell
cd "investigation-app"
$env:TRACESHIELD_CREDENTIAL_INVESTIGATOR_ID = "1"
$env:TRACESHIELD_LOGIN_NAME = "asingh"
$env:TRACESHIELD_LOGIN_PASSWORD = "choose-a-local-password-at-least-12-chars"
npm run bootstrap:credential
npm start
```

The repository sets the authenticated investigator and institution context inside every database transaction. This is required by the schema's case and institution visibility rules. `INVESTIGATOR_ID` and `INSTITUTION_ID` remain supported only for `AUTH_MODE=env` troubleshooting.

New cases automatically receive an active token context. Real source adapters submit signed protected batches through `POST /api/ingestion/batches`; the local UI's “Send batch” control uses the development-only server-side `/api/ingestion/console` helper so the adapter secret never reaches the browser. See [TraceShield_X_Person1_API_Contract.md](TraceShield_X_Person1_API_Contract.md) for the full contract.

### Show the executed DBMS queries

After applying the schema and seed, the complete SQL demonstration can be run against the real database. It prints each query, result table, execution timing and query plan, then saves the transcript for your viva:

```powershell
cd "investigation-app"
$env:PGPASSWORD = "your_password"
$env:TRACESHIELD_DATABASE_URL = "postgresql://traceshield_app@localhost:5432/traceshield"
.\run-query-demo.ps1
```

The generated file is placed in `investigation-app\query-output\executed-queries-<timestamp>.txt`. Read [TraceShield_X_Query_Execution_Guide.md](TraceShield_X_Query_Execution_Guide.md) for the exact setup, query-by-query DBMS concepts and troubleshooting.

## Collaboration boundary and completion

Person 1 owns authentication/session integration, token generation, institution ingestion, source hashes, and privacy-safe database writes. The shared implementation for these responsibilities is now present in the repository and documented in the Person 1 contract.

Person 2 owns investigation analysis, tracing, reveal workflow, audit-facing application logic, and the frontend console.

Both people share the schema, UUID/foreign-key contracts, synthetic seed data, audit event rules, and the rule that raw names, phone numbers, email addresses, full account numbers, government IDs, raw device fingerprints, and raw IP addresses never enter the shared investigation database.

## Project status

The combined local project is implemented as a PostgreSQL-first academic prototype and verified in both PostgreSQL and explicitly selected mock mode. The real PostgreSQL acceptance check covers session login, case creation with automatic token-context creation, protected signed ingestion, console-helper replay, duplicate-batch replay, conflict rejection, rollback on invalid evidence, case reads, provenance, and audit verification. Database triggers protect evidence/provenance context boundaries, CI runs syntax/tests on Node 20 and 22, and the benchmark/evidence package is documented. Its architecture is patent-oriented, but patentability still requires professional prior-art and claim review.

### Still required from the project owner

- Replace local synthetic credentials, database passwords, and token/adapter secrets with values you control; never commit them.
- Connect an institution-approved adapter or the included signed synthetic adapter to the Person 1 ingestion contract.
- Apply `TraceShield_X_least_privilege.sql` and use its dedicated PostgreSQL role instead of the local `postgres` superuser.
- Decide the final institution governance, retention, consent, and deployment policy with your instructor/team.
- Conduct the professional prior-art/claim review described in `TraceShield_X_Patent_Evidence.md` before calling the work patentable.
