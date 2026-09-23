# TraceShield X Project Design

## 1. Project purpose

TraceShield X is a privacy-preserving relational database for investigating cross-bank digital-payment fraud. It helps investigators reconstruct the movement of stolen funds across institutions without centralising names, phone numbers, email addresses, account numbers, device identifiers, or IP addresses.

The design is intentionally focused on a specific technical problem: a fraud path can only be understood when transactions, account relationships, device activity, network activity, provenance, and case permissions are joined across institutional boundaries. The system therefore combines a temporal transaction graph with case-scoped pseudonymous joins, minimum-disclosure investigation views, controlled identity reveal, and a tamper-evident audit chain.

All project data must be synthetic. The shared investigation database stores protected tokens and evidence commitments; raw identity values remain in a bank-local source system in the real deployment model.

## 2. Improved problem statement

Online banking, UPI, wallets, and instant payment rails allow fraud proceeds to move rapidly through mule accounts held at different institutions. A transaction that looks normal inside one bank may become suspicious when joined with events at another bank. Direct sharing of customer information is undesirable because it exposes personal data, enables uncontrolled profiling, and makes it difficult to prove who accessed or changed evidence.

Existing project designs usually solve only one part of the problem: they store a transaction list, draw a graph, or mask a few columns. TraceShield X treats the investigation itself as the privacy boundary. Each investigation receives a short-lived token context. Banks contribute context-bound pseudonyms and transaction evidence, the database traces only temporally valid paths, and the investigator receives a minimum-disclosure path certificate. Exact identity is released only through a separately approved request and is never copied into the shared graph.

## 3. Technical contribution

The proposed contribution is the coordinated operation of four mechanisms:

1. **Case-scoped pseudonymous joins**. A token is derived from a canonical identifier, field type, case context, purpose, and time epoch. It is not a permanent global identifier.
2. **Temporal evidence graph**. Transactions and observations include occurrence time, observation time, validity windows, source institution, and provenance commitments. Recursive queries trace money only through valid edges.
3. **Minimum-disclosure path certificates**. A trace result contains pseudonymous nodes, hop order, bounded amount information, time gaps, source commitments, and explainable risk signals instead of raw personal data.
4. **Progressive identity reveal**. A reveal request names the precise account or token and fields required. The request is approved by the required roles, and the originating institution returns a local disclosure receipt rather than placing raw identity into the shared database.

The project should present this as a patent-oriented technical architecture, not as a claim that patentability is guaranteed.

## 4. Scope and actors

The minimum demonstration uses three synthetic financial institutions and one investigation authority.

- **Source institution**: imports protected account, transaction, device, and network observations.
- **Investigator**: opens cases, traces funds, and reads masked evidence.
- **Supervisor**: approves escalations and identity-reveal requests.
- **Auditor**: verifies provenance and the audit hash chain.
- **Shared investigation database**: stores only scoped tokens, graph edges, evidence commitments, permissions, and audit events.

The first demonstration should focus on UPI or instant-payment mule-account chains. The schema remains usable for other payment rails through the `payment_rail` attribute.

## 5. Privacy model

The database must never store raw names, phone numbers, email addresses, account numbers, device fingerprints, or IP addresses in the shared schema. A source adapter normalises the value and produces a protected digest using a case context and token version. The shared record also stores the source institution, matching basis, validity interval, confidence, and source-record hash.

Token contexts expire. A new case or epoch produces a different digest. This limits long-term correlation and allows a case to be closed or revoked without deleting the historical case record.

The design assumes a protected key-management or tokenisation boundary outside the relational database. For the student prototype, the token generator can be simulated with PostgreSQL `pgcrypto` and a secret held outside the schema. The prototype must demonstrate that the shared tables contain only synthetic values and digests.

## 6. Core relational model

### Source and identity layer

- `institution` identifies participating banks, payment providers, and investigation authorities.
- `identity_token` stores case-scoped protected identifiers.
- `bank_account` stores a context-scoped account representation and its source institution.
- `account_party` links an account to a protected party token with a relationship type and confidence.
- `device_token` and `network_token` represent protected device and network identities.
- `account_observation` records when an account was observed with a device, network endpoint, or transaction.

