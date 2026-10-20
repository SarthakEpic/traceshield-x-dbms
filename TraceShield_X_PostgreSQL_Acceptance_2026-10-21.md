# TraceShield X PostgreSQL Acceptance Evidence — 2026-10-21

This transcript records the final local verification against a disposable PostgreSQL 18 database and a separate non-superuser application role. It contains synthetic data only. The disposable database is not the user's production database.

## Application quality gate

```text
npm run check  -> exit 0
npm test       -> 15 tests, 15 passed, 0 failed
npm run benchmark -> exit 0
```

The HTTP test requires loopback access. In a restricted sandbox it times out before starting its child server; the same command passed when run with local loopback permission.

## Database gate

The following completed with `ON_ERROR_STOP=1`:

1. `TraceShield_X_schema.sql`
2. `TraceShield_X_demo_seed.sql`
3. `TraceShield_X_person1_migration.sql`
4. `TraceShield_X_least_privilege.sql`
5. a second run of `TraceShield_X_person1_migration.sql` to verify rerunnability

The database role check reported:

```text
traceshield_app: NOSUPERUSER, NOCREATEDB, NOCREATEROLE, LOGIN
credential table: no table-level SELECT; only required column privileges
credential password_hash column: SELECT allowed only for the application contract
audit_event: SELECT allowed, DELETE denied
fraud_case/evidence_record/source_ingestion_record: FORCE ROW LEVEL SECURITY enabled
```

## Database-boundary negative tests

Direct SQL writes were intentionally attempted with mismatched contexts. PostgreSQL rejected them before commit:

```text
Evidence target must belong to the case token context
Ingestion provenance must use its batch token context
```

These checks demonstrate that the privacy relationship is not enforced only by the JavaScript repository.

## PostgreSQL application acceptance

The committed `scripts/postgres-integration-check.js` passed with:

```json
{
  "ok": true,
  "appliedStatus": "APPLIED",
  "replayStatus": "DUPLICATE",
  "conflictStatus": 409,
  "rollbackStatus": 422,
  "consoleIngestionStatus": "DUPLICATE",
  "logoutStatus": 200,
  "evidenceCount": 4,
  "auditValid": true
}
```

The signed `scripts/source-adapter-demo.js` also committed a PostgreSQL batch with two accounts, one transaction, and one evidence record. The local HTTP check returned `200` for `/`, `/app.js`, `/styles.css`, and `/api/health`; health reported PostgreSQL mode, session authentication, required adapter signatures, and the development-only console helper enabled.

The least-privilege query runner completed all labelled sections Q01–Q18 and saved the real transcript at `investigation-app/query-output/executed-queries-20261021-000735.txt`. Q15 showed the indexed audit lookup plan, Q16 showed the provenance query, Q17 showed the active context epoch, and Q18 showed authentication posture without selecting the password value.

## Visual verification limitation

Automated browser visual QA was not counted as passed because the Codex browser bridge was unavailable in this environment. The project still needs one manual walkthrough on the user's device at `http://localhost:4170` covering login, case selection, trace, Send batch, reveal request, note, audit verification, and report export.
