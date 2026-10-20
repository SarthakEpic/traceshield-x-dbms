# TraceShield X Patent-Oriented Evidence Package

This document packages technical evidence for an academic invention discussion. It is not a patentability opinion, a freedom-to-operate opinion, or legal claim drafting. Patent counsel must independently search the relevant jurisdictions, verify claim scope, and review the final disclosure before filing.

## 1. Proposed technical problem

Cross-institution fraud investigation needs links between accounts, devices, networks, transactions, and alerts. Sharing raw identifiers creates unnecessary disclosure and makes governance difficult. A simple global hash is also inadequate because it allows long-lived correlation across unrelated investigations. A useful system therefore needs to preserve investigative graph utility while constraining correlation to an authorised purpose, case, and time window.

## 2. The combined mechanism implemented here

TraceShield X combines the following database and application boundaries:

1. A case-bound, epoch-bound HMAC token context derives different protected references for each investigation instead of storing a reusable global identifier.
2. A relational temporal graph stores directed payments, observations, alerts, evidence, and provenance with context and case membership constraints.
3. A bounded trace function and application analysis layer produce a masked path certificate with hop risk, amount continuity, evidence commitments, and next-action reasoning.
4. A minimum-disclosure planner compares requested reveal fields with the case purpose and decision need before a reveal request is persisted.
5. A server-resolved dual-control workflow requires distinct authorised supervisor and auditor approvals; the database trigger verifies the stored role.
6. Hash-linked, append-only events record ingestion, tracing, notes, approvals, and lifecycle changes without copying the revealed identity into the shared graph.

The technical contribution is the interaction of these controls across the data model, graph query, disclosure workflow, and audit layer. The project should not be described as “AI fraud detection” or as already patented.

## 3. Evidence map

| Claim-supporting fact | Reproducible evidence |
| --- | --- |
| Token context and epoch separation | `TraceShield_X_schema.sql`, `TraceShield_X_person1_migration.sql`, `investigation-app/ingestion-engine.js`, Q17 |
| Context/case integrity at the database boundary | `enforce_evidence_context`, `enforce_ingestion_record_target`, invalid-write PostgreSQL checks |
| Bounded investigation graph | recursive `trace_fund_flow`, `investigation-engine.js`, Q06 |
| Minimum-disclosure decision | `buildRevealRecommendation`, reveal API validation, `investigation-app/test/investigation-engine.test.js` |
| Dual approval and role separation | reveal approval trigger, API integration test, Q07 |
| Append-only auditability | audit hash chain, verification endpoint, Q10/Q11 |
| Signed institution delivery | `adapter-security.js`, `source-adapter-demo.js`, security tests, Q16 |
| Operational performance baseline | `npm run benchmark` |
| Real PostgreSQL behavior | `scripts/postgres-integration-check.js` and its JSON output |

## 4. Benchmark and experiment plan

Run the deterministic local baseline from `investigation-app`:

```powershell
npm run benchmark
```

The output records Node version, token derivation operations, ingestion-normalisation operations, investigation-analysis operations, and an explicit disclaimer that it is not a production capacity claim. The benchmark uses synthetic data only.

For a stronger paper or filing package, repeat the experiment with fixed seeds and report:

- two-hop, three-hop, and five-hop path reconstruction latency;
- ingestion throughput at 1k, 10k, and 100k synthetic records;
- duplicate and conflicting replay handling time;
- false-positive rate when a device or network is shared by unrelated accounts;
- percentage of outputs containing no raw identity values;
- percentage of overbroad reveal requests blocked before persistence;
- audit verification time before and after a deliberate tamper test;
- comparison with an in-memory plaintext reference join. The plaintext comparison must remain an isolated benchmark fixture and must never be persisted or returned by the application.

Report medians, p95 latency, hardware, PostgreSQL version, Node version, dataset generator, and confidence limits. Do not use the current local benchmark as proof of scalability or patentability.

## 5. Prior-art landscape and careful differentiation

The following sources show that the broad areas of federated fraud detection, privacy-preserving linkage, cross-entity transaction analysis, and confidential fraud processing are already active. The comparison below is a technical reading for research planning, not a novelty conclusion.

| Reference | Broad subject observed | What TraceShield X must distinguish precisely |
| --- | --- | --- |
| [US20250078079A1](https://patents.google.com/patent/US20250078079A1/en) | distributed privacy-preserving payment-fraud detection using federated model updates | TraceShield X is a relational case-scoped investigation and disclosure workflow, not a federated-learning gradient exchange system. |
| [US20260094206A1](https://patents.google.com/patent/US20260094206A1/en) | federated tracking, ingestion, enrichment, scoring, and fraud dissemination | The differentiating evidence should focus on context epochs, database-enforced graph scope, minimum disclosure, dual approval, and hash-linked provenance rather than generic multi-entity scoring. |
| [US20240281812A1](https://patents.google.com/patent/US20240281812A1/en) | cross-entity transaction analysis and privacy-treated federated identifiers | TraceShield X must explain why its per-case HMAC context is not merely a reusable federated ID and how the database prevents cross-case joins. |
| [US12118125B1](https://patents.google.com/patent/US12118125B1/en) | consortium hashing and privacy-preserving record linkage | TraceShield X should distinguish exact context-scoped token derivation plus investigation workflow controls from Bloom-filter or consortium matching alone. |
| [US9064364B2](https://patents.google.com/patent/US9064364B2/en) | confidential fraud processing in a secure processing unit with encrypted multi-member data | The evidence should focus on relational integrity, temporal graph tracing, provenance, and controlled reveal governance rather than only confidential computation/storage. |
| [WO2026093891A1](https://patents.google.com/patent/WO2026093891A1/en) | detecting, tracking, and tracing fraud across a computer network and financial institutions | Any claim must be narrow about the concrete context-bound data model, enforcement triggers, and decision/audit sequence; generic tracing is unlikely to be enough. |
| [A blinded evaluation of PPRL with Bloom filters](https://link.springer.com/article/10.1186/s12874-022-01510-2) | empirical privacy-preserving record linkage compared with clear-text linkage | TraceShield X should include its own fraud-graph and disclosure-control measurements rather than relying on the existence of protected linkage as novelty. |

## 6. Candidate claim themes for counsel

These are discussion themes, not final claims:

- a database method that derives a case-and-epoch-specific protected token for a source reference and rejects joins whose token context, case, or expiry does not match;
- a transaction-graph method that produces a bounded, masked path certificate with provenance and explainable hop conditions;
- a disclosure controller that blocks fields outside a minimum-disclosure set before persistence and routes an exception through independent role approvals;
- a combined ingestion/audit method where a signed, idempotent source batch is committed with context-scoped records, a source commitment, and a hash-linked event;
- database triggers that enforce these boundaries even when a caller bypasses the application service.

Counsel should test whether these themes are novel individually or only in a particular ordered combination, and should define the required technical effect and implementation limitations.

## 7. Evidence still required from the project owner

- a professional prior-art search with claim charts in the target jurisdiction;
- a documented plaintext-sharing baseline and fixed synthetic experiment results;
- an institution-approved adapter or a written synthetic-adapter limitation;
- a managed KMS/HSM or identity-provider deployment decision;
- privacy/retention/consent review for the intended jurisdiction;
- professional claim drafting and inventor/contributor records.

Until those items exist, the accurate description is: **patent-oriented privacy-preserving cross-institution investigation architecture, demonstrated on synthetic PostgreSQL data**.
