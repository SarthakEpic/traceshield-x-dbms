-- TraceShield X investigation query pack
-- Person 2 owns these read/report queries and the API methods that expose them.
-- Replace :investigator_id, :institution_id and :case_id in a SQL client, or use
-- the positional parameters shown in the comments when calling from Node pg.

SET search_path = traceshield, public;

-- 1. Request context: every API transaction must set both values before a query.
BEGIN;
SELECT set_config('traceshield.investigator_id', :'investigator_id', true);
SELECT set_config('traceshield.institution_id', :'institution_id', true);
COMMIT;

-- 2. Investigator dashboard counters.
SELECT
    count(*) FILTER (WHERE status IN ('OPEN', 'REOPENED')) AS open_cases,
    count(*) FILTER (WHERE severity IN ('HIGH', 'CRITICAL') AND status IN ('OPEN', 'REOPENED')) AS priority_cases,
    (SELECT count(*) FROM reveal_request WHERE status = 'PENDING') AS pending_reveals,
    (SELECT count(*) FROM fund_path WHERE risk_score >= 0.80) AS critical_paths,
    (SELECT count(*) FROM evidence_record WHERE integrity_status = 'CONFLICTING') AS conflicting_evidence
FROM fraud_case;

-- 3. Case list for the left-hand investigation queue.
SELECT *
FROM v_case_summary
WHERE status IN ('OPEN', 'REOPENED', 'PAUSED')
ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
         opened_at DESC;

-- 4. One case's explainable risk signals.
-- Node pg form: WHERE ct.case_id = $1::uuid
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

-- 5. Masked fund-flow paths. No raw account number or identity field is selected.
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

-- 6. Generate a bounded path from the first case transaction's sender.
-- The API first chooses a seed account, then calls this function with a max hop count.
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

-- 7. Approval queue with calculated dual-control state.
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

-- 8. Evidence register and integrity conflicts for one case.
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

-- 9. Complaint register. The complainant remains a token; the narrative is purpose-limited.
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

-- 10. Audit trail for a case. The UI displays hashes; it never exposes raw source data.
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

-- 11. One-call audit verification used by GET /api/audit/verify.
SELECT verify_case_audit_chain(:'case_id'::uuid) AS audit_chain_valid;

-- 12. Cross-institution path summary for an investigator report.
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

-- 13. Expired case/reveal housekeeping report. The application can schedule this later.
SELECT case_id, case_reference, expires_at
FROM fraud_case
WHERE status IN ('OPEN', 'REOPENED') AND expires_at <= now()
ORDER BY expires_at;

SELECT reveal_request_id, case_id, expires_at
FROM reveal_request
WHERE status = 'PENDING' AND expires_at <= now()
ORDER BY expires_at;

-- 14. Append-only investigator notes for the case timeline.
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
