# TraceShield X Investigation Application

This folder is the complete Person 2 vertical slice for the TraceShield X DBMS project. It is deliberately implemented as a small, inspectable application instead of a static screen so it can be demonstrated in a viva and connected to Person 1's ingestion module.

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
- PostgreSQL query/report pack in `investigation_queries.sql`.

The frontend is plain HTML/CSS/JavaScript served by Express. This keeps the DBMS submission easy to run and makes every API/database boundary visible. The production-shaped repository uses PostgreSQL through `pg`; mock mode has the same response contract and is the default for a zero-setup demo.

## Run the demo

The default mode uses synthetic data and does not require PostgreSQL.

```powershell
cd "D:\Projects\DBMS Project\investigation-app"
npm install
$env:DATA_MODE = "mock"
npm start
```

Open `http://localhost:4170`.

Useful checks:

```powershell
npm run check
Invoke-RestMethod http://localhost:4170/api/health
```

## Connect PostgreSQL

1. Apply `TraceShield_X_schema.sql` from the project root to a PostgreSQL database.
2. Seed at least one `institution`, one `investigator`, and an investigator/case access row. The default API context is `INVESTIGATOR_ID=1` and `INSTITUTION_ID=101`; change them when using another seed.
3. Set `DATA_MODE=postgres`, `DATABASE_URL`, `DB_SCHEMA`, `INVESTIGATOR_ID`, and `INSTITUTION_ID` using `.env.example`.
4. Start the server again.

The PostgreSQL repository sets the request context inside every database transaction. That is important because the schema's row-level security policies use `traceshield.investigator_id` and `traceshield.institution_id` to scope both source rows and case-level investigation rows, preventing an unscoped query from becoming a cross-tenant data leak. Trace results are persisted as `fund_path` and `path_hop` rows, and every important action adds an `audit_event`.

The schema also enforces the security invariants at the database boundary: evidence, audit events, and case notes reject updates/deletes; reveal approvals verify the active investigator's real role; reveal field arrays cannot be empty; and case notes can only be inserted by the current scoped investigator. The API adds a second layer of validation for better error messages and minimum-disclosure planning.

For local seeding, the minimum order is: institution → investigator → fraud case → case access → token context/accounts → transactions → case transactions. Person 1's adapter should populate those source tables; Person 2 consumes the masked records.

## Main API routes

```text
GET  /api/health
GET  /api/session
GET  /api/dashboard
GET  /api/cases
POST /api/cases
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
- mock mode can exercise the complete workflow before Person 1's ingestion adapter is ready.

## Quality gate

Run both checks before a demo or submission:

```powershell
npm run check
npm test
```

The test suite covers the full mock HTTP workflow plus masked graph construction, minimum-disclosure decisions, high-risk next-action classification, report privacy, and controlled case updates. PostgreSQL mode was also validated against a clean temporary cluster using the root schema and demo seed.
