-- TraceShield X
-- PostgreSQL 15+ reference schema
-- All identifiers and evidence values in this shared database are synthetic or protected.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS traceshield;
SET search_path = traceshield, public;

CREATE TABLE institution (
    institution_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    institution_code     TEXT NOT NULL UNIQUE,
    institution_name     TEXT NOT NULL,
    institution_type     TEXT NOT NULL CHECK (institution_type IN ('BANK', 'WALLET', 'PAYMENT_RAIL', 'AUTHORITY')),
    status               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'RETIRED')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE investigator (
    investigator_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    institution_id       BIGINT NOT NULL REFERENCES institution(institution_id),
    display_name         TEXT NOT NULL,
    role_code             TEXT NOT NULL CHECK (role_code IN ('INVESTIGATOR', 'SUPERVISOR', 'AUDITOR', 'ADMIN')),
    status               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'RETIRED')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fraud_case (
    case_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_reference       TEXT NOT NULL UNIQUE,
    opened_by            BIGINT NOT NULL REFERENCES investigator(investigator_id),
    severity             TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    purpose_code         TEXT NOT NULL CHECK (purpose_code IN ('FRAUD_INVESTIGATION', 'AML_REVIEW', 'RECOVERY', 'AUDIT')),
    status               TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PAUSED', 'CLOSED', 'REOPENED', 'REVOKED')),
    description          TEXT NOT NULL,
    case_nonce_commitment TEXT NOT NULL,
    opened_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at           TIMESTAMPTZ NOT NULL,
    closed_at            TIMESTAMPTZ,
    CHECK (expires_at > opened_at),
    CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

CREATE TABLE case_access (
    case_id              UUID NOT NULL REFERENCES fraud_case(case_id),
    investigator_id      BIGINT NOT NULL REFERENCES investigator(investigator_id),
    access_level         TEXT NOT NULL CHECK (access_level IN ('VIEWER', 'INVESTIGATOR', 'SUPERVISOR', 'AUDITOR')),
    granted_by           BIGINT REFERENCES investigator(investigator_id),
    granted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at           TIMESTAMPTZ NOT NULL,
    revoked_at           TIMESTAMPTZ,
    PRIMARY KEY (case_id, investigator_id),
    CHECK (expires_at > granted_at),
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE TABLE token_context (
    context_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id              UUID NOT NULL REFERENCES fraud_case(case_id),
    epoch_no             INTEGER NOT NULL CHECK (epoch_no >= 0),
    token_version        INTEGER NOT NULL CHECK (token_version > 0),
    purpose_code         TEXT NOT NULL,
    context_fingerprint  TEXT NOT NULL UNIQUE,
    status               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
    created_by           BIGINT NOT NULL REFERENCES investigator(investigator_id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at           TIMESTAMPTZ NOT NULL,
    UNIQUE (case_id, epoch_no, token_version),
    CHECK (expires_at > created_at)
);

CREATE TABLE identity_token (
    party_token_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    context_id           UUID NOT NULL REFERENCES token_context(context_id),
    source_institution_id BIGINT NOT NULL REFERENCES institution(institution_id),
    token_type           TEXT NOT NULL CHECK (token_type IN ('PHONE', 'EMAIL', 'GOVERNMENT_ID', 'CUSTOMER_REFERENCE')),
    token_digest         TEXT NOT NULL,
    matching_basis       TEXT NOT NULL CHECK (matching_basis IN ('EXACT_NORMALISED', 'PROBABILISTIC', 'SOURCE_ASSERTED')),
    confidence_score     NUMERIC(5,4) NOT NULL DEFAULT 1.0 CHECK (confidence_score BETWEEN 0 AND 1),
    source_record_hash   TEXT NOT NULL,
    valid_from           TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to             TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (context_id, source_institution_id, token_type, token_digest),
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE bank_account (
    account_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    context_id           UUID NOT NULL REFERENCES token_context(context_id),
    institution_id       BIGINT NOT NULL REFERENCES institution(institution_id),
    account_token_digest TEXT NOT NULL,
    account_type         TEXT NOT NULL CHECK (account_type IN ('SAVINGS', 'CURRENT', 'WALLET', 'MERCHANT', 'ESCROW', 'UNKNOWN')),
    status               TEXT NOT NULL CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED', 'SUSPENDED', 'UNKNOWN')),
    opened_at            TIMESTAMPTZ,
    closed_at            TIMESTAMPTZ,
    source_record_hash   TEXT NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (context_id, institution_id, account_token_digest),
    CHECK (closed_at IS NULL OR opened_at IS NULL OR closed_at >= opened_at)
);

CREATE TABLE account_party (
    account_id           UUID NOT NULL REFERENCES bank_account(account_id),
    party_token_id       UUID NOT NULL REFERENCES identity_token(party_token_id),
    relationship_type    TEXT NOT NULL CHECK (relationship_type IN ('OWNER', 'AUTHORIZED_USER', 'BENEFICIARY', 'MERCHANT')),
    confidence_score     NUMERIC(5,4) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
    valid_from           TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to             TIMESTAMPTZ,
    PRIMARY KEY (account_id, party_token_id, relationship_type),
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE device_token (
    device_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    context_id           UUID NOT NULL REFERENCES token_context(context_id),
    source_institution_id BIGINT NOT NULL REFERENCES institution(institution_id),
    device_token_digest  TEXT NOT NULL,
    device_type          TEXT,
    os_family            TEXT,
    manufacturer         TEXT,
    source_record_hash   TEXT NOT NULL,
    confidence_score     NUMERIC(5,4) NOT NULL DEFAULT 1.0 CHECK (confidence_score BETWEEN 0 AND 1),
    UNIQUE (context_id, source_institution_id, device_token_digest)
);

CREATE TABLE network_token (
    network_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    context_id           UUID NOT NULL REFERENCES token_context(context_id),
    source_institution_id BIGINT NOT NULL REFERENCES institution(institution_id),
    network_token_digest TEXT NOT NULL,
    network_type         TEXT NOT NULL CHECK (network_type IN ('IPV4', 'IPV6', 'ASN', 'PROXY', 'VPN', 'UNKNOWN')),
    country_code         CHAR(2),
    isp_name             TEXT,
    source_record_hash   TEXT NOT NULL,
    confidence_score     NUMERIC(5,4) NOT NULL DEFAULT 1.0 CHECK (confidence_score BETWEEN 0 AND 1),
    UNIQUE (context_id, source_institution_id, network_token_digest)
);

CREATE TABLE payment_transaction (
    transaction_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    context_id           UUID NOT NULL REFERENCES token_context(context_id),
    source_institution_id BIGINT NOT NULL REFERENCES institution(institution_id),
    sender_account_id    UUID NOT NULL REFERENCES bank_account(account_id),
    receiver_account_id  UUID NOT NULL REFERENCES bank_account(account_id),
    parent_transaction_id UUID REFERENCES payment_transaction(transaction_id),
    transaction_reference_token TEXT NOT NULL,
    amount               NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    currency_code        CHAR(3) NOT NULL,
    payment_rail         TEXT NOT NULL CHECK (payment_rail IN ('UPI', 'IMPS', 'NEFT', 'CARD', 'WALLET', 'CASH_OUT', 'OTHER')),
    transaction_type     TEXT NOT NULL CHECK (transaction_type IN ('TRANSFER', 'REFUND', 'REVERSAL', 'CASH_OUT', 'TOP_UP', 'OTHER')),
    transaction_status   TEXT NOT NULL CHECK (transaction_status IN ('PENDING', 'COMPLETED', 'SETTLED', 'FAILED', 'REVERSED', 'BLOCKED')),
    occurred_at          TIMESTAMPTZ NOT NULL,
    observed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_record_hash   TEXT NOT NULL,
    source_signature     TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (context_id, source_institution_id, source_record_hash),
    CHECK (sender_account_id <> receiver_account_id),
    CHECK (parent_transaction_id IS NULL OR parent_transaction_id <> transaction_id),
    CHECK (observed_at >= occurred_at)
);

CREATE TABLE account_observation (
    observation_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id           UUID NOT NULL REFERENCES bank_account(account_id),
    device_id            UUID REFERENCES device_token(device_id),
    network_id           UUID REFERENCES network_token(network_id),
    transaction_id       UUID REFERENCES payment_transaction(transaction_id),
    observed_at          TIMESTAMPTZ NOT NULL,
    confidence_score     NUMERIC(5,4) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
    source_record_hash   TEXT NOT NULL,
    CHECK (device_id IS NOT NULL OR network_id IS NOT NULL)
);

CREATE TABLE transaction_signal (
    signal_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id       UUID NOT NULL REFERENCES payment_transaction(transaction_id),
    signal_type          TEXT NOT NULL CHECK (signal_type IN ('VELOCITY', 'FAN_OUT', 'FAN_IN', 'DEVICE_REUSE', 'NETWORK_REUSE', 'CROSS_BANK', 'AMOUNT_CONSERVATION', 'TIME_GAP', 'MANUAL')),
    signal_score         NUMERIC(5,4) NOT NULL CHECK (signal_score BETWEEN 0 AND 1),
    explanation          TEXT NOT NULL,
    generated_by         TEXT NOT NULL,
    generated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fraud_alert (
    alert_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_institution_id BIGINT NOT NULL REFERENCES institution(institution_id),
    alert_type           TEXT NOT NULL CHECK (alert_type IN ('RULE', 'SOURCE_BANK', 'CUSTOMER_COMPLAINT', 'AUTHORITY_REFERRAL', 'MANUAL')),
    severity             TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    alert_status         TEXT NOT NULL DEFAULT 'OPEN' CHECK (alert_status IN ('OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'ESCALATED', 'RESOLVED')),
    description          TEXT NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at          TIMESTAMPTZ
);

CREATE TABLE fraud_complaint (
    complaint_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id                  UUID NOT NULL REFERENCES fraud_case(case_id),
    complainant_token_id     UUID REFERENCES identity_token(party_token_id),
    transaction_id           UUID REFERENCES payment_transaction(transaction_id),
    source_institution_id    BIGINT NOT NULL REFERENCES institution(institution_id),
    complaint_reference_token TEXT NOT NULL,
    channel                  TEXT NOT NULL CHECK (channel IN ('BANK_APP', 'BRANCH', 'CALL_CENTER', 'AUTHORITY', 'OTHER')),
    reported_at              TIMESTAMPTZ NOT NULL,
    summary                  TEXT NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'SUBSTANTIATED', 'DISMISSED', 'DUPLICATE')),
    source_record_hash       TEXT NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (complainant_token_id IS NOT NULL OR transaction_id IS NOT NULL)
);

CREATE TABLE alert_transaction (
    alert_id             UUID NOT NULL REFERENCES fraud_alert(alert_id),
    transaction_id       UUID NOT NULL REFERENCES payment_transaction(transaction_id),
    relevance_score      NUMERIC(5,4) NOT NULL DEFAULT 1.0 CHECK (relevance_score BETWEEN 0 AND 1),
    PRIMARY KEY (alert_id, transaction_id)
);

CREATE TABLE case_alert (
    case_id              UUID NOT NULL REFERENCES fraud_case(case_id),
    alert_id             UUID NOT NULL REFERENCES fraud_alert(alert_id),
    added_by             BIGINT NOT NULL REFERENCES investigator(investigator_id),
    added_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (case_id, alert_id)
);

CREATE TABLE case_transaction (
    case_id              UUID NOT NULL REFERENCES fraud_case(case_id),
    transaction_id       UUID NOT NULL REFERENCES payment_transaction(transaction_id),
    relevance             TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK (relevance IN ('SEED', 'CANDIDATE', 'CONFIRMED', 'EXCLUDED')),
    added_by              BIGINT NOT NULL REFERENCES investigator(investigator_id),
    added_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (case_id, transaction_id)
);

CREATE TABLE fund_path (
    path_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id              UUID NOT NULL REFERENCES fraud_case(case_id),
    start_account_id     UUID NOT NULL REFERENCES bank_account(account_id),
    end_account_id       UUID REFERENCES bank_account(account_id),
    path_status          TEXT NOT NULL DEFAULT 'GENERATED' CHECK (path_status IN ('GENERATED', 'REVIEWED', 'CONFIRMED', 'REJECTED')),
    hop_count            INTEGER NOT NULL CHECK (hop_count >= 0),
    risk_score           NUMERIC(5,4) NOT NULL CHECK (risk_score BETWEEN 0 AND 1),
    certificate_hash     TEXT NOT NULL,
    generated_by         BIGINT NOT NULL REFERENCES investigator(investigator_id),
    generated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE path_hop (
    path_id              UUID NOT NULL REFERENCES fund_path(path_id),
    hop_no               INTEGER NOT NULL CHECK (hop_no > 0),
    transaction_id       UUID NOT NULL REFERENCES payment_transaction(transaction_id),
    from_account_id      UUID NOT NULL REFERENCES bank_account(account_id),
    to_account_id        UUID NOT NULL REFERENCES bank_account(account_id),
    amount_bucket        TEXT NOT NULL,
    temporal_gap_seconds INTEGER NOT NULL CHECK (temporal_gap_seconds >= 0),
    hop_risk_score       NUMERIC(5,4) NOT NULL CHECK (hop_risk_score BETWEEN 0 AND 1),
    provenance_hash      TEXT NOT NULL,
    PRIMARY KEY (path_id, hop_no),
    CHECK (from_account_id <> to_account_id)
);

CREATE TABLE evidence_record (
    evidence_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id              UUID NOT NULL REFERENCES fraud_case(case_id),
    source_institution_id BIGINT REFERENCES institution(institution_id),
    transaction_id       UUID REFERENCES payment_transaction(transaction_id),
    alert_id             UUID REFERENCES fraud_alert(alert_id),
    path_id              UUID REFERENCES fund_path(path_id),
    evidence_type        TEXT NOT NULL CHECK (evidence_type IN ('SOURCE_TRANSACTION', 'ACCOUNT_ASSERTION', 'DEVICE_ASSERTION', 'NETWORK_ASSERTION', 'COMPLAINT', 'PATH_CERTIFICATE', 'DOCUMENT')),
    source_record_hash   TEXT NOT NULL,
    content_commitment   TEXT NOT NULL,
    captured_at          TIMESTAMPTZ NOT NULL,
    integrity_status     TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (integrity_status IN ('UNVERIFIED', 'VERIFIED', 'CONFLICTING', 'REVOKED')),
    captured_by          BIGINT NOT NULL REFERENCES investigator(investigator_id),
    CHECK (transaction_id IS NOT NULL OR alert_id IS NOT NULL OR path_id IS NOT NULL)
);

CREATE TABLE audit_event (
    audit_event_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id              UUID REFERENCES fraud_case(case_id),
    actor_investigator_id BIGINT REFERENCES investigator(investigator_id),
    event_type           TEXT NOT NULL CHECK (event_type IN ('CASE_CREATED', 'ACCESS_GRANTED', 'TOKEN_CONTEXT_CREATED', 'DATA_INGESTED', 'TRACE_EXECUTED', 'EVIDENCE_ADDED', 'NOTE_ADDED', 'CASE_STATUS_CHANGED', 'REVEAL_REQUESTED', 'REVEAL_APPROVED', 'REVEAL_REJECTED', 'RECORD_REVOKED', 'CASE_CLOSED')),
    target_type          TEXT,
    target_id            TEXT,
    event_payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    previous_event_hash  TEXT,
    event_hash           TEXT NOT NULL
);

CREATE TABLE case_note (
    note_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id                UUID NOT NULL REFERENCES fraud_case(case_id),
    author_investigator_id BIGINT NOT NULL REFERENCES investigator(investigator_id),
    note_body              TEXT NOT NULL CHECK (length(trim(note_body)) BETWEEN 1 AND 4000),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_case_note_case_created ON case_note(case_id, created_at DESC);

CREATE TABLE reveal_request (
    reveal_request_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id              UUID NOT NULL REFERENCES fraud_case(case_id),
    requested_by         BIGINT NOT NULL REFERENCES investigator(investigator_id),
    target_account_id    UUID REFERENCES bank_account(account_id),
    target_party_token_id UUID REFERENCES identity_token(party_token_id),
    requested_fields     JSONB NOT NULL,
    reason               TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'FULFILLED', 'EXPIRED')),
    required_approvals   INTEGER NOT NULL DEFAULT 2 CHECK (required_approvals > 0),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at           TIMESTAMPTZ NOT NULL,
    CHECK (target_account_id IS NOT NULL OR target_party_token_id IS NOT NULL),
    CHECK (jsonb_typeof(requested_fields) = 'array' AND jsonb_array_length(requested_fields) > 0),
    CHECK (expires_at > created_at)
);

CREATE TABLE reveal_approval (
    reveal_request_id    UUID NOT NULL REFERENCES reveal_request(reveal_request_id),
    approver_id          BIGINT NOT NULL REFERENCES investigator(investigator_id),
    approver_role        TEXT NOT NULL CHECK (approver_role IN ('SUPERVISOR', 'AUDITOR', 'ADMIN')),
    decision             TEXT NOT NULL CHECK (decision IN ('APPROVE', 'REJECT')),
    decision_reason      TEXT,
    decided_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    approval_signature   TEXT,
    PRIMARY KEY (reveal_request_id, approver_id)
);

CREATE TABLE reveal_receipt (
    receipt_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reveal_request_id    UUID NOT NULL REFERENCES reveal_request(reveal_request_id),
    source_institution_id BIGINT NOT NULL REFERENCES institution(institution_id),
    local_disclosure_reference TEXT NOT NULL,
    disclosed_field_hash TEXT NOT NULL,
    disclosed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_signature     TEXT NOT NULL
);

CREATE INDEX idx_account_context_token ON bank_account(context_id, account_token_digest);
CREATE INDEX idx_transaction_sender_time ON payment_transaction(sender_account_id, occurred_at);
CREATE INDEX idx_transaction_receiver_time ON payment_transaction(receiver_account_id, occurred_at);
CREATE INDEX idx_transaction_context_time ON payment_transaction(context_id, occurred_at);
CREATE INDEX idx_identity_context_token ON identity_token(context_id, token_type, token_digest);
CREATE INDEX idx_observation_account_time ON account_observation(account_id, observed_at);
CREATE INDEX idx_case_transaction_case ON case_transaction(case_id, transaction_id);
CREATE INDEX idx_path_case ON fund_path(case_id, generated_at DESC);
CREATE INDEX idx_audit_case_time ON audit_event(case_id, audit_event_id);
CREATE INDEX idx_complaint_case_time ON fraud_complaint(case_id, reported_at DESC);

CREATE OR REPLACE FUNCTION reject_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = traceshield, public
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; corrections must be represented as a new row or audit event', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_evidence_append_only
BEFORE UPDATE OR DELETE ON evidence_record
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER trg_evidence_append_only_truncate
BEFORE TRUNCATE ON evidence_record
FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER trg_audit_append_only
BEFORE UPDATE OR DELETE ON audit_event
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER trg_audit_append_only_truncate
BEFORE TRUNCATE ON audit_event
FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER trg_case_note_append_only
BEFORE UPDATE OR DELETE ON case_note
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER trg_case_note_append_only_truncate
BEFORE TRUNCATE ON case_note
FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_mutation();

CREATE OR REPLACE FUNCTION context_visible(p_context_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = traceshield, public
AS $$
DECLARE
    v_investigator BIGINT;
BEGIN
    v_investigator := NULLIF(current_setting('traceshield.investigator_id', true), '')::BIGINT;
    IF v_investigator IS NULL THEN
        RETURN FALSE;
    END IF;
    RETURN EXISTS (
        SELECT 1
        FROM token_context tc
        JOIN case_access ca ON ca.case_id = tc.case_id
        WHERE tc.context_id = p_context_id
          AND ca.investigator_id = v_investigator
          AND ca.revoked_at IS NULL
          AND ca.expires_at > now()
          AND tc.status = 'ACTIVE'
          AND tc.expires_at > now()
    );
END;
$$;

CREATE OR REPLACE FUNCTION case_visible(p_case_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = traceshield, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM case_access ca
        WHERE ca.case_id = p_case_id
          AND ca.investigator_id = NULLIF(current_setting('traceshield.investigator_id', true), '')::BIGINT
          AND ca.revoked_at IS NULL
          AND ca.expires_at > now()
    );
$$;

CREATE OR REPLACE FUNCTION current_institution_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
SET search_path = traceshield, public
AS $$
    SELECT NULLIF(current_setting('traceshield.institution_id', true), '')::BIGINT;
$$;

CREATE OR REPLACE FUNCTION enforce_reveal_approval_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = traceshield, public
AS $$
DECLARE
    v_role TEXT;
    v_status TEXT;
BEGIN
    SELECT role_code, status INTO v_role, v_status
    FROM investigator
    WHERE investigator_id = NEW.approver_id;

    IF v_status IS DISTINCT FROM 'ACTIVE'
       OR v_role IS NULL
       OR v_role NOT IN ('SUPERVISOR', 'AUDITOR', 'ADMIN')
       OR NEW.approver_role <> v_role THEN
        RAISE EXCEPTION 'Approval actor, active role, and stored approver role must agree';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reveal_approval_actor
BEFORE INSERT OR UPDATE ON reveal_approval
FOR EACH ROW EXECUTE FUNCTION enforce_reveal_approval_actor();

CREATE OR REPLACE FUNCTION make_context_token(
    p_normalised_value TEXT,
    p_context_id UUID,
    p_field_type TEXT,
    p_secret TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = traceshield, public
AS $$
    SELECT encode(
        hmac(
            lower(trim(p_normalised_value)) || '|' || p_context_id::TEXT || '|' || upper(p_field_type),
            p_secret,
            'sha256'
        ),
        'hex'
    );
$$;

CREATE OR REPLACE FUNCTION enforce_transaction_context()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = traceshield, public
AS $$
DECLARE
    v_sender_context UUID;
    v_receiver_context UUID;
BEGIN
    SELECT context_id INTO v_sender_context FROM bank_account WHERE account_id = NEW.sender_account_id;
    SELECT context_id INTO v_receiver_context FROM bank_account WHERE account_id = NEW.receiver_account_id;
    IF v_sender_context IS NULL OR v_receiver_context IS NULL THEN
        RAISE EXCEPTION 'Transaction endpoints must exist before the transaction is inserted';
    END IF;
    IF v_sender_context <> NEW.context_id OR v_receiver_context <> NEW.context_id THEN
        RAISE EXCEPTION 'Transaction and both endpoint accounts must use the same token context';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_transaction_context
BEFORE INSERT OR UPDATE ON payment_transaction
FOR EACH ROW EXECUTE FUNCTION enforce_transaction_context();

CREATE OR REPLACE FUNCTION enforce_observation_context()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = traceshield, public
AS $$
DECLARE
    v_account_context UUID;
    v_device_context UUID;
    v_network_context UUID;
    v_transaction_context UUID;
BEGIN
    SELECT context_id INTO v_account_context FROM bank_account WHERE account_id = NEW.account_id;
    IF NEW.device_id IS NOT NULL THEN
        SELECT context_id INTO v_device_context FROM device_token WHERE device_id = NEW.device_id;
    END IF;
    IF NEW.network_id IS NOT NULL THEN
        SELECT context_id INTO v_network_context FROM network_token WHERE network_id = NEW.network_id;
    END IF;
    IF NEW.transaction_id IS NOT NULL THEN
        SELECT context_id INTO v_transaction_context FROM payment_transaction WHERE transaction_id = NEW.transaction_id;
    END IF;
    IF v_account_context IS NULL OR (v_device_context IS NOT NULL AND v_device_context <> v_account_context)
       OR (v_network_context IS NOT NULL AND v_network_context <> v_account_context)
       OR (v_transaction_context IS NOT NULL AND v_transaction_context <> v_account_context) THEN
        RAISE EXCEPTION 'Account observations must use one token context';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_observation_context
BEFORE INSERT OR UPDATE ON account_observation
FOR EACH ROW EXECUTE FUNCTION enforce_observation_context();

CREATE OR REPLACE FUNCTION audit_event_hash_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = traceshield, public
AS $$
DECLARE
    v_previous TEXT;
BEGIN
    SELECT event_hash INTO v_previous
    FROM audit_event
    WHERE case_id IS NOT DISTINCT FROM NEW.case_id
    ORDER BY audit_event_id DESC
    LIMIT 1;

    NEW.previous_event_hash := v_previous;
    NEW.event_hash := encode(
        digest(
            coalesce(v_previous, '') || '|' ||
            coalesce(NEW.case_id::TEXT, '') || '|' ||
            coalesce(NEW.actor_investigator_id::TEXT, '') || '|' ||
            NEW.event_type || '|' ||
            coalesce(NEW.target_type, '') || '|' ||
            coalesce(NEW.target_id, '') || '|' ||
            NEW.event_payload::TEXT || '|' ||
            NEW.occurred_at::TEXT,
            'sha256'
        ),
        'hex'
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_event_hash
BEFORE INSERT ON audit_event
FOR EACH ROW EXECUTE FUNCTION audit_event_hash_trigger();

CREATE OR REPLACE FUNCTION trace_fund_path(
    p_case_id UUID,
    p_start_account_id UUID,
    p_max_hops INTEGER DEFAULT 5
)
RETURNS TABLE (
    hop_no INTEGER,
    transaction_id UUID,
    from_account_id UUID,
    to_account_id UUID,
    amount NUMERIC,
    occurred_at TIMESTAMPTZ,
    source_institution_id BIGINT
)
LANGUAGE sql
STABLE
SET search_path = traceshield, public
AS $$
    WITH RECURSIVE trail AS (
        SELECT
            1 AS hop_no,
            t.transaction_id,
            t.sender_account_id AS from_account_id,
            t.receiver_account_id AS to_account_id,
            t.amount,
            t.occurred_at,
            t.source_institution_id,
            ARRAY[t.sender_account_id, t.receiver_account_id] AS visited_accounts
        FROM payment_transaction t
        JOIN case_transaction ct ON ct.transaction_id = t.transaction_id
        WHERE ct.case_id = p_case_id
          AND ct.relevance <> 'EXCLUDED'
          AND t.sender_account_id = p_start_account_id
          AND t.transaction_status IN ('COMPLETED', 'SETTLED')

        UNION ALL

        SELECT
            tr.hop_no + 1,
            next_t.transaction_id,
            next_t.sender_account_id,
            next_t.receiver_account_id,
            next_t.amount,
            next_t.occurred_at,
            next_t.source_institution_id,
            tr.visited_accounts || next_t.receiver_account_id
        FROM trail tr
        JOIN payment_transaction next_t
          ON next_t.sender_account_id = tr.to_account_id
         AND next_t.occurred_at >= tr.occurred_at
         AND next_t.occurred_at <= tr.occurred_at + INTERVAL '24 hours'
        JOIN case_transaction next_ct ON next_ct.transaction_id = next_t.transaction_id
        WHERE next_ct.case_id = p_case_id
          AND next_ct.relevance <> 'EXCLUDED'
          AND next_t.transaction_status IN ('COMPLETED', 'SETTLED')
          AND tr.hop_no < p_max_hops
          AND NOT (next_t.receiver_account_id = ANY(tr.visited_accounts))
    )
    SELECT hop_no, transaction_id, from_account_id, to_account_id, amount, occurred_at, source_institution_id
    FROM trail
    ORDER BY hop_no, occurred_at;
$$;

CREATE OR REPLACE FUNCTION verify_case_audit_chain(p_case_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = traceshield, public
AS $$
    WITH ordered AS (
        SELECT
            ae.*,
            lag(ae.event_hash) OVER (PARTITION BY ae.case_id ORDER BY ae.audit_event_id) AS expected_previous
        FROM audit_event ae
        WHERE ae.case_id = p_case_id
    ), checked AS (
        SELECT
            event_hash = encode(
                digest(
                    coalesce(expected_previous, '') || '|' ||
                    coalesce(case_id::TEXT, '') || '|' ||
                    coalesce(actor_investigator_id::TEXT, '') || '|' ||
                    event_type || '|' ||
                    coalesce(target_type, '') || '|' ||
                    coalesce(target_id, '') || '|' ||
                    event_payload::TEXT || '|' ||
                    occurred_at::TEXT,
                    'sha256'
                ),
                'hex'
            ) AS valid_event
        FROM ordered
    )
    SELECT coalesce(bool_and(valid_event), TRUE) FROM checked;
$$;

CREATE OR REPLACE VIEW v_masked_path_hops AS
SELECT
    fp.case_id,
    fp.path_id,
    ph.hop_no,
    left(ba_from.account_token_digest, 12) || '...' AS from_account_mask,
    left(ba_to.account_token_digest, 12) || '...' AS to_account_mask,
    ph.amount_bucket,
    ph.temporal_gap_seconds,
    ph.hop_risk_score,
    ph.provenance_hash
FROM fund_path fp
JOIN path_hop ph ON ph.path_id = fp.path_id
JOIN bank_account ba_from ON ba_from.account_id = ph.from_account_id
JOIN bank_account ba_to ON ba_to.account_id = ph.to_account_id;

CREATE OR REPLACE VIEW v_reveal_approval_status AS
SELECT
    rr.reveal_request_id,
    rr.case_id,
    rr.status,
    rr.required_approvals,
    count(ra.approver_id) FILTER (WHERE ra.decision = 'APPROVE') AS approvals,
    count(ra.approver_id) FILTER (WHERE ra.decision = 'REJECT') AS rejections,
    CASE
        WHEN count(ra.approver_id) FILTER (WHERE ra.decision = 'REJECT') > 0 THEN 'REJECTED'
        WHEN count(ra.approver_id) FILTER (WHERE ra.decision = 'APPROVE') >= rr.required_approvals THEN 'READY_FOR_SOURCE_DISCLOSURE'
        ELSE 'WAITING'
    END AS calculated_state
FROM reveal_request rr
LEFT JOIN reveal_approval ra ON ra.reveal_request_id = rr.reveal_request_id
GROUP BY rr.reveal_request_id, rr.case_id, rr.status, rr.required_approvals;

CREATE OR REPLACE VIEW v_case_summary AS
SELECT
    fc.case_id,
    fc.case_reference,
    fc.severity,
    fc.status,
    fc.opened_at,
    fc.expires_at,
    count(DISTINCT ct.transaction_id) AS transaction_count,
    count(DISTINCT ca.alert_id) AS alert_count,
    count(DISTINCT fp.path_id) AS path_count,
    count(DISTINCT er.evidence_id) AS evidence_count
FROM fraud_case fc
LEFT JOIN case_transaction ct ON ct.case_id = fc.case_id
LEFT JOIN case_alert ca ON ca.case_id = fc.case_id
LEFT JOIN fund_path fp ON fp.case_id = fc.case_id
LEFT JOIN evidence_record er ON er.case_id = fc.case_id
GROUP BY fc.case_id, fc.case_reference, fc.severity, fc.status, fc.opened_at, fc.expires_at;

-- The application should set these settings at the start of every request:
-- SET LOCAL traceshield.institution_id = '101';
-- SET LOCAL traceshield.investigator_id = '9001';
-- The policies below prevent a tenant from reading another institution's source rows.

ALTER TABLE identity_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_party ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_signal ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_complaint ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE fund_path ENABLE ROW LEVEL SECURITY;
ALTER TABLE path_hop ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE reveal_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE reveal_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE reveal_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_note ENABLE ROW LEVEL SECURITY;

CREATE POLICY identity_token_scope ON identity_token
    USING (source_institution_id = current_institution_id() OR context_visible(context_id));

CREATE POLICY bank_account_scope ON bank_account
    USING (institution_id = current_institution_id() OR context_visible(context_id));

CREATE POLICY device_scope ON device_token
    USING (source_institution_id = current_institution_id() OR context_visible(context_id));

CREATE POLICY network_scope ON network_token
    USING (source_institution_id = current_institution_id() OR context_visible(context_id));

CREATE POLICY token_context_scope ON token_context
    USING (case_visible(case_id));

CREATE POLICY account_party_scope ON account_party
    USING (EXISTS (SELECT 1 FROM bank_account ba WHERE ba.account_id = account_party.account_id));

CREATE POLICY observation_scope ON account_observation
    USING (EXISTS (SELECT 1 FROM bank_account ba WHERE ba.account_id = account_observation.account_id));

CREATE POLICY transaction_signal_scope ON transaction_signal
    USING (EXISTS (
        SELECT 1
        FROM case_transaction ct
        WHERE ct.transaction_id = transaction_signal.transaction_id
          AND case_visible(ct.case_id)
    ));

CREATE POLICY fraud_case_scope ON fraud_case
    USING (opened_by = NULLIF(current_setting('traceshield.investigator_id', true), '')::BIGINT OR case_visible(case_id));

CREATE POLICY fraud_alert_scope ON fraud_alert
    USING (source_institution_id = current_institution_id() OR EXISTS (
        SELECT 1 FROM case_alert ca WHERE ca.alert_id = fraud_alert.alert_id AND case_visible(ca.case_id)
    ));

CREATE POLICY fraud_complaint_scope ON fraud_complaint
    USING (source_institution_id = current_institution_id() OR case_visible(case_id));

CREATE POLICY alert_transaction_scope ON alert_transaction
    USING (EXISTS (SELECT 1 FROM fraud_alert fa WHERE fa.alert_id = alert_transaction.alert_id));

CREATE POLICY case_alert_scope ON case_alert
    USING (case_visible(case_id));

CREATE POLICY case_transaction_scope ON case_transaction
    USING (case_visible(case_id));

CREATE POLICY fund_path_scope ON fund_path
    USING (case_visible(case_id));

CREATE POLICY path_hop_scope ON path_hop
    USING (EXISTS (
        SELECT 1 FROM fund_path fp WHERE fp.path_id = path_hop.path_id AND case_visible(fp.case_id)
    ));

CREATE POLICY payment_transaction_scope ON payment_transaction
    USING (source_institution_id = current_institution_id() OR context_visible(context_id));

CREATE POLICY evidence_scope ON evidence_record
    USING (source_institution_id = current_institution_id() OR EXISTS (
        SELECT 1 FROM case_access ca
        WHERE ca.case_id = evidence_record.case_id
          AND ca.investigator_id = NULLIF(current_setting('traceshield.investigator_id', true), '')::BIGINT
          AND ca.revoked_at IS NULL
          AND ca.expires_at > now()
    ));

CREATE POLICY reveal_request_scope ON reveal_request
    USING (case_visible(case_id));

CREATE POLICY reveal_approval_scope ON reveal_approval
    USING (EXISTS (
        SELECT 1 FROM reveal_request rr WHERE rr.reveal_request_id = reveal_approval.reveal_request_id AND case_visible(rr.case_id)
    ));

CREATE POLICY reveal_receipt_scope ON reveal_receipt
    USING (EXISTS (
        SELECT 1 FROM reveal_request rr WHERE rr.reveal_request_id = reveal_receipt.reveal_request_id AND case_visible(rr.case_id)
    ));

CREATE POLICY audit_event_scope ON audit_event
    USING (case_id IS NULL OR case_visible(case_id) OR actor_investigator_id = NULLIF(current_setting('traceshield.investigator_id', true), '')::BIGINT);

CREATE POLICY case_note_scope ON case_note
    USING (case_visible(case_id))
    WITH CHECK (
        case_visible(case_id)
        AND author_investigator_id = NULLIF(current_setting('traceshield.investigator_id', true), '')::BIGINT
    );

COMMENT ON TABLE token_context IS 'Case and epoch boundary for short-lived privacy-preserving joins.';
COMMENT ON TABLE fund_path IS 'Generated trace result with a verifiable minimum-disclosure certificate hash.';
COMMENT ON TABLE audit_event IS 'Append-only hash-linked audit history; corrections are new events, not updates.';
COMMENT ON TABLE case_note IS 'Append-only investigator notes scoped to a case; edits are represented as new notes or audit events.';
COMMENT ON FUNCTION make_context_token IS 'Prototype token derivation only; production secrets must remain outside the database.';
