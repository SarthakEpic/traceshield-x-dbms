# TraceShield X Investigation Application

This folder is the combined application layer for the TraceShield X DBMS project. It includes Person 2's investigation/application engine and frontend plus Person 1's authenticated session boundary and privacy-safe source-ingestion bridge. It is deliberately implemented as a small, inspectable application so it can be demonstrated in a viva and connected to a real or synthetic institution adapter.

## What Person 2 builds

- investigation and case-management APIs;
- bounded recursive fund-tracing integration;
- explainable risk-signal and evidence views;
- purpose-limited complaint register linked to the seed transaction;
- protected, case-scoped account display;
- controlled identity-reveal workflow with dual approval;
- tamper-evident audit-chain verification;
- reusable investigation-analysis engine with graph metrics and next-action reasoning;
- minimum-disclosure recommendation before a reveal request can be submitted;
- case lifecycle controls, append-only investigator notes, and a case timeline;
- privacy-safe JSON investigation report export;
- investigator dashboard frontend;
- case-level institution-ingestion/provenance panel showing committed batches and token contexts;
- PostgreSQL query/report pack in `investigation_queries.sql`;
- an executable query-transcript runner in `run-query-demo.ps1` for DBMS evaluation.

Person 1 integration is also included:

- scrypt investigator credentials, lockout counters, hashed expiring sessions, and logout/revocation;
- automatic token-context creation for new cases and explicit context rotation for active cases;
- HMAC-SHA-256 context-bound token derivation for protected source references;
- transactional/idempotent `/api/ingestion/batches` writes with source commitments and audit events;
- `scripts/bootstrap-credential.js` for local credential provisioning.

The frontend is plain HTML/CSS/JavaScript served by Express. This keeps the DBMS submission easy to run and makes every API/database boundary visible. PostgreSQL mode is the required demonstration mode; mock mode is retained only for deterministic unit and zero-setup development checks.

## Run the demo

The recommended mode uses the real PostgreSQL boundary and does not silently fall back to synthetic data.

```powershell
cd "D:\Projects\DBMS Project\investigation-app"
npm install
$env:DATA_MODE = "postgres"
$env:AUTH_MODE = "session"
$env:DATABASE_URL = "postgresql://traceshield_app:<your-password>@localhost:5432/traceshield"
$env:DB_SCHEMA = "traceshield"
$env:TRACESHIELD_TOKEN_SECRET = "replace-with-at-least-32-random-characters"
$env:TRACESHIELD_ADAPTER_SIGNING_SECRET = "replace-with-a-different-32-character-secret"
$env:REQUIRE_ADAPTER_SIGNATURE = "true"
$env:ENABLE_CONSOLE_INGESTION = "true"
npm start
```

Open `http://localhost:4170` and sign in with the credential provisioned below. In a non-production PostgreSQL run, the case detail “Send batch” control uses the server-side console adapter helper and commits to PostgreSQL without exposing the adapter secret to the browser. Keep `ENABLE_CONSOLE_INGESTION=false` in production. For a zero-setup code-only check, explicitly use `DATA_MODE=mock` and `AUTH_MODE=demo`; that mode never persists source batches.

Useful checks:

```powershell
npm run check
Invoke-RestMethod http://localhost:4170/api/health
```

## Connect PostgreSQL

1. Apply `TraceShield_X_schema.sql` from the project root to a PostgreSQL database.
2. Apply `TraceShield_X_demo_seed.sql` for the base synthetic case, or provide your own institutions, investigators, and case access.
3. Optionally apply `TraceShield_X_presentation_seed.sql` to add four more synthetic cases, completed money paths, evidence, notes, complaints, and approval requests for a richer viva/demo walkthrough.
4. If the database predates the combined schema, apply `TraceShield_X_person1_migration.sql` once.
5. Set `DATA_MODE=postgres`, `AUTH_MODE=session`, `DATABASE_URL`, `DB_SCHEMA`, and `TRACESHIELD_TOKEN_SECRET` using `.env.example`.
6. Provision a credential with `npm run bootstrap:credential` and start the server.

For a quick local setup:

