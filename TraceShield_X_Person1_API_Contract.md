# TraceShield X Person 1 integration contract

This is the shared boundary between the source/privacy engine and the investigation application. Person 1 can build an institution adapter against this contract without changing Person 2's case, trace, reveal, or frontend code.

## Required runtime configuration

```text
DATA_MODE=postgres
AUTH_MODE=session
DATABASE_URL=postgresql://<least-privilege-role>:<password>@localhost:5432/traceshield
DB_SCHEMA=traceshield
TRACESHIELD_TOKEN_SECRET=<at least 32 random characters, kept outside Git>
TRACESHIELD_ADAPTER_SIGNING_SECRET=<at least 32 random characters, kept outside Git>
REQUIRE_ADAPTER_SIGNATURE=true
```

The token secret is used only by the application adapter to derive context-bound HMAC tokens. The adapter signing secret authenticates the request envelope. The database stores resulting digests and commitments, not either secret or the raw source value.

## Authentication contract

1. Person 1 provisions one credential per active investigator with `npm run bootstrap:credential`.
2. `POST /api/auth/login` accepts `{ "loginName": "...", "password": "..." }`.
3. The server stores only a scrypt password hash and returns an HttpOnly, SameSite session cookie.
4. Every protected request resolves the investigator from the session. The browser cannot select `investigator_id`, `institution_id`, role, or approver identity.
5. `POST /api/auth/logout` revokes the server-side session.

The environment-context mode (`AUTH_MODE=env`) remains available only for local DBMS debugging. The combined demonstration should use `AUTH_MODE=session`.

### Adapter request signature

When `REQUIRE_ADAPTER_SIGNATURE=true`, the adapter sends three headers:

```text
X-TraceShield-Adapter-Timestamp: <unix seconds>
X-TraceShield-Adapter-Nonce: <fresh random nonce>
X-TraceShield-Adapter-Signature: sha256=<hex HMAC>
```

The HMAC input is the timestamp, nonce, and canonical JSON body joined with dots. The server rejects malformed, expired, mismatched, or replayed nonces. The included `scripts/source-adapter-demo.js` uses this contract. A production deployment should keep the secret per institution and store nonce state in a shared durable store rather than this single-process cache.

The investigator UI's local “Send batch” action does not call this route with a browser-held secret. It calls the development-only `/api/ingestion/console` helper, which signs the body inside the server and is rejected by the production configuration validator. Real institution integrations must call `/api/ingestion/batches` directly with the headers above.

## Source ingestion contract

`POST /api/ingestion/batches` accepts one case-scoped batch:

```json
{
  "caseId": "11111111-1111-4111-8111-111111111111",
  "sourceInstitutionCode": "NSB",
  "batchReference": "nsb-2026-000042",
  "sourceSystem": "bank-fraud-adapter-v1",
  "records": {
    "accounts": [
      { "sourceAccountRef": "bank-local-ref", "accountType": "SAVINGS", "status": "ACTIVE" }
    ],
    "identities": [
      { "sourceAccountRef": "bank-local-ref", "fieldType": "EMAIL", "value": "synthetic@example.test", "relationshipType": "OWNER", "matchingBasis": "EXACT_NORMALISED", "confidenceScore": 1 }
    ],
    "devices": [
      { "sourceDeviceRef": "device-local-ref", "deviceType": "MOBILE", "osFamily": "ANDROID" }
    ],
    "networks": [
      { "sourceNetworkRef": "network-local-ref", "networkType": "IPV4", "countryCode": "IN" }
    ],
    "transactions": [
      {
        "sourceRecordId": "transaction-local-ref",
        "sourceAccountRef": "bank-local-ref",
        "receiverAccountRef": "beneficiary-local-ref",
        "amount": 1250,
        "currencyCode": "INR",
        "paymentRail": "UPI",
        "transactionType": "TRANSFER",
        "transactionStatus": "SETTLED",
        "occurredAt": "2026-10-15T10:00:00Z",
        "observedAt": "2026-10-15T10:01:00Z",
        "caseRelevance": "CANDIDATE",
        "sourceSignature": "synthetic-or-adapter-signature"
      }
    ],
    "observations": [
      {
        "sourceAccountRef": "bank-local-ref",
        "sourceDeviceRef": "device-local-ref",
        "sourceNetworkRef": "network-local-ref",
        "sourceRecordId": "transaction-local-ref",
        "observedAt": "2026-10-15T10:01:00Z",
        "confidenceScore": 0.97
      }
    ],
    "evidence": [
      {
        "evidenceType": "SOURCE_TRANSACTION",
        "sourceRecordHash": "sha256:source-record-commitment",
        "contentCommitment": "sha256:evidence-content-commitment",
        "transactionSourceRecordId": "transaction-local-ref",
        "capturedAt": "2026-10-15T10:01:00Z",
        "integrityStatus": "VERIFIED"
      }
    ]
  }
}
```

