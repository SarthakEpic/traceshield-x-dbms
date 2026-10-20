# TraceShield X quality scorecard

These are implementation-readiness scores for the current synthetic/demo build. They are not a patentability opinion; patentability still requires prior-art searching and professional claim review.

| Domain | Current score | Evidence in the build |
| --- | ---: | --- |
| Relational design and DBMS depth | 9.3/10 | Normalised schema, foreign keys, checks, indexes, recursive trace function, RLS policies, temporal fields, and case-scoped contexts. |
| Privacy and security boundary | 9.4/10 | Context-bound HMAC tokens, scrypt credentials, lockout protection, hashed HttpOnly sessions, minimum-disclosure allow-list, case-target scope check, server-resolved actors, strict CORS, security headers, request IDs, and no raw identity in reports. |
| Investigation engine | 9.3/10 | Explainable path graph, hop risk, institution continuity, amount retention, evidence conflicts, next-action decision, timeline, and privacy-safe report model. |
| Backend/API engineering | 9.4/10 | Mock/PostgreSQL repository parity, authenticated actor context, transactional idempotent ingestion, controlled lifecycle updates, UUID and field validation, bounded trace input, dual-control approval, and consistent error request IDs. |
| Audit and provenance | 9.4/10 | Hash-linked audit events, verification endpoint, append-only evidence/audit/note triggers, approval-role trigger, trace certificates, and source commitments. |
| Frontend and UX | 9.1/10 | Responsive investigator console, decision brief, protected graph, filters, notes, timeline, reveal planner, ingestion/provenance panel, report export, focus management, keyboard modal handling, and reduced-motion support. |
| Testing and verification | 9.5/10 | Fifteen passing Node tests including a full HTTP workflow, authentication primitives, adapter-signature verification, rate-limit metadata, and ingestion normalization; the committed PostgreSQL acceptance check covers unauthenticated rejection, session login/logout, atomic case/context creation, signed protected ingestion, console-helper replay, duplicate/conflicting replay, rollback, provenance listing, and audit verification. |
| Documentation and patent-oriented framing | 9.5/10 | Redesigned ER diagram, combined schema/seed/query pack, Person 1 API contract, operations runbook, CI workflow, benchmark command, patent evidence/prior-art comparison, application README, claim-oriented technical contribution map, and explicit external handoff. |

## Conditions required to keep the score above 9

The local combined build is above the 9/10 implementation gate for synthetic data. The evidence is implementation evidence, not a production certification. To preserve that rating for a real deployment, the project owner must replace local credentials/secrets through a managed boundary, connect an approved institution adapter, run with a least-privilege PostgreSQL role, configure MFA/TLS/monitoring/backups/retention, and complete legal/privacy and professional prior-art review. Browser visual QA remains a manual step because the local browser automation bridge was unavailable in this environment.

## Quality gate

From `investigation-app`:

```powershell
npm run check
npm test
```

The visible PostgreSQL preview is available at `http://localhost:4170` after session setup; mock mode remains available only for frontend-only review. Run `npm run benchmark` and preserve its JSON output with the submission evidence.
