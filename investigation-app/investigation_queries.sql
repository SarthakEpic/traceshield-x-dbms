-- TraceShield X executed investigation query pack
--
-- This file is intentionally runnable with PostgreSQL's psql client. The
-- PowerShell runner passes investigator_id, institution_id and case_id as
-- psql variables, prints every statement, shows timings, and captures the
-- complete transcript for a DBMS viva/demo.
--
-- Example:
--   psql -X -v ON_ERROR_STOP=1 \
--     -v investigator_id=1 \
--     -v institution_id=101 \
--     -v case_id='11111111-1111-4111-8111-111111111111' \
--     -f investigation_queries.sql

\set ON_ERROR_STOP on
\set ECHO queries
\set VERBOSITY default
\pset pager off
\pset null '[NULL]'
\timing on

SET search_path = traceshield, public;

-- Keep the RLS request context alive for every statement in this transcript.
-- The final ROLLBACK makes this demonstration read-only, even if it is run
-- against the shared development database.
BEGIN;

\echo ''
\echo '============================================================'
\echo 'Q01 | Request-scoped security context'
\echo '============================================================'
SELECT
    set_config('traceshield.investigator_id', :'investigator_id', true) AS investigator_context,
    set_config('traceshield.institution_id', :'institution_id', true) AS institution_context;

\echo ''
\echo '============================================================'
\echo 'Q02 | Investigator dashboard counters'
\echo '============================================================'
SELECT
    count(*) FILTER (WHERE status IN ('OPEN', 'REOPENED')) AS open_cases,
    count(*) FILTER (WHERE severity IN ('HIGH', 'CRITICAL') AND status IN ('OPEN', 'REOPENED')) AS priority_cases,
    (SELECT count(*) FROM reveal_request WHERE status = 'PENDING') AS pending_reveals,
    (SELECT count(*) FROM fund_path WHERE risk_score >= 0.80) AS critical_paths,
    (SELECT count(*) FROM evidence_record WHERE integrity_status = 'CONFLICTING') AS conflicting_evidence
FROM fraud_case;

\echo ''
\echo '============================================================'
\echo 'Q03 | Case queue with joined investigation summary'
\echo '============================================================'
SELECT *
FROM v_case_summary
WHERE status IN ('OPEN', 'REOPENED', 'PAUSED')
ORDER BY CASE severity
             WHEN 'CRITICAL' THEN 1
             WHEN 'HIGH' THEN 2
             WHEN 'MEDIUM' THEN 3
             ELSE 4
         END,
         opened_at DESC;

\echo ''
\echo '============================================================'
\echo 'Q04 | Explainable transaction risk signals'
\echo '============================================================'
SELECT
    ts.signal_id,
    ts.signal_type,
    ts.signal_score,
    ts.explanation,
    ts.generated_by,
    ts.generated_at
FROM transaction_signal ts
JOIN case_transaction ct ON ct.transaction_id = ts.transaction_id
WHERE ct.case_id = :'case_id'::uuid
ORDER BY ts.signal_score DESC, ts.generated_at DESC;

\echo ''
\echo '============================================================'
\echo 'Q05 | Masked fund-flow path (privacy-safe view)'
\echo '============================================================'
SELECT
    path_id,
    hop_no,
    from_account_mask,
    to_account_mask,
    amount_bucket,
    temporal_gap_seconds,
    hop_risk_score,
    provenance_hash
FROM v_masked_path_hops
WHERE case_id = :'case_id'::uuid
ORDER BY path_id, hop_no;

\echo ''
\echo '============================================================'
\echo 'Q06 | Bounded recursive fund-tracing function'
\echo '============================================================'
WITH seed AS (
    SELECT t.sender_account_id
    FROM payment_transaction t
    JOIN case_transaction ct ON ct.transaction_id = t.transaction_id
    WHERE ct.case_id = :'case_id'::uuid
      AND ct.relevance = 'SEED'
    ORDER BY t.occurred_at
    LIMIT 1
)
SELECT *
FROM seed, LATERAL trace_fund_path(:'case_id'::uuid, seed.sender_account_id, 5);

