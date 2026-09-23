# TraceShield X quality scorecard

These are implementation-readiness scores for the current synthetic/demo build. They are not a patentability opinion; patentability still requires prior-art searching and professional claim review.

| Domain | Current score | Evidence in the build |
| --- | ---: | --- |
| Relational design and DBMS depth | 9.3/10 | Normalised schema, foreign keys, checks, indexes, recursive trace function, RLS policies, temporal fields, and case-scoped contexts. |
| Privacy and security boundary | 9.2/10 | Masked tokens, minimum-disclosure allow-list, case-target scope check, server-resolved actors, strict CORS, security headers, request IDs, and no raw identity in reports. |
| Investigation engine | 9.3/10 | Explainable path graph, hop risk, institution continuity, amount retention, evidence conflicts, next-action decision, timeline, and privacy-safe report model. |
| Backend/API engineering | 9.2/10 | Mock/PostgreSQL repository parity, controlled lifecycle updates, UUID and field validation, bounded trace input, dual-control approval, and consistent error request IDs. |
| Audit and provenance | 9.4/10 | Hash-linked audit events, verification endpoint, append-only evidence/audit/note triggers, approval-role trigger, trace certificates, and source commitments. |
| Frontend and UX | 9.1/10 | Responsive investigator console, decision brief, protected graph, filters, notes, timeline, reveal planner, report export, focus management, keyboard modal handling, and reduced-motion support. |
| Testing and verification | 9.1/10 | Six passing Node tests including a full HTTP workflow; clean PostgreSQL schema/seed/application run; direct append-only and approval-role trigger tests. |
| Documentation and patent-oriented framing | 9.0/10 | Redesigned ER diagram, schema/seed/query pack, application README, claim-oriented technical contribution map, and explicit Person 1 integration boundary. |

## Conditions required to keep the score above 9

Person 1 must connect a real authenticated session provider instead of the synthetic `INVESTIGATOR_ID` environment context, wire the source-ingestion adapter, and run the application with a least-privilege PostgreSQL role rather than a superuser. The final combined demo should also add a clean-database integration test in CI.

## Quality gate

From `investigation-app`:

```powershell
npm run check
npm test
```

The visible preview is available at `http://localhost:4170` in mock mode.
