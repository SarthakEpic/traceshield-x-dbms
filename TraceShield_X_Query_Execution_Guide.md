# TraceShield X: Executed Query Evidence

This guide explains how to demonstrate that the TraceShield X database queries were actually executed against PostgreSQL.

## What is already built

The project has two complementary files:

| File | Purpose |
| --- | --- |
| `investigation-app/investigation_queries.sql` | Fifteen labelled PostgreSQL queries covering security context, aggregation, joins, views, recursive tracing, approvals, evidence, complaints, audit verification, housekeeping, append-only notes and `EXPLAIN`. |
| `investigation-app/run-query-demo.ps1` | Runs the SQL pack against a real PostgreSQL database and saves the terminal output as a timestamped transcript. |

The runner uses the seeded database values, keeps the RLS request context active for the entire run, prints every SQL statement, shows execution timing, and finishes with `ROLLBACK`. Therefore the demonstration is read-only and does not modify the shared database.

## One-device setup

1. Start PostgreSQL.
2. Create a database named `traceshield`.
3. Apply the schema from the project root.
4. Apply the demo seed from the project root.
5. Confirm that `psql` is installed.

Example using the PostgreSQL terminal:

```powershell
psql -U postgres -d traceshield -f "D:\Projects\DBMS Project\TraceShield_X_schema.sql"
psql -U postgres -d traceshield -f "D:\Projects\DBMS Project\TraceShield_X_demo_seed.sql"
```

If PostgreSQL asks for a password, enter the password for the local `postgres` role. The schema and seed are real database setup; no mock data mode is involved in this workflow.

## Execute and capture the queries

```powershell
cd "D:\Projects\DBMS Project\investigation-app"
$env:PGPASSWORD = "your_password"
$env:TRACESHIELD_DATABASE_URL = "postgresql://postgres@localhost:5432/traceshield"
.\run-query-demo.ps1
```

The command prints the transcript path. The file is created here:

```text
D:\Projects\DBMS Project\investigation-app\query-output\executed-queries-YYYYMMDD-HHMMSS.txt
```

If `psql` is not in PATH:

```powershell
.\run-query-demo.ps1 -PsqlPath "C:\Program Files\PostgreSQL\18\bin\psql.exe"
```

If the database uses different IDs, pass them explicitly:

```powershell
.\run-query-demo.ps1 `
  -DatabaseUrl "postgresql://postgres@localhost:5432/traceshield" `
  -InvestigatorId 1 `
  -InstitutionId 101 `
  -CaseId "11111111-1111-4111-8111-111111111111"
```

## What to show in the viva

Open the generated transcript and show these sections:

| Section | DBMS concept demonstrated |
| --- | --- |
| Q01 | Transaction-local request context used by row-level security. |
| Q02 | Aggregate functions and filtered counts. |
| Q03 | Reporting view, joins and ordered case prioritisation. |
| Q04 | Explainable risk-signal join across case and transaction tables. |
| Q05 | Privacy-safe view that exposes masked accounts instead of raw identifiers. |
| Q06 | Bounded recursive fund tracing with a maximum hop count. |
| Q07 | Grouped approval view and dual-control decision logic. |
| Q08–Q09 | Evidence and complaint registers with source hashes. |
| Q10–Q11 | Hash-linked audit trail and integrity verification function. |
| Q12 | Cross-institution grouping and array aggregation. |
| Q13 | Time-based housekeeping queries. |
| Q14 | Append-only notes joined to investigator identity. |
| Q15 | `EXPLAIN (ANALYZE, BUFFERS)` query-plan evidence. |

The important proof is not only the result rows. Each transcript section shows the executed SQL, the returned table, and the measured duration.

## Expected seeded evidence

With `TraceShield_X_demo_seed.sql`, the transcript should show at least:

- one critical/open case in the case queue;
- four case transactions and explainable signal rows;
- a masked multi-hop fund path after the application trace endpoint has been run;
- a pending dual-control reveal request;
- verified evidence rows;
- a hash-linked audit trail with `audit_chain_valid = true`;
- no raw account number or raw identity field in the report queries.

If Q05 or Q12 is empty before using the application trace button/API, run the real trace operation first. The query pack itself only reads the persisted path tables; Q06 still demonstrates the bounded recursive function directly.