```powershell
cd "D:\Projects\DBMS Project\investigation-app"
$env:DATA_MODE = "postgres"
$env:AUTH_MODE = "session"
$env:DATABASE_URL = "postgresql://traceshield_app:<your-password>@localhost:5432/traceshield"
$env:DB_SCHEMA = "traceshield"
$env:TRACESHIELD_TOKEN_SECRET = "replace-with-at-least-32-random-characters"
$env:TRACESHIELD_ADAPTER_SIGNING_SECRET = "replace-with-a-different-32-character-secret"
$env:REQUIRE_ADAPTER_SIGNATURE = "true"
$env:ENABLE_CONSOLE_INGESTION = "true"
$env:TRACESHIELD_CREDENTIAL_INVESTIGATOR_ID = "1"
$env:TRACESHIELD_LOGIN_NAME = "asingh"
$env:TRACESHIELD_LOGIN_PASSWORD = "choose-a-local-password-at-least-12-chars"
npm run bootstrap:credential
npm start
```

Open `http://localhost:4170`, sign in, and use the seeded cases. The presentation seed gives you a high-risk path, a conflicting-evidence recovery case, a paused refund-loop case, a closed false-positive case, and three pending approval requests. Click “Add data” to demonstrate a protected PostgreSQL commit from the UI, or run `npm run adapter:demo` to exercise the external signed-adapter path. For explicitly approved local DBMS troubleshooting only, set `AUTH_MODE=env ALLOW_INSECURE_ENV_AUTH=true` and provide `INVESTIGATOR_ID=1` and `INSTITUTION_ID=101`.

The PostgreSQL repository sets the request context inside every database transaction. That is important because the schema's row-level security policies use `traceshield.investigator_id` and `traceshield.institution_id` to scope both source rows and case-level investigation rows, preventing an unscoped query from becoming a cross-tenant data leak. Trace results are persisted as `fund_path` and `path_hop` rows, and every important action adds an `audit_event`.

The schema also enforces the security invariants at the database boundary: evidence, audit events, and case notes reject updates/deletes; evidence and provenance targets must stay inside the case token context; reveal approvals verify the active investigator's real role; reveal field arrays cannot be empty; and case notes can only be inserted by the current scoped investigator. The API adds a second layer of validation for better error messages and minimum-disclosure planning.

For local seeding, the minimum order is: institution → investigator → fraud case → case access → token context/accounts → transactions → case transactions. New cases made through the application automatically create their token context. Person 1's adapter should use the ingestion contract in `TraceShield_X_Person1_API_Contract.md`; Person 2 consumes the masked records.

## Show executed SQL queries

The project includes more than a SQL file listing. The query pack is executable and produces a timestamped transcript containing the SQL statements, result tables, row counts, timings, recursive trace output, masked values, source-ingestion provenance, authentication posture, and the final query plan.

First apply the root schema and demo seed to PostgreSQL. Then open PowerShell in this folder and set the real database connection string:

```powershell
cd "D:\Projects\DBMS Project\investigation-app"
$env:PGPASSWORD = "your_password"
$env:TRACESHIELD_DATABASE_URL = "postgresql://traceshield_app@localhost:5432/traceshield"
.\run-query-demo.ps1
```

The default demonstration values match `TraceShield_X_demo_seed.sql`:

```text
investigator_id = 1
institution_id = 101
case_id         = 11111111-1111-4111-8111-111111111111
```

To use another seed or database, pass the values explicitly:

```powershell
.\run-query-demo.ps1 `
  -DatabaseUrl "postgresql://traceshield_app@localhost:5432/traceshield" `
  -InvestigatorId 1 `
  -InstitutionId 101 `
  -CaseId "11111111-1111-4111-8111-111111111111"
```

The transcript is written to `query-output\executed-queries-<timestamp>.txt` and is ignored by Git so database contents and credentials are never committed. For a viva, open that file and show Q02 (aggregation), Q03/Q04 (joins and reporting), Q06 (bounded recursive function), Q07 (dual approval), Q11 (audit verification), Q15 (EXPLAIN query plan), Q16 (ingestion idempotency/provenance), Q17 (token-context lifecycle), and Q18 (authentication posture without secret disclosure).

If `psql` is not on PATH, pass its full Windows path:

```powershell
.\run-query-demo.ps1 -PsqlPath "C:\Program Files\PostgreSQL\18\bin\psql.exe"
```

## Main API routes

```text
GET  /api/health
POST /api/auth/login
GET  /api/auth/session
POST /api/auth/logout
GET  /api/session
GET  /api/dashboard
GET  /api/cases
POST /api/cases
POST /api/cases/:caseId/token-context
GET  /api/cases/:caseId
PATCH /api/cases/:caseId
GET  /api/cases/:caseId/analysis
GET  /api/cases/:caseId/timeline
GET  /api/cases/:caseId/notes
POST /api/cases/:caseId/notes
GET  /api/cases/:caseId/report
POST /api/cases/:caseId/trace
GET  /api/reveal-requests
POST /api/reveal-requests
POST /api/reveal-requests/:requestId/approve
GET  /api/ingestion/batches?caseId=:caseId
POST /api/ingestion/batches
POST /api/ingestion/console        (development-only server-side adapter helper)
GET  /api/audit?caseId=:caseId
GET  /api/audit/verify?caseId=:caseId
```

## Demonstration flow

1. Select the synthetic mule-account case.
2. Run the trace to reconstruct the cross-institution path and create a path certificate.
3. Review explainable signals, transaction continuity, and evidence commitments.
4. Submit a reveal request containing only the minimum required fields.
5. Approve it once as the supervisor and once as the auditor; the queue becomes `APPROVED` only after dual control.
6. Verify the hash-linked case audit chain.
7. Add a case note, change the case status, and export the privacy-safe report.

## Person 2 acceptance criteria

- no raw account/identity values are shown in the UI;
- a trace is bounded by a maximum hop count and never follows an already visited account;
- a path has hop-level provenance, risk, and certificate data;
- reveal requests are pending until the required number of approvals is reached;
- approval/rejection and trace actions are auditable;
- supervisor and auditor identities are resolved server-side rather than trusted from the browser;
- a reveal request is checked against the minimum-disclosure recommendation;
- the decision brief exposes graph nodes, high-risk hops, evidence conflicts, and recommended next actions;
- case notes are append-only and appear in the case timeline;
- exported reports contain masked account tokens only and explicitly declare that raw identity was excluded;
- PostgreSQL mode respects the shared schema and request-scoped RLS settings;
- session mode rejects unauthenticated access and resolves the investigator server-side;
- new cases receive an active token context before source ingestion is accepted;
- source batches are context-bound, idempotent, transactionally applied, and represented in the audit chain;
- mock mode can exercise the investigation workflow without a database, while PostgreSQL mode exercises the real privacy boundary.

## Quality gate

Run both checks before a demo or submission:

```powershell
npm run check
npm test
```

With the PostgreSQL app running in session mode, the real acceptance check is:

```powershell
$env:TRACESHIELD_BASE_URL = "http://127.0.0.1:4170"
$env:TRACESHIELD_TEST_LOGIN = "your-login"
$env:TRACESHIELD_TEST_PASSWORD = "your-local-password"
node scripts/postgres-integration-check.js
```

It verifies the complete boundary: unauthenticated rejection, session login and logout revocation, atomic case/context creation, protected ten-record ingestion, the server-side console adapter replay, idempotent replay, conflicting replay rejection, rollback on invalid evidence, case-level provenance listing, and audit-chain verification. Use synthetic or local test credentials only.

The test suite covers the mock HTTP workflow, token and payload normalization, password/session primitives, masked graph construction, minimum-disclosure decisions, high-risk next-action classification, report privacy, and controlled case updates. PostgreSQL mode was also validated against the real local database: session login, automatic token-context creation, protected ten-record ingestion (including account, device, network, transaction, observation, and four evidence targets), duplicate replay, case reads, ingestion-list provenance, and audit verification.

Run `npm run adapter:demo` for the signed synthetic adapter and `npm run benchmark` for the deterministic local engineering baseline. The operational handoff is in `../TraceShield_X_Operations_Runbook.md`; patent-oriented evidence and prior-art comparison are in `../TraceShield_X_Patent_Evidence.md`. Production still requires institution-approved integration, managed secrets, MFA/identity-provider policy, TLS operations, retention approval, and professional legal review.
