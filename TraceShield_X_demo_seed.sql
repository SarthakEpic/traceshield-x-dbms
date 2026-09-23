-- TraceShield X demo seed
-- Apply after TraceShield_X_schema.sql when you want to run Person 2 in PostgreSQL mode.
-- All values are synthetic. No real account, phone, email, or government identifier is used.

SET search_path = traceshield, public;

INSERT INTO institution (institution_id, institution_code, institution_name, institution_type)
OVERRIDING SYSTEM VALUE
VALUES
    (101, 'NSB', 'Northstar Bank', 'BANK'),
    (102, 'RVB', 'Riverbank', 'BANK'),
    (103, 'CWP', 'Civic Wallet', 'WALLET')
ON CONFLICT (institution_id) DO NOTHING;

INSERT INTO investigator (investigator_id, institution_id, display_name, role_code)
OVERRIDING SYSTEM VALUE
VALUES
    (1, 101, 'A. Singh', 'INVESTIGATOR'),
    (2, 102, 'Supervisor K. Rao', 'SUPERVISOR'),
    (3, 103, 'Auditor S. Mehta', 'AUDITOR')
ON CONFLICT (investigator_id) DO NOTHING;

INSERT INTO fraud_case
    (case_id, case_reference, opened_by, severity, purpose_code, description, case_nonce_commitment, expires_at)
VALUES
    ('11111111-1111-4111-8111-111111111111', 'TSX-2026-0001', 1, 'CRITICAL', 'FRAUD_INVESTIGATION',
     'UPI mule-account chain from a compromised victim account', 'demo-case-commitment-0001', now() + interval '14 days')
ON CONFLICT (case_id) DO NOTHING;

INSERT INTO case_access (case_id, investigator_id, access_level, granted_by, expires_at)
VALUES ('11111111-1111-4111-8111-111111111111', 1, 'INVESTIGATOR', 1, now() + interval '14 days')
ON CONFLICT (case_id, investigator_id) DO NOTHING;

INSERT INTO token_context
    (context_id, case_id, epoch_no, token_version, purpose_code, context_fingerprint, created_by, expires_at)
VALUES
    ('60000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 0, 1,
     'FRAUD_INVESTIGATION', 'demo-context-fingerprint-0001', 1, now() + interval '14 days')
ON CONFLICT (context_id) DO NOTHING;

INSERT INTO bank_account
    (account_id, context_id, institution_id, account_token_digest, account_type, status, source_record_hash)