### Ingestion guarantees

- Input is normalized and validated before any write.
- Account, identity, device, network, and transaction references become HMAC-SHA-256 digests bound to the active `context_id` and field namespace.
- Evidence records use exactly one protected target. `SOURCE_TRANSACTION` uses `transactionSourceRecordId`; `ACCOUNT_ASSERTION` uses `accountSourceRef` plus optional `accountInstitutionCode`; `DEVICE_ASSERTION` uses `deviceSourceRef`; and `NETWORK_ASSERTION` uses `networkSourceRef`. `COMPLAINT` and `DOCUMENT` may use any one of those target references.
- Raw identity values are never inserted into the shared schema.
- The investigator must have active case access and an active token context.
- The source institution must match the authenticated investigator's institution unless the actor is an administrator.
- A batch reference is unique per source institution and remains bound to its original case and token context. Replaying the same payload in that same context returns `DUPLICATE`; reusing the reference for a different payload, case, or context returns `409`. A source record commitment is unique within its institution, record type, and token context, so the same source event may participate in separate purpose-limited cases without becoming globally correlated.
- Domain writes and provenance writes occur in one database transaction. A failed batch rolls back completely.
- Database triggers independently reject evidence and provenance targets that do not belong to the batch case's token context.
- The batch creates a `DATA_INGESTED` audit event containing counts and a payload hash, not raw source values.
- `/api/ingestion/batches?caseId=<uuid>` returns metadata only: status, counts, source institution, system, payload commitment, and token-context identifier.

## Token-context lifecycle

- Creating a case through `POST /api/cases` automatically creates epoch `0`, token version `1`, and an audit event.
- `POST /api/cases/:caseId/token-context` creates the next epoch for an active case when a source needs controlled rotation.
- Expired or revoked contexts cannot be used for ingestion.
- A rotated context produces different digests for the same source value, limiting long-term correlation.

## Database tables added by Person 1

| Table | Purpose |
| --- | --- |
| `investigator_credential` | scrypt password hashes and lockout counters |
| `auth_session` | hashed, expiring, revocable session tokens |
| `source_ingestion_batch` | idempotency, status, case/context binding, payload commitment |
| `source_ingestion_record` | per-record provenance and duplicate protection |

The complete schema now includes these tables. `TraceShield_X_person1_migration.sql` is retained for upgrading an already-created database.

## Person 1 adapter checklist

1. Receive records only from the institution's approved source boundary.
2. Normalize account, identity, device, network, and transaction fields.
3. Compute source hashes and content commitments before sending the batch.
4. Never log raw identity values, passwords, session tokens, or the token secret.
5. Send the batch with a stable source idempotency reference.
6. Store the returned batch id/status and retry only with the same payload/reference.
7. Alert on `409`, `403`, or `422`; do not silently resubmit a changed payload under the same reference.
8. Use a least-privilege database role and a real secret manager before any non-synthetic deployment.
9. Sign every batch request, keep the signing secret outside Git, and rotate it per institution.