\echo ''
\echo '============================================================'
\echo 'Q07 | Dual-control reveal approval queue'
\echo '============================================================'
SELECT
    reveal_request_id,
    case_id,
    status,
    required_approvals,
    approvals,
    rejections,
    calculated_state
FROM v_reveal_approval_status
WHERE calculated_state IN ('WAITING', 'READY_FOR_SOURCE_DISCLOSURE')
ORDER BY reveal_request_id;

\echo ''
\echo '============================================================'
\echo 'Q08 | Evidence register and integrity status'
\echo '============================================================'
SELECT
    er.evidence_id,
    er.evidence_type,
    coalesce(i.institution_name, 'TraceShield X') AS source,
    er.source_record_hash,
    er.content_commitment,
    er.integrity_status,
    er.captured_at
FROM evidence_record er
LEFT JOIN institution i ON i.institution_id = er.source_institution_id
WHERE er.case_id = :'case_id'::uuid
ORDER BY er.captured_at DESC;

\echo ''
\echo '============================================================'
\echo 'Q09 | Purpose-limited complaint register'
\echo '============================================================'
SELECT
    fc.complaint_id,
    fc.complaint_reference_token,
    fc.channel,
    fc.reported_at,
    fc.summary,
    fc.status,
    fc.source_record_hash
FROM fraud_complaint fc
WHERE fc.case_id = :'case_id'::uuid
ORDER BY fc.reported_at DESC;

\echo ''
\echo '============================================================'
\echo 'Q10 | Hash-linked audit trail'
\echo '============================================================'
SELECT
    ae.audit_event_id,
    ae.event_type,
    inv.display_name AS actor,
    ae.target_type,
    ae.target_id,
    ae.occurred_at,
    ae.previous_event_hash,
    ae.event_hash
FROM audit_event ae
LEFT JOIN investigator inv ON inv.investigator_id = ae.actor_investigator_id
WHERE ae.case_id = :'case_id'::uuid
ORDER BY ae.audit_event_id;

\echo ''
\echo '============================================================'
\echo 'Q11 | Audit-chain verification'
\echo '============================================================'
SELECT verify_case_audit_chain(:'case_id'::uuid) AS audit_chain_valid;

\echo ''
\echo '============================================================'
\echo 'Q12 | Cross-institution path summary'
\echo '============================================================'
SELECT
    fp.path_id,
    fp.risk_score,
    count(DISTINCT ba.institution_id) AS institution_count,
    array_agg(DISTINCT i.institution_code ORDER BY i.institution_code) AS institutions
FROM fund_path fp
JOIN path_hop ph ON ph.path_id = fp.path_id
JOIN bank_account ba ON ba.account_id IN (ph.from_account_id, ph.to_account_id)
JOIN institution i ON i.institution_id = ba.institution_id
WHERE fp.case_id = :'case_id'::uuid
GROUP BY fp.path_id, fp.risk_score
ORDER BY fp.risk_score DESC;

\echo ''
\echo '============================================================'
\echo 'Q13 | Expired case and reveal housekeeping report'
\echo '============================================================'
SELECT case_id, case_reference, expires_at
FROM fraud_case
WHERE status IN ('OPEN', 'REOPENED')
  AND expires_at <= now()
ORDER BY expires_at;

SELECT reveal_request_id, case_id, expires_at
FROM reveal_request
WHERE status = 'PENDING'
  AND expires_at <= now()
ORDER BY expires_at;

\echo ''
\echo '============================================================'
\echo 'Q14 | Append-only investigator notes'
\echo '============================================================'
SELECT
    cn.note_id,
    cn.case_id,
    inv.display_name AS author,
    cn.note_body,
    cn.created_at
FROM case_note cn
JOIN investigator inv ON inv.investigator_id = cn.author_investigator_id
WHERE cn.case_id = :'case_id'::uuid
ORDER BY cn.created_at DESC;

\echo ''
\echo '============================================================'
\echo 'Q15 | Query-plan evidence for indexed audit lookup'
\echo '============================================================'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT audit_event_id, event_type, occurred_at
FROM audit_event
WHERE case_id = :'case_id'::uuid
ORDER BY audit_event_id;

\echo ''
\echo '============================================================'
\echo 'END | Read-only demonstration transaction rolled back'
\echo '============================================================'
ROLLBACK;
