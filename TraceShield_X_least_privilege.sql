-- Run this template as the database owner or a PostgreSQL administrator.
-- Replace CHANGE_ME before execution. Keep the role password outside Git.
-- The application role must not own the traceshield tables; otherwise table
-- owners can bypass row-level security unless FORCE ROW LEVEL SECURITY is used.

SET search_path = traceshield, public;

-- CREATE ROLE traceshield_app LOGIN PASSWORD 'CHANGE_ME' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
-- ALTER ROLE traceshield_app SET search_path = traceshield, public;

-- The current database is resolved at execution time so this template can be
-- verified against a disposable database without silently granting access to
-- a different database. Run as the database owner/administrator.
DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO traceshield_app', current_database());
END;
$$;
GRANT USAGE ON SCHEMA traceshield TO traceshield_app;

-- Make the policy boundary explicit even if a future migration accidentally
-- assigns ownership of one of these tables to a non-superuser service role.
-- PostgreSQL superusers still bypass RLS by design; the application role must
-- never be a superuser.
DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'identity_token', 'bank_account', 'account_party', 'device_token', 'network_token',
        'account_observation', 'token_context', 'payment_transaction', 'transaction_signal',
        'fraud_case', 'fraud_alert', 'fraud_complaint', 'alert_transaction', 'case_alert',
        'case_transaction', 'fund_path', 'path_hop', 'evidence_record', 'reveal_request',
        'reveal_approval', 'reveal_receipt', 'audit_event', 'case_note',
        'source_ingestion_batch', 'source_ingestion_record'
    ] LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    END LOOP;
END;
$$;

-- Business reads are explicit. Do not use SELECT ON ALL TABLES here: that
-- would expose credential and session hashes to every application query.
GRANT SELECT ON
    institution, investigator, fraud_case, case_access, token_context,
    identity_token, bank_account, account_party, device_token, network_token,
    payment_transaction, account_observation, transaction_signal, fraud_alert,
    fraud_complaint, alert_transaction, case_alert, case_transaction,
    fund_path, path_hop, evidence_record, audit_event, case_note,
    source_ingestion_batch, source_ingestion_record,
    reveal_request, reveal_approval, reveal_receipt
TO traceshield_app;

-- Reporting views and stored routines are explicit application surface area;
-- granting table access alone does not grant access to these DBMS objects.
GRANT SELECT ON
    v_masked_path_hops, v_reveal_approval_status, v_case_summary
TO traceshield_app;
GRANT EXECUTE ON FUNCTION trace_fund_path(UUID, UUID, INTEGER) TO traceshield_app;
GRANT EXECUTE ON FUNCTION verify_case_audit_chain(UUID) TO traceshield_app;

-- Authentication uses only the columns listed below. A production deployment
-- should replace these direct table grants with security-definer functions and
-- keep the credential/session tables in a separate restricted schema.
GRANT SELECT (investigator_id, login_name, password_hash, failed_attempts, locked_until, last_login_at)
    ON investigator_credential TO traceshield_app;
GRANT UPDATE (failed_attempts, locked_until, last_login_at)
    ON investigator_credential TO traceshield_app;
GRANT SELECT (session_id, investigator_id, session_token_hash, created_at, expires_at, last_seen_at, revoked_at, user_agent_hash)
    ON auth_session TO traceshield_app;
GRANT INSERT (investigator_id, session_token_hash, expires_at, user_agent_hash)
    ON auth_session TO traceshield_app;
GRANT UPDATE (last_seen_at, revoked_at)
    ON auth_session TO traceshield_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA traceshield TO traceshield_app;

GRANT INSERT, UPDATE ON investigator_credential, auth_session TO traceshield_app;
GRANT INSERT, UPDATE ON fraud_case, case_access, token_context TO traceshield_app;
GRANT INSERT ON identity_token, bank_account, account_party, device_token, network_token TO traceshield_app;
GRANT INSERT, UPDATE ON payment_transaction, account_observation, case_transaction TO traceshield_app;
GRANT INSERT ON evidence_record, case_note, fund_path, path_hop TO traceshield_app;
GRANT INSERT, UPDATE ON reveal_request, reveal_approval TO traceshield_app;
GRANT INSERT ON audit_event, source_ingestion_record TO traceshield_app;
GRANT INSERT, UPDATE ON source_ingestion_batch TO traceshield_app;

-- No DELETE privilege is granted. Append-only triggers additionally reject
-- destructive mutation of evidence, notes, audit, and approval history.
