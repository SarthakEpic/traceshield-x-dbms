# TraceShield X

TraceShield X is a DBMS project for privacy-preserving investigation of cross-institution digital-payment fraud.

The project follows a simple principle: investigators should be able to follow suspicious money movement and explain why a path is risky without receiving raw customer identity data by default.

## What is included

### Shared database foundation

- `TraceShield_X_schema.sql` — PostgreSQL schema, constraints, recursive trace function, RLS policies, audit hashing, append-only protections, and reveal governance.
- `TraceShield_X_demo_seed.sql` — synthetic institutions, investigators, accounts, transactions, evidence, signals, notes, and audit events.
- `ER Diagram TraceShield X.drawio` — redesigned ER diagram.
- `TraceShield_X_Project_Design.md` — detailed architecture and patent-oriented technical contribution map.

### Person 2 investigation application

The `investigation-app` folder contains the complete investigator-facing vertical slice:

- Express API with mock and PostgreSQL repositories.
- Bounded fund tracing and explainable risk analysis.
- Masked graph and minimum-disclosure reveal planner.
- Dual-control supervisor and auditor approval workflow.
- Case notes, lifecycle updates, timelines, audit verification, and privacy-safe report export.
- Responsive investigator console with accessible modal interactions and reduced-motion support.
- Unit and HTTP integration tests.
- Executable PostgreSQL query pack with saved evidence transcripts.

## Quick start: zero-setup demo

```powershell
cd "investigation-app"
npm install
$env:DATA_MODE = "mock"
npm start
```

Open `http://localhost:4170`.

Run the quality checks:

```powershell
npm run check
npm test
```

## PostgreSQL mode

PostgreSQL 15 or newer is recommended. Apply the schema first, then the synthetic seed:

```powershell
createdb -U postgres traceshield
psql -U postgres -d traceshield -f "TraceShield_X_schema.sql"
psql -U postgres -d traceshield -f "TraceShield_X_demo_seed.sql"
```

Copy `investigation-app/.env.example` to `investigation-app/.env`, set the database connection string, and use:

```env
DATA_MODE=postgres
DATABASE_URL=postgresql://postgres:password@localhost:5432/traceshield
DB_SCHEMA=traceshield
INVESTIGATOR_ID=1
INSTITUTION_ID=101
PORT=4170
```

The repository sets the investigator and institution context inside every database transaction. This is required by the schema's case and institution visibility rules.

### Show the executed DBMS queries

After applying the schema and seed, the complete SQL demonstration can be run against the real database. It prints each query, result table, execution timing and query plan, then saves the transcript for your viva:

```powershell
cd "investigation-app"
$env:PGPASSWORD = "your_password"
$env:TRACESHIELD_DATABASE_URL = "postgresql://postgres@localhost:5432/traceshield"
.\run-query-demo.ps1
```

The generated file is placed in `investigation-app\query-output\executed-queries-<timestamp>.txt`. Read [TraceShield_X_Query_Execution_Guide.md](TraceShield_X_Query_Execution_Guide.md) for the exact setup, query-by-query DBMS concepts and troubleshooting.

## Collaboration boundary

Person 1 owns authentication/session integration, token generation, institution ingestion, source hashes, and privacy-safe database writes.

Person 2 owns investigation analysis, tracing, reveal workflow, audit-facing application logic, and the frontend console.

Both people share the schema, UUID/foreign-key contracts, synthetic seed data, audit event rules, and the rule that raw names, phone numbers, email addresses, full account numbers, government IDs, raw device fingerprints, and raw IP addresses never enter the shared investigation database.

## Project status

The current demo is synthetic and designed for a DBMS submission. Its architecture is patent-oriented, but patentability still requires a prior-art search and professional claim review.