### Case and privacy layer

- `fraud_case` stores the purpose, severity, status, nonce commitment, and expiry of an investigation.
- `case_access` grants an investigator a time-bounded access level.
- `case_note` stores append-only, investigator-authored reasoning so decisions remain explainable without copying raw identity data into the case.
- `token_context` creates the case and epoch boundary used for protected joins.
- `reveal_request` and `reveal_approval` govern exceptional identity disclosure.

### Transaction and detection layer

- `payment_transaction` stores directed sender and receiver accounts, amount, currency, rail, time, status, and source provenance.
- `transaction_signal` stores explainable indicators such as rapid fan-out, device reuse, velocity, or cross-bank movement.
- `fraud_alert` stores alerts raised by an institution or rule engine.
- `alert_transaction`, `case_alert`, and `case_transaction` resolve the many-to-many relationships required by real investigations.

### Evidence and explanation layer

- `fund_path` stores a generated trace result and its certificate hash.
- `path_hop` stores the ordered transactions and accounts that form a path.
- `evidence_record` stores source commitments and integrity state, never raw evidence content.
- `audit_event` stores every ingestion, query, permission change, and reveal action in a hash-linked chain.

The application engine sits on top of this model as a privacy-safe read model. It converts persisted transactions and generated paths into a masked graph, explains risk indicators, recommends the minimum disclosure fields, and produces a report that deliberately omits raw account identifiers. This separation keeps UI convenience from becoming a new identity leak.

## 7. Important integrity rules

- A transaction amount must be positive and the sender and receiver must differ.
- A transaction, its sender account, and its receiver account must belong to the same token context.
- A transaction source institution must be recorded.
- A validity end time cannot precede its start time.
- An observation must identify at least one device or network endpoint.
- A case cannot use a token context after that context expires or is revoked.
- A closed case cannot accept new evidence without an explicit reopening event.
- A path hop must reference an existing transaction and must have a unique sequence number within its path.
- Evidence and audit rows are append-only. Corrections are represented as new events.
- A reveal request cannot become approved until the configured number of distinct authorised roles approve it.
- A reveal request cannot be created with fields outside the minimum-disclosure recommendation unless an explicit override is recorded for review.
- A note is attributed to the server-resolved session investigator; the browser cannot choose another author.
- Case status and severity changes use an allow-list and create an audit event rather than silently overwriting history.

## 8. Required DBMS implementation

The PostgreSQL implementation should include:

- normalised tables and foreign keys;
- `CHECK` constraints for status, amount, timestamps, and role values;
- recursive CTEs for multi-hop tracing;
- indexes on sender, receiver, transaction time, token context, and case membership;
- row-level security or institution-scoped views;
- masked investigator and unmasked supervisor views;
- stored procedures for case creation, token-context creation, ingestion, tracing, reveal requests, and audit verification;
- an append-only audit trigger or stored procedure that calculates a SHA-256 event hash;
- synthetic seed data with both true fraud chains and false-positive device reuse.
- an application service with request IDs, strict CORS, security headers, controlled status transitions, and privacy-safe report export.
- an HTTP integration test covering minimum disclosure, dual control, notes, audit verification, and raw-identity exclusion.

## 9. Demonstration workflow

1. Bank A opens a case for a suspicious victim transaction.
2. A token context is created for the case with a short expiry.
3. Banks A, B, and C contribute protected accounts and transactions.
4. The database joins only records sharing the active case context.
5. A recursive query finds a three-hop path with a short time gap, amount conservation, and device reuse.
6. The investigator sees a masked path certificate and the exact signals that raised the score.
7. The application engine presents a decision brief, graph explanations, next actions, and a minimum-disclosure recommendation.
8. The investigator records a case note or controlled status transition; both actions are attributed and audited.
9. The investigator submits a reveal request for one account and explains the reason. The API blocks unnecessary fields before insertion.
10. A supervisor and auditor approve the request through dual control; the server resolves their roles rather than trusting browser-supplied names.
11. The source institution returns a local disclosure receipt; the shared database stores the receipt hash and approvals, not the raw name.
12. The auditor runs the verification procedure and detects any modified audit or evidence row.