VALUES
    ('10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 101, '4e91d26f8f0a', 'SAVINGS', 'ACTIVE', 'demo-account-0001'),
    ('10000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', 102, '91bd71ce2a4c', 'SAVINGS', 'FROZEN', 'demo-account-0002'),
    ('10000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001', 102, '7c31aa42a6d9', 'CURRENT', 'FROZEN', 'demo-account-0003'),
    ('10000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000001', 103, 'c2b7ef01d8e2', 'WALLET', 'SUSPENDED', 'demo-account-0004'),
    ('10000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000001', 103, 'ee41ba12c7b0', 'MERCHANT', 'SUSPENDED', 'demo-account-0005')
ON CONFLICT (account_id) DO NOTHING;

INSERT INTO device_token
    (device_id, context_id, source_institution_id, device_token_digest, device_type, os_family, source_record_hash)
VALUES
    ('30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 102, 'device-7e3a9b', 'MOBILE', 'ANDROID', 'demo-device-0001')
ON CONFLICT (device_id) DO NOTHING;

INSERT INTO network_token
    (network_id, context_id, source_institution_id, network_token_digest, network_type, country_code, source_record_hash)
VALUES
    ('31000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 102, 'network-91c42d', 'IPV4', 'IN', 'demo-network-0001')
ON CONFLICT (network_id) DO NOTHING;

INSERT INTO payment_transaction
    (transaction_id, context_id, source_institution_id, sender_account_id, receiver_account_id, transaction_reference_token,
     amount, currency_code, payment_rail, transaction_type, transaction_status, occurred_at, source_record_hash)
VALUES
    ('20000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 101, '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'txn_01f8_a2c1', 48500.00, 'INR', 'UPI', 'TRANSFER', 'SETTLED', now() - interval '45 minutes', 'demo-txn-0001'),
    ('20000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', 102, '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'txn_02b0_9c33', 47200.00, 'INR', 'IMPS', 'TRANSFER', 'SETTLED', now() - interval '40 minutes', 'demo-txn-0002'),
    ('20000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001', 102, '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', 'txn_034c_1bd4', 45900.00, 'INR', 'WALLET', 'TRANSFER', 'SETTLED', now() - interval '36 minutes', 'demo-txn-0003'),
    ('20000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000001', 103, '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000005', 'txn_04d4_1e82', 45000.00, 'INR', 'CASH_OUT', 'CASH_OUT', 'BLOCKED', now() - interval '33 minutes', 'demo-txn-0004')
ON CONFLICT (transaction_id) DO NOTHING;

INSERT INTO account_observation
    (account_id, device_id, network_id, transaction_id, observed_at, confidence_score, source_record_hash)
VALUES
    ('10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', now() - interval '39 minutes', 0.98, 'demo-observation-0001')
ON CONFLICT (observation_id) DO NOTHING;

INSERT INTO case_transaction (case_id, transaction_id, relevance, added_by)
VALUES
    ('11111111-1111-4111-8111-111111111111', '20000000-0000-4000-8000-000000000001', 'SEED', 1),
    ('11111111-1111-4111-8111-111111111111', '20000000-0000-4000-8000-000000000002', 'CONFIRMED', 1),
    ('11111111-1111-4111-8111-111111111111', '20000000-0000-4000-8000-000000000003', 'CONFIRMED', 1),
    ('11111111-1111-4111-8111-111111111111', '20000000-0000-4000-8000-000000000004', 'CANDIDATE', 1)
ON CONFLICT (case_id, transaction_id) DO NOTHING;

INSERT INTO transaction_signal (signal_id, transaction_id, signal_type, signal_score, explanation, generated_by)
VALUES
    ('32000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'CROSS_BANK', 0.88, 'The scoped path crosses multiple institutions.', 'demo-scorer'),
    ('32000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'VELOCITY', 0.92, 'The next transfer occurs within a short time window.', 'demo-scorer'),
    ('32000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'DEVICE_REUSE', 0.81, 'The protected device token is observed on a second account.', 'demo-scorer'),
    ('32000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000003', 'AMOUNT_CONSERVATION', 0.76, 'Most of the seed amount is preserved before cash-out.', 'demo-scorer')
ON CONFLICT (signal_id) DO NOTHING;

INSERT INTO fraud_alert (alert_id, source_institution_id, alert_type, severity, description)
VALUES ('50000000-0000-4000-8000-000000000001', 101, 'CUSTOMER_COMPLAINT', 'CRITICAL', 'Synthetic customer complaint linked to the seed transaction.')
ON CONFLICT (alert_id) DO NOTHING;

INSERT INTO alert_transaction (alert_id, transaction_id, relevance_score)
VALUES ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 0.99)
ON CONFLICT (alert_id, transaction_id) DO NOTHING;

INSERT INTO case_alert (case_id, alert_id, added_by)
VALUES ('11111111-1111-4111-8111-111111111111', '50000000-0000-4000-8000-000000000001', 1)
ON CONFLICT (case_id, alert_id) DO NOTHING;

INSERT INTO fraud_complaint
    (complaint_id, case_id, transaction_id, source_institution_id, complaint_reference_token, channel, reported_at, summary, status, source_record_hash)
VALUES
    ('51000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '20000000-0000-4000-8000-000000000001', 101, 'cmp_2026_0001', 'BANK_APP', now() - interval '48 minutes', 'Customer reported an unauthorised transfer from the protected seed account.', 'SUBSTANTIATED', 'demo-complaint-0001')
ON CONFLICT (complaint_id) DO NOTHING;

INSERT INTO evidence_record
    (evidence_id, case_id, source_institution_id, transaction_id, evidence_type, source_record_hash, content_commitment, captured_at, integrity_status, captured_by)
VALUES
    ('40000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 101, '20000000-0000-4000-8000-000000000001', 'SOURCE_TRANSACTION', 'demo-source-0001', 'sha256:1a84_demo_d0f2', now() - interval '38 minutes', 'VERIFIED', 1),
    ('40000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 102, '20000000-0000-4000-8000-000000000002', 'SOURCE_TRANSACTION', 'demo-source-0002', 'sha256:3b91_demo_e27a', now() - interval '35 minutes', 'VERIFIED', 1),
    ('40000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 102, '20000000-0000-4000-8000-000000000002', 'DEVICE_ASSERTION', 'demo-source-0003', 'sha256:5f80_demo_bb43', now() - interval '34 minutes', 'VERIFIED', 1)
ON CONFLICT (evidence_id) DO NOTHING;

INSERT INTO reveal_request
    (reveal_request_id, case_id, requested_by, target_account_id, requested_fields, reason, expires_at)
VALUES
    ('70000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 1, '10000000-0000-4000-8000-000000000002', '["account holder name", "registered mobile"]'::jsonb,
     'Identify the receiving mule account for recovery coordination.', now() + interval '4 hours')
ON CONFLICT (reveal_request_id) DO NOTHING;

INSERT INTO case_note (note_id, case_id, author_investigator_id, note_body, created_at)
VALUES
    ('52000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 1,
     'The first three hops preserve the seed amount closely enough to justify a bounded recovery review. Keep identity fields masked until the source institution confirms necessity.',
     now() - interval '32 minutes')
ON CONFLICT (note_id) DO NOTHING;

INSERT INTO audit_event (case_id, actor_investigator_id, event_type, target_type, target_id, event_payload)
VALUES
    ('11111111-1111-4111-8111-111111111111', 1, 'CASE_CREATED', 'FRAUD_CASE', 'TSX-2026-0001', '{"source":"demo_seed"}'),
    ('11111111-1111-4111-8111-111111111111', 1, 'DATA_INGESTED', 'BATCH', 'demo-batch-0001', '{"transactions":4,"institutions":3}'),
    ('11111111-1111-4111-8111-111111111111', 1, 'EVIDENCE_ADDED', 'EVIDENCE', '40000000-0000-4000-8000-000000000003', '{"integrity":"VERIFIED"}'),
    ('11111111-1111-4111-8111-111111111111', 1, 'REVEAL_REQUESTED', 'REVEAL_REQUEST', '70000000-0000-4000-8000-000000000001', '{"approval_policy":"DUAL_CONTROL"}');

-- Keep identity sequences above the explicit demo investigator/institution ids.
SELECT setval(pg_get_serial_sequence('traceshield.institution', 'institution_id'), GREATEST((SELECT max(institution_id) FROM institution), 1), true);
SELECT setval(pg_get_serial_sequence('traceshield.investigator', 'investigator_id'), GREATEST((SELECT max(investigator_id) FROM investigator), 1), true);
