-- TraceShield X Person 1 migration
-- PostgreSQL 15+
-- Adds database-backed authentication/session state and idempotent source
-- ingestion provenance. Raw passwords and raw source identity values are
-- intentionally not stored by these tables.

BEGIN;

CREATE SCHEMA IF NOT EXISTS traceshield;
SET search_path = traceshield, public;

CREATE TABLE IF NOT EXISTS investigator_credential (
    investigator_id BIGINT PRIMARY KEY REFERENCES investigator(investigator_id),
    login_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ,
    CHECK (length(trim(login_name)) BETWEEN 3 AND 160),
    CHECK (length(password_hash) >= 40)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_investigator_credential_login
    ON investigator_credential (lower(login_name));

CREATE TABLE IF NOT EXISTS auth_session (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigator_id BIGINT NOT NULL REFERENCES investigator(investigator_id),
    session_token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    user_agent_hash TEXT,
    CHECK (expires_at > created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_auth_session_active
    ON auth_session (session_token_hash, expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS source_ingestion_batch (
    batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_institution_id BIGINT NOT NULL REFERENCES institution(institution_id),
    submitted_by BIGINT NOT NULL REFERENCES investigator(investigator_id),
    case_id UUID NOT NULL REFERENCES fraud_case(case_id),
    context_id UUID NOT NULL REFERENCES token_context(context_id),
    batch_reference TEXT NOT NULL,
    source_system TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    record_count INTEGER NOT NULL CHECK (record_count >= 0),
    status TEXT NOT NULL CHECK (status IN ('RECEIVED', 'APPLIED', 'REJECTED', 'DUPLICATE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    UNIQUE (source_institution_id, batch_reference)
);

CREATE INDEX IF NOT EXISTS idx_ingestion_batch_case_created
    ON source_ingestion_batch (case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS source_ingestion_record (
    ingestion_record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES source_ingestion_batch(batch_id),
    source_institution_id BIGINT NOT NULL REFERENCES institution(institution_id),
    context_id UUID REFERENCES token_context(context_id),
    record_type TEXT NOT NULL CHECK (record_type IN ('ACCOUNT', 'IDENTITY', 'DEVICE', 'NETWORK', 'TRANSACTION', 'OBSERVATION', 'EVIDENCE')),
    source_record_hash TEXT NOT NULL,
    target_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_institution_id, context_id, record_type, source_record_hash)
);

CREATE INDEX IF NOT EXISTS idx_ingestion_record_batch
    ON source_ingestion_record (batch_id, record_type);

-- Upgrade older ingestion tables without losing already-applied provenance.
ALTER TABLE source_ingestion_record
    ADD COLUMN IF NOT EXISTS context_id UUID REFERENCES token_context(context_id);

UPDATE source_ingestion_record sir
SET context_id = sib.context_id
FROM source_ingestion_batch sib
WHERE sib.batch_id = sir.batch_id
  AND sir.context_id IS NULL;

ALTER TABLE source_ingestion_record
    ALTER COLUMN context_id SET NOT NULL;

DO $$
DECLARE
    old_constraint TEXT;
BEGIN
    FOR old_constraint IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'traceshield.source_ingestion_record'::regclass
          AND contype = 'u'
          AND pg_get_constraintdef(oid) LIKE 'UNIQUE (source_institution_id, record_type, source_record_hash)%'
    LOOP
        EXECUTE format('ALTER TABLE traceshield.source_ingestion_record DROP CONSTRAINT %I', old_constraint);
    END LOOP;
END;
$$;

DROP INDEX IF EXISTS traceshield.source_ingestion_record_source_institution_id_record_type_source_record_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_ingestion_record_context_hash
    ON source_ingestion_record (source_institution_id, context_id, record_type, source_record_hash);

ALTER TABLE evidence_record
    ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES bank_account(account_id),
    ADD COLUMN IF NOT EXISTS device_id UUID REFERENCES device_token(device_id),
    ADD COLUMN IF NOT EXISTS network_id UUID REFERENCES network_token(network_id);

ALTER TABLE evidence_record DROP CONSTRAINT IF EXISTS evidence_record_check;
ALTER TABLE evidence_record DROP CONSTRAINT IF EXISTS evidence_record_target_check;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'traceshield.evidence_record'::regclass
          AND conname = 'evidence_record_target_check'
    ) THEN
        ALTER TABLE evidence_record
            ADD CONSTRAINT evidence_record_target_check
            CHECK (num_nonnulls(transaction_id, alert_id, path_id, account_id, device_id, network_id) = 1);
    END IF;
END;
$$;

ALTER TABLE source_ingestion_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_ingestion_record ENABLE ROW LEVEL SECURITY;

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

CREATE OR REPLACE FUNCTION enforce_evidence_context()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = traceshield, public
AS $$
DECLARE
    v_target_context UUID;
    v_target_case UUID;
    v_path_case UUID;
BEGIN
    IF NEW.transaction_id IS NOT NULL THEN
        SELECT context_id INTO v_target_context FROM payment_transaction WHERE transaction_id = NEW.transaction_id;
        IF NOT EXISTS (SELECT 1 FROM case_transaction WHERE case_id = NEW.case_id AND transaction_id = NEW.transaction_id) THEN
            RAISE EXCEPTION 'Evidence transaction must be linked to the same case';
        END IF;
    ELSIF NEW.alert_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM case_alert WHERE case_id = NEW.case_id AND alert_id = NEW.alert_id) THEN
            RAISE EXCEPTION 'Evidence alert must be linked to the same case';
        END IF;
    ELSIF NEW.path_id IS NOT NULL THEN
        SELECT case_id, start_account_id INTO v_path_case, v_target_context
        FROM fund_path WHERE path_id = NEW.path_id;
        IF v_path_case IS DISTINCT FROM NEW.case_id THEN
            RAISE EXCEPTION 'Evidence path must belong to the same case';
        END IF;
        SELECT context_id INTO v_target_context FROM bank_account WHERE account_id = v_target_context;
    ELSIF NEW.account_id IS NOT NULL THEN
        SELECT context_id INTO v_target_context FROM bank_account WHERE account_id = NEW.account_id;
    ELSIF NEW.device_id IS NOT NULL THEN
        SELECT context_id INTO v_target_context FROM device_token WHERE device_id = NEW.device_id;
    ELSIF NEW.network_id IS NOT NULL THEN
        SELECT context_id INTO v_target_context FROM network_token WHERE network_id = NEW.network_id;
    END IF;

    IF NEW.transaction_id IS NOT NULL OR NEW.path_id IS NOT NULL OR NEW.account_id IS NOT NULL
       OR NEW.device_id IS NOT NULL OR NEW.network_id IS NOT NULL THEN
        IF v_target_context IS NULL OR NOT EXISTS (
            SELECT 1 FROM token_context
            WHERE context_id = v_target_context AND case_id = NEW.case_id
        ) THEN
            RAISE EXCEPTION 'Evidence target must belong to the case token context';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_evidence_context ON evidence_record;
CREATE TRIGGER trg_evidence_context
BEFORE INSERT OR UPDATE ON evidence_record
FOR EACH ROW EXECUTE FUNCTION enforce_evidence_context();

CREATE OR REPLACE FUNCTION enforce_ingestion_record_target()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = traceshield, public
AS $$
DECLARE
    v_batch_context UUID;
    v_batch_case UUID;
    v_target_context UUID;
    v_target_uuid UUID;
BEGIN
    SELECT context_id, case_id INTO v_batch_context, v_batch_case
    FROM source_ingestion_batch WHERE batch_id = NEW.batch_id;
    IF v_batch_context IS NULL OR NEW.context_id IS DISTINCT FROM v_batch_context THEN
        RAISE EXCEPTION 'Ingestion provenance must use its batch token context';
    END IF;

    IF NEW.target_id IS NULL THEN
        IF NEW.record_type <> 'OBSERVATION' THEN
            RAISE EXCEPTION 'Ingestion provenance target is required for record type %', NEW.record_type;
        END IF;
        RETURN NEW;
    END IF;

    BEGIN
        v_target_uuid := NEW.target_id::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Ingestion provenance target must be a UUID for record type %', NEW.record_type;
    END;

    CASE NEW.record_type
        WHEN 'ACCOUNT' THEN SELECT context_id INTO v_target_context FROM bank_account WHERE account_id = v_target_uuid;
        WHEN 'IDENTITY' THEN SELECT context_id INTO v_target_context FROM identity_token WHERE party_token_id = v_target_uuid;
        WHEN 'DEVICE' THEN SELECT context_id INTO v_target_context FROM device_token WHERE device_id = v_target_uuid;
        WHEN 'NETWORK' THEN SELECT context_id INTO v_target_context FROM network_token WHERE network_id = v_target_uuid;
        WHEN 'TRANSACTION' THEN SELECT context_id INTO v_target_context FROM payment_transaction WHERE transaction_id = v_target_uuid;
        WHEN 'EVIDENCE' THEN
            IF NOT EXISTS (SELECT 1 FROM evidence_record WHERE evidence_id = v_target_uuid AND case_id = v_batch_case) THEN
                RAISE EXCEPTION 'Ingestion evidence target must belong to the batch case';
            END IF;
            RETURN NEW;
        ELSE
            RAISE EXCEPTION 'Unsupported ingestion provenance record type %', NEW.record_type;
    END CASE;

    IF v_target_context IS NULL OR v_target_context IS DISTINCT FROM NEW.context_id THEN
        RAISE EXCEPTION 'Ingestion provenance target must belong to the batch token context';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ingestion_record_target ON source_ingestion_record;
CREATE TRIGGER trg_ingestion_record_target
BEFORE INSERT OR UPDATE ON source_ingestion_record
FOR EACH ROW EXECUTE FUNCTION enforce_ingestion_record_target();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'traceshield'
          AND tablename = 'source_ingestion_batch'
          AND policyname = 'source_ingestion_batch_scope'
    ) THEN
        CREATE POLICY source_ingestion_batch_scope ON source_ingestion_batch
            USING (
                submitted_by = NULLIF(current_setting('traceshield.investigator_id', true), '')::BIGINT
                OR case_visible(case_id)
            )
            WITH CHECK (
                submitted_by = NULLIF(current_setting('traceshield.investigator_id', true), '')::BIGINT
                AND case_visible(case_id)
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'traceshield'
          AND tablename = 'source_ingestion_record'
          AND policyname = 'source_ingestion_record_scope'
    ) THEN
        CREATE POLICY source_ingestion_record_scope ON source_ingestion_record
            USING (EXISTS (
                SELECT 1 FROM source_ingestion_batch sib
                WHERE sib.batch_id = source_ingestion_record.batch_id
            ));
    END IF;
END;
$$;

COMMIT;