## 10. Evaluation metrics

- Path reconstruction accuracy on seeded cases.
- False-positive rate when a device is shared by unrelated users.
- Query time for two-hop, three-hop, and five-hop traces.
- Percentage of shared records containing no raw identity values.
- Percentage of reveal attempts blocked without sufficient approvals.
- Audit-chain verification result before and after a deliberate tampering test.
- Duplicate-ingestion rate when the same source batch is submitted twice.
- Percentage of overbroad reveal requests blocked before persistence.
- Time from trace completion to a reviewer understanding the next safe action.
- Percentage of case decisions with an attributed note or audit event.

## 11. Mapping from the original design

- `User` becomes a protected party represented through `identity_token` and `account_party`.
- `BANK` becomes `institution`.
- `BANK_ACCOUNT` becomes a context-scoped `bank_account`.
- `TRANSACTION` becomes `payment_transaction` with explicit sender and receiver foreign keys.
- `ACCOUNT_DEVICE` and `ACCOUNT_IP` become time-aware `account_observation` records.
- `FRAUD_ALERT` becomes many-to-many with transactions and cases.
- `INVESTIGATION_CASE` becomes `fraud_case` with access control, token context, evidence, paths, and reveal governance.
- Investigator reasoning becomes `case_note`, with append-only persistence and audit linkage.
- The missing complaints, access control, provenance, risk signals, audit logs, and controlled disclosure are now represented explicitly.

## 12. Person 2 application-engine implementation boundary

Person 2 owns the investigator-facing read and decision layer:

- `investigation-engine.js` is pure, testable logic for path explanations, risk bands, graph construction, minimum disclosure, timelines, and privacy-safe reports.
- `server.js` is the HTTP boundary. It resolves the current session actor, validates workflow values, enforces request policy, and attaches a request ID to errors and responses.
- `repository.js` has both a deterministic mock adapter and a PostgreSQL adapter. Both expose the same case, trace, reveal, note, audit, and report contract.
- `public/app.js` and `public/styles.css` provide the responsive investigator workspace: case filters, decision brief, protected graph, trace action, reveal queue, notes, timeline, and export.
- The UI never receives raw account identifiers. The graph and report use protected tokens, institution labels, evidence commitments, and bounded amounts.

Person 1 still has to connect the real authentication/session provider and source-ingestion pipeline. The current demo session is explicit and synthetic; it is not a production identity system.

## 13. Claim-oriented technical contribution map

The project should be explained as a concrete database-and-application mechanism, not as a generic “AI fraud detection” idea. The strongest technical combination is:

1. A case-and-purpose-bound token context derives non-global identifiers for accounts, parties, devices, and networks, with an expiry and epoch boundary.
2. A relational temporal graph joins only context-compatible payment edges and constrains traversal by hop count, time continuity, visited-account state, and provenance.
3. The trace service converts the result into a minimum-disclosure certificate containing masked graph nodes, bounded amounts, hop explanations, evidence commitments, and risk indicators.
4. A policy planner compares requested identity fields with the case purpose and next action before persistence, rejecting unnecessary fields unless an explicit override is recorded.
5. A role-separated reveal protocol requires independently resolved supervisor and auditor approvals; a database trigger verifies that the stored role matches the active approver record.
6. Hash-linked audit events and append-only evidence, notes, and approval records preserve the decision history without putting the revealed identity into the shared graph.

The defensible novelty is the interaction of these boundaries: privacy is applied to the investigative graph, the decision workflow, and the audit trail together. A formal patent opinion still requires a prior-art search and professional claim drafting; this document is an invention-oriented technical specification, not a guarantee of patentability.

## 14. Deliverables

- `ER Diagram TraceShield X.drawio`: redesigned conceptual ER diagram.
- `TraceShield X schema.sql`: PostgreSQL schema, constraints, indexes, views, and stored routines.
- `TraceShield X Project Design.docx`: polished project proposal for submission.
- Synthetic seed and test cases should be added next so the recursive trace and privacy controls can be demonstrated end to end.
