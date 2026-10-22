-- TraceShield X presentation seed
-- Apply after TraceShield_X_demo_seed.sql and TraceShield_X_schema.sql.
-- All values are synthetic and protected. This adds realistic case variety
-- without introducing raw names, phone numbers, emails, or government IDs.

SET search_path = traceshield, public;

BEGIN;

-- Apply this file with the local schema-owner/admin connection. The restricted
-- application role is intentionally not allowed to seed every protected table.
-- The session settings below document the investigator boundary used by the app.
SELECT set_config('traceshield.investigator_id', '1', true);
SELECT set_config('traceshield.institution_id', '101', true);

INSERT INTO fraud_case
    (case_id, case_reference, opened_by, severity, purpose_code, status, description, case_nonce_commitment, opened_at, expires_at)
VALUES
    ('22222222-2222-4222-8222-222222222222', 'TSX-2026-0002', 1, 'MEDIUM', 'AML_REVIEW', 'OPEN',
     'Shared device review across two merchant accounts', 'presentation-case-0002', now() - interval '3 days', now() + interval '11 days'),
    ('33333333-3333-4333-8333-333333333333', 'TSX-2026-0003', 1, 'HIGH', 'RECOVERY', 'REOPENED',
     'Cross-institution wallet exit with a disputed beneficiary', 'presentation-case-0003', now() - interval '2 days', now() + interval '12 days'),
    ('44444444-4444-4444-8444-444444444444', 'TSX-2026-0004', 1, 'LOW', 'AUDIT', 'CLOSED',
     'Resolved false positive involving a shared household network', 'presentation-case-0004', now() - interval '10 days', now() + interval '4 days'),
    ('55555555-5555-4555-8555-555555555555', 'TSX-2026-0005', 1, 'HIGH', 'FRAUD_INVESTIGATION', 'PAUSED',
     'Merchant refund loop with repeated device activity', 'presentation-case-0005', now() - interval '1 day', now() + interval '13 days')
ON CONFLICT (case_id) DO NOTHING;

INSERT INTO case_access (case_id, investigator_id, access_level, granted_by, expires_at)
VALUES
    ('22222222-2222-4222-8222-222222222222', 1, 'INVESTIGATOR', 1, now() + interval '11 days'),
    ('33333333-3333-4333-8333-333333333333', 1, 'INVESTIGATOR', 1, now() + interval '12 days'),
    ('44444444-4444-4444-8444-444444444444', 1, 'INVESTIGATOR', 1, now() + interval '4 days'),
    ('55555555-5555-4555-8555-555555555555', 1, 'INVESTIGATOR', 1, now() + interval '13 days')
ON CONFLICT (case_id, investigator_id) DO NOTHING;

INSERT INTO token_context
    (context_id, case_id, epoch_no, token_version, purpose_code, context_fingerprint, created_by, expires_at)
VALUES
    ('60000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 0, 1, 'AML_REVIEW', 'presentation-context-0002', 1, now() + interval '11 days'),
    ('60000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 0, 1, 'RECOVERY', 'presentation-context-0003', 1, now() + interval '12 days'),
    ('60000000-0000-4000-8000-000000000004', '44444444-4444-4444-8444-444444444444', 0, 1, 'AUDIT', 'presentation-context-0004', 1, now() + interval '4 days'),
    ('60000000-0000-4000-8000-000000000005', '55555555-5555-4555-8555-555555555555', 0, 1, 'FRAUD_INVESTIGATION', 'presentation-context-0005', 1, now() + interval '13 days')
ON CONFLICT (context_id) DO NOTHING;

-- Case 1 already contains the richest seed data. Persist its explainable path
-- so a presentation starts with a completed trace instead of an empty panel.
INSERT INTO fund_path
    (path_id, case_id, start_account_id, end_account_id, path_status, hop_count, risk_score, certificate_hash, generated_by, generated_at)
VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'GENERATED', 3, 0.94, 'sha256:presentation-path-0001', 1, now() - interval '26 minutes')
ON CONFLICT (path_id) DO NOTHING;

INSERT INTO path_hop
    (path_id, hop_no, transaction_id, from_account_id, to_account_id, amount_bucket, temporal_gap_seconds, hop_risk_score, provenance_hash)
VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '45k-50k INR', 0, 0.83, 'sha256:presentation-hop-0001'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 2, '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', '45k-50k INR', 271, 0.92, 'sha256:presentation-hop-0002'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 3, '20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', '45k-50k INR', 218, 0.97, 'sha256:presentation-hop-0003')
ON CONFLICT (path_id, hop_no) DO NOTHING;

INSERT INTO bank_account
    (account_id, context_id, institution_id, account_token_digest, account_type, status, source_record_hash)
VALUES
    ('11000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', 101, 'b2c7a1e80411', 'SAVINGS', 'ACTIVE', 'presentation-account-0201'),
    ('11000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 103, 'c9d4e2b71022', 'WALLET', 'ACTIVE', 'presentation-account-0202'),
    ('11000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000002', 103, 'a7e3f1c92033', 'MERCHANT', 'ACTIVE', 'presentation-account-0203'),
    ('11000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000002', 103, 'd4f2b8a63044', 'MERCHANT', 'SUSPENDED', 'presentation-account-0204'),
    ('12000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003', 102, 'e5a2c8d74011', 'SAVINGS', 'ACTIVE', 'presentation-account-0301'),
    ('12000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000003', 101, 'f1b7d3e85022', 'CURRENT', 'FROZEN', 'presentation-account-0302'),
    ('12000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000003', 103, 'a6c4e9f96033', 'WALLET', 'SUSPENDED', 'presentation-account-0303'),
    ('12000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000003', 103, 'b8d5f2a17044', 'MERCHANT', 'SUSPENDED', 'presentation-account-0304'),
    ('13000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000004', 102, 'c3e7a9b28011', 'SAVINGS', 'ACTIVE', 'presentation-account-0401'),
    ('13000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000004', 102, 'd8f4b1c39022', 'CURRENT', 'ACTIVE', 'presentation-account-0402'),
    ('14000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000005', 102, 'e2a6c7d48011', 'SAVINGS', 'ACTIVE', 'presentation-account-0501'),
    ('14000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000005', 103, 'f7b3d8e59022', 'MERCHANT', 'ACTIVE', 'presentation-account-0502'),
    ('14000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000005', 103, 'a4c9e1f61033', 'WALLET', 'SUSPENDED', 'presentation-account-0503')
ON CONFLICT (account_id) DO NOTHING;

INSERT INTO device_token
    (device_id, context_id, source_institution_id, device_token_digest, device_type, os_family, source_record_hash)
VALUES
    ('33000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 103, 'device-2d7a9b', 'MOBILE', 'ANDROID', 'presentation-device-0002'),
    ('33000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000003', 102, 'device-3f8c1d', 'MOBILE', 'IOS', 'presentation-device-0003'),
    ('33000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000004', 102, 'device-4a2e6f', 'MOBILE', 'ANDROID', 'presentation-device-0004'),
    ('33000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000005', 103, 'device-5c1b8e', 'MOBILE', 'ANDROID', 'presentation-device-0005')
ON CONFLICT (device_id) DO NOTHING;

INSERT INTO network_token
    (network_id, context_id, source_institution_id, network_token_digest, network_type, country_code, source_record_hash)
VALUES
    ('31000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 103, 'network-2b6e10', 'IPV4', 'IN', 'presentation-network-0002'),
    ('31000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000003', 102, 'network-3c7f21', 'PROXY', 'IN', 'presentation-network-0003'),
    ('31000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000004', 102, 'network-4d8a32', 'IPV4', 'IN', 'presentation-network-0004'),
    ('31000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000005', 103, 'network-5e9b43', 'VPN', 'IN', 'presentation-network-0005')
ON CONFLICT (network_id) DO NOTHING;

INSERT INTO payment_transaction
    (transaction_id, context_id, source_institution_id, sender_account_id, receiver_account_id, transaction_reference_token,
     amount, currency_code, payment_rail, transaction_type, transaction_status, occurred_at, source_record_hash)
VALUES
    ('21000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', 101, '11000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'txn_02a1_b7c4', 18600.00, 'INR', 'UPI', 'TRANSFER', 'SETTLED', now() - interval '3 days 3 hours', 'presentation-txn-0201'),
    ('21000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 103, '11000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', 'txn_02b2_c8d5', 17850.00, 'INR', 'CARD', 'TRANSFER', 'SETTLED', now() - interval '3 days 2 hours 59 minutes', 'presentation-txn-0202'),
    ('21000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000002', 103, '11000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000004', 'txn_02c3_d9e6', 16900.00, 'INR', 'CASH_OUT', 'CASH_OUT', 'BLOCKED', now() - interval '3 days 2 hours 56 minutes', 'presentation-txn-0203'),
    ('22000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003', 102, '12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', 'txn_03a1_e7f4', 76200.00, 'INR', 'NEFT', 'TRANSFER', 'SETTLED', now() - interval '2 days 5 hours', 'presentation-txn-0301'),
    ('22000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000003', 101, '12000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000003', 'txn_03b2_f8a5', 74900.00, 'INR', 'IMPS', 'TRANSFER', 'SETTLED', now() - interval '2 days 4 hours 55 minutes', 'presentation-txn-0302'),
    ('22000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000003', 103, '12000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000004', 'txn_03c3_a9b6', 73800.00, 'INR', 'WALLET', 'TRANSFER', 'SETTLED', now() - interval '2 days 4 hours 51 minutes', 'presentation-txn-0303'),
    ('23000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000004', 102, '13000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002', 'txn_04a1_b7c4', 8200.00, 'INR', 'UPI', 'TRANSFER', 'SETTLED', now() - interval '10 days 2 hours', 'presentation-txn-0401'),
    ('23000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000004', 102, '13000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000001', 'txn_04b2_c8d5', 8200.00, 'INR', 'UPI', 'REFUND', 'SETTLED', now() - interval '10 days 1 hours 58 minutes', 'presentation-txn-0402'),
    ('24000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000005', 102, '14000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', 'txn_05a1_d7c4', 32400.00, 'INR', 'UPI', 'TRANSFER', 'SETTLED', now() - interval '1 day 4 hours', 'presentation-txn-0501'),
    ('24000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000005', 103, '14000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000003', 'txn_05b2_e8d5', 31800.00, 'INR', 'WALLET', 'REFUND', 'PENDING', now() - interval '1 day 3 hours 57 minutes', 'presentation-txn-0502')
ON CONFLICT (transaction_id) DO NOTHING;

INSERT INTO account_observation
    (observation_id, account_id, device_id, network_id, transaction_id, observed_at, confidence_score, source_record_hash)
VALUES
    ('34000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', now() - interval '3 days 2 hours 58 minutes', 0.94, 'presentation-observation-0002'),
    ('34000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000002', now() - interval '2 days 4 hours 54 minutes', 0.97, 'presentation-observation-0003'),
    ('34000000-0000-4000-8000-000000000004', '13000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000004', '31000000-0000-4000-8000-000000000004', '23000000-0000-4000-8000-000000000001', now() - interval '10 days 2 hours', 0.88, 'presentation-observation-0004'),
    ('34000000-0000-4000-8000-000000000005', '14000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000005', '31000000-0000-4000-8000-000000000005', '24000000-0000-4000-8000-000000000002', now() - interval '1 day 3 hours 56 minutes', 0.91, 'presentation-observation-0005')
ON CONFLICT (observation_id) DO NOTHING;

INSERT INTO case_transaction (case_id, transaction_id, relevance, added_by)
VALUES
    ('22222222-2222-4222-8222-222222222222', '21000000-0000-4000-8000-000000000001', 'SEED', 1),
    ('22222222-2222-4222-8222-222222222222', '21000000-0000-4000-8000-000000000002', 'CONFIRMED', 1),
    ('22222222-2222-4222-8222-222222222222', '21000000-0000-4000-8000-000000000003', 'CANDIDATE', 1),
    ('33333333-3333-4333-8333-333333333333', '22000000-0000-4000-8000-000000000001', 'SEED', 1),
    ('33333333-3333-4333-8333-333333333333', '22000000-0000-4000-8000-000000000002', 'CONFIRMED', 1),
    ('33333333-3333-4333-8333-333333333333', '22000000-0000-4000-8000-000000000003', 'CONFIRMED', 1),
    ('44444444-4444-4444-8444-444444444444', '23000000-0000-4000-8000-000000000001', 'SEED', 1),
    ('44444444-4444-4444-8444-444444444444', '23000000-0000-4000-8000-000000000002', 'CONFIRMED', 1),
    ('55555555-5555-4555-8555-555555555555', '24000000-0000-4000-8000-000000000001', 'SEED', 1),
    ('55555555-5555-4555-8555-555555555555', '24000000-0000-4000-8000-000000000002', 'CANDIDATE', 1)
ON CONFLICT (case_id, transaction_id) DO NOTHING;

INSERT INTO transaction_signal (signal_id, transaction_id, signal_type, signal_score, explanation, generated_by)
VALUES
    ('32000000-0000-4000-8000-000000000005', '21000000-0000-4000-8000-000000000002', 'DEVICE_REUSE', 0.71, 'The same protected device token appears across two merchant endpoints.', 'presentation-scorer'),
    ('32000000-0000-4000-8000-000000000006', '21000000-0000-4000-8000-000000000003', 'TIME_GAP', 0.62, 'A blocked cash-out followed the merchant transfer within a short window.', 'presentation-scorer'),
    ('32000000-0000-4000-8000-000000000007', '22000000-0000-4000-8000-000000000002', 'CROSS_BANK', 0.89, 'The disputed beneficiary path crosses a bank and a wallet boundary.', 'presentation-scorer'),
    ('32000000-0000-4000-8000-000000000008', '22000000-0000-4000-8000-000000000003', 'AMOUNT_CONSERVATION', 0.84, 'The path retains most of the original amount before the wallet exit.', 'presentation-scorer'),
    ('32000000-0000-4000-8000-000000000009', '23000000-0000-4000-8000-000000000002', 'NETWORK_REUSE', 0.32, 'The same protected household network is consistent with the refund pair.', 'presentation-scorer'),
    ('32000000-0000-4000-8000-000000000010', '24000000-0000-4000-8000-000000000002', 'FAN_IN', 0.78, 'The pending refund enters a suspended wallet after a merchant loop.', 'presentation-scorer')
ON CONFLICT (signal_id) DO NOTHING;

INSERT INTO fraud_alert (alert_id, source_institution_id, alert_type, severity, description)
VALUES
    ('50000000-0000-4000-8000-000000000002', 101, 'RULE', 'MEDIUM', 'Synthetic shared-device rule match across merchant endpoints.'),
    ('50000000-0000-4000-8000-000000000003', 101, 'AUTHORITY_REFERRAL', 'HIGH', 'Synthetic recovery referral for a disputed wallet beneficiary.'),
    ('50000000-0000-4000-8000-000000000004', 101, 'MANUAL', 'LOW', 'Synthetic audit review opened for a refund pair.'),
    ('50000000-0000-4000-8000-000000000005', 101, 'RULE', 'HIGH', 'Synthetic merchant refund-loop rule match.')
ON CONFLICT (alert_id) DO NOTHING;

INSERT INTO alert_transaction (alert_id, transaction_id, relevance_score)
VALUES
    ('50000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', 0.82),
    ('50000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000003', 0.96),
    ('50000000-0000-4000-8000-000000000004', '23000000-0000-4000-8000-000000000002', 0.64),
    ('50000000-0000-4000-8000-000000000005', '24000000-0000-4000-8000-000000000002', 0.88)
ON CONFLICT (alert_id, transaction_id) DO NOTHING;

INSERT INTO case_alert (case_id, alert_id, added_by)
VALUES
    ('22222222-2222-4222-8222-222222222222', '50000000-0000-4000-8000-000000000002', 1),
    ('33333333-3333-4333-8333-333333333333', '50000000-0000-4000-8000-000000000003', 1),
    ('44444444-4444-4444-8444-444444444444', '50000000-0000-4000-8000-000000000004', 1),
    ('55555555-5555-4555-8555-555555555555', '50000000-0000-4000-8000-000000000005', 1)
ON CONFLICT (case_id, alert_id) DO NOTHING;

INSERT INTO fraud_complaint
    (complaint_id, case_id, transaction_id, source_institution_id, complaint_reference_token, channel, reported_at, summary, status, source_record_hash)
VALUES
    ('51000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', '21000000-0000-4000-8000-000000000001', 101, 'cmp_2026_0002', 'CALL_CENTER', now() - interval '3 days 4 hours', 'Merchant dispute linked to a protected payment reference.', 'UNDER_REVIEW', 'presentation-complaint-0002'),
    ('51000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', '22000000-0000-4000-8000-000000000001', 101, 'cmp_2026_0003', 'AUTHORITY', now() - interval '2 days 6 hours', 'Recovery authority requested a bounded review of the beneficiary route.', 'SUBSTANTIATED', 'presentation-complaint-0003'),
    ('51000000-0000-4000-8000-000000000004', '44444444-4444-4444-8444-444444444444', '23000000-0000-4000-8000-000000000001', 101, 'cmp_2026_0004', 'BANK_APP', now() - interval '10 days 3 hours', 'Customer confirmed the refund pair after a source check.', 'DISMISSED', 'presentation-complaint-0004'),
    ('51000000-0000-4000-8000-000000000005', '55555555-5555-4555-8555-555555555555', '24000000-0000-4000-8000-000000000001', 101, 'cmp_2026_0005', 'BANK_APP', now() - interval '1 day 5 hours', 'Merchant reported a repeated refund destination.', 'OPEN', 'presentation-complaint-0005')
ON CONFLICT (complaint_id) DO NOTHING;

INSERT INTO fund_path
    (path_id, case_id, start_account_id, end_account_id, path_status, hop_count, risk_score, certificate_hash, generated_by, generated_at)
VALUES
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', '11000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000004', 'REVIEWED', 3, 0.68, 'sha256:presentation-path-0002', 1, now() - interval '2 days 22 hours'),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '33333333-3333-4333-8333-333333333333', '12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000004', 'GENERATED', 3, 0.89, 'sha256:presentation-path-0003', 1, now() - interval '2 days 4 hours'),
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '55555555-5555-4555-8555-555555555555', '14000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000003', 'GENERATED', 2, 0.82, 'sha256:presentation-path-0005', 1, now() - interval '1 day 3 hours')
ON CONFLICT (path_id) DO NOTHING;

INSERT INTO path_hop
    (path_id, hop_no, transaction_id, from_account_id, to_account_id, amount_bucket, temporal_gap_seconds, hop_risk_score, provenance_hash)
VALUES
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1, '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', '15k-20k INR', 0, 0.61, 'sha256:presentation-hop-0201'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2, '21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', '15k-20k INR', 9, 0.68, 'sha256:presentation-hop-0202'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 3, '21000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000004', '15k-20k INR', 180, 0.72, 'sha256:presentation-hop-0203'),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 1, '22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', '70k-80k INR', 0, 0.82, 'sha256:presentation-hop-0301'),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 2, '22000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000003', '70k-80k INR', 300, 0.88, 'sha256:presentation-hop-0302'),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 3, '22000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000004', '70k-80k INR', 240, 0.91, 'sha256:presentation-hop-0303'),
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 1, '24000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', '30k-35k INR', 0, 0.78, 'sha256:presentation-hop-0501'),
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 2, '24000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000003', '30k-35k INR', 243, 0.84, 'sha256:presentation-hop-0502')
ON CONFLICT (path_id, hop_no) DO NOTHING;

INSERT INTO evidence_record
    (evidence_id, case_id, source_institution_id, transaction_id, evidence_type, source_record_hash, content_commitment, captured_at, integrity_status, captured_by)
VALUES
    ('40000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 101, '21000000-0000-4000-8000-000000000001', 'SOURCE_TRANSACTION', 'presentation-evidence-0201', 'sha256:presentation-evidence-0201', now() - interval '3 days 2 hours', 'VERIFIED', 1),
    ('40000000-0000-4000-8000-000000000005', '22222222-2222-4222-8222-222222222222', 103, '21000000-0000-4000-8000-000000000002', 'DEVICE_ASSERTION', 'presentation-evidence-0202', 'sha256:presentation-evidence-0202', now() - interval '3 days 2 hours', 'VERIFIED', 1),
    ('40000000-0000-4000-8000-000000000006', '33333333-3333-4333-8333-333333333333', 101, '22000000-0000-4000-8000-000000000001', 'SOURCE_TRANSACTION', 'presentation-evidence-0301', 'sha256:presentation-evidence-0301', now() - interval '2 days 4 hours', 'VERIFIED', 1),
    ('40000000-0000-4000-8000-000000000007', '33333333-3333-4333-8333-333333333333', 103, '22000000-0000-4000-8000-000000000003', 'PATH_CERTIFICATE', 'presentation-evidence-0302', 'sha256:presentation-evidence-0302', now() - interval '2 days 4 hours', 'CONFLICTING', 1),
    ('40000000-0000-4000-8000-000000000008', '44444444-4444-4444-8444-444444444444', 102, '23000000-0000-4000-8000-000000000002', 'SOURCE_TRANSACTION', 'presentation-evidence-0401', 'sha256:presentation-evidence-0401', now() - interval '10 days 1 hours', 'VERIFIED', 1),
    ('40000000-0000-4000-8000-000000000009', '55555555-5555-4555-8555-555555555555', 103, '24000000-0000-4000-8000-000000000002', 'SOURCE_TRANSACTION', 'presentation-evidence-0501', 'sha256:presentation-evidence-0501', now() - interval '1 day 3 hours', 'UNVERIFIED', 1)
ON CONFLICT (evidence_id) DO NOTHING;

INSERT INTO reveal_request
    (reveal_request_id, case_id, requested_by, target_account_id, requested_fields, reason, expires_at)
VALUES
    ('70000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 1, '11000000-0000-4000-8000-000000000003', '["account holder name"]'::jsonb,
     'Confirm whether the merchant endpoint belongs to the same protected operator.', now() + interval '3 days'),
    ('70000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 1, '12000000-0000-4000-8000-000000000003', '["registered mobile", "account holder name"]'::jsonb,
     'Coordinate recovery after the disputed beneficiary path is confirmed.', now() + interval '2 days')
ON CONFLICT (reveal_request_id) DO NOTHING;

INSERT INTO case_note (note_id, case_id, author_investigator_id, note_body, created_at)
VALUES
    ('52000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 1,
     'The device overlap is useful context, but the merchant relationship should be checked before any identity request is approved.', now() - interval '2 days 20 hours'),
    ('52000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 1,
     'The recovery path is strong but one certificate conflicts with the wallet assertion. Keep the case reopened until the source re-check returns.', now() - interval '2 days 3 hours'),
    ('52000000-0000-4000-8000-000000000004', '44444444-4444-4444-8444-444444444444', 1,
     'The refund pair and shared network are consistent with a household explanation. No further identity detail is needed.', now() - interval '9 days'),
    ('52000000-0000-4000-8000-000000000005', '55555555-5555-4555-8555-555555555555', 1,
     'Pause the review until the pending refund is resolved and the merchant source confirms the destination token.', now() - interval '1 day 2 hours')
ON CONFLICT (note_id) DO NOTHING;

INSERT INTO audit_event (case_id, actor_investigator_id, event_type, target_type, target_id, event_payload)
SELECT seed.case_id, seed.actor_investigator_id, seed.event_type, seed.target_type, seed.target_id, seed.event_payload
FROM (VALUES
    ('22222222-2222-4222-8222-222222222222'::uuid, 1, 'CASE_CREATED', 'FRAUD_CASE', 'TSX-2026-0002', '{"source":"presentation_seed","scenario":"shared_device"}'::jsonb),
    ('22222222-2222-4222-8222-222222222222'::uuid, 1, 'DATA_INGESTED', 'BATCH', 'presentation-batch-0002', '{"transactions":3,"institutions":2}'::jsonb),
    ('22222222-2222-4222-8222-222222222222'::uuid, 1, 'TRACE_EXECUTED', 'FUND_PATH', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{"hopCount":3,"riskScore":0.68}'::jsonb),
    ('22222222-2222-4222-8222-222222222222'::uuid, 1, 'REVEAL_REQUESTED', 'REVEAL_REQUEST', '70000000-0000-4000-8000-000000000002', '{"approval_policy":"DUAL_CONTROL"}'::jsonb),
    ('33333333-3333-4333-8333-333333333333'::uuid, 1, 'CASE_CREATED', 'FRAUD_CASE', 'TSX-2026-0003', '{"source":"presentation_seed","scenario":"recovery"}'::jsonb),
    ('33333333-3333-4333-8333-333333333333'::uuid, 1, 'DATA_INGESTED', 'BATCH', 'presentation-batch-0003', '{"transactions":3,"institutions":3}'::jsonb),
    ('33333333-3333-4333-8333-333333333333'::uuid, 1, 'TRACE_EXECUTED', 'FUND_PATH', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '{"hopCount":3,"riskScore":0.89}'::jsonb),
    ('33333333-3333-4333-8333-333333333333'::uuid, 1, 'REVEAL_REQUESTED', 'REVEAL_REQUEST', '70000000-0000-4000-8000-000000000003', '{"approval_policy":"DUAL_CONTROL"}'::jsonb),
    ('44444444-4444-4444-8444-444444444444'::uuid, 1, 'CASE_CREATED', 'FRAUD_CASE', 'TSX-2026-0004', '{"source":"presentation_seed","scenario":"false_positive"}'::jsonb),
    ('44444444-4444-4444-8444-444444444444'::uuid, 1, 'CASE_CLOSED', 'FRAUD_CASE', 'TSX-2026-0004', '{"reason":"source_assertions_reconciled"}'::jsonb),
    ('55555555-5555-4555-8555-555555555555'::uuid, 1, 'CASE_CREATED', 'FRAUD_CASE', 'TSX-2026-0005', '{"source":"presentation_seed","scenario":"refund_loop"}'::jsonb),
    ('55555555-5555-4555-8555-555555555555'::uuid, 1, 'CASE_STATUS_CHANGED', 'FRAUD_CASE', 'TSX-2026-0005', '{"status":"PAUSED"}'::jsonb)
) AS seed(case_id, actor_investigator_id, event_type, target_type, target_id, event_payload)
WHERE NOT EXISTS (
    SELECT 1
    FROM audit_event existing
    WHERE existing.case_id = seed.case_id
      AND existing.event_type = seed.event_type
      AND existing.target_id = seed.target_id
);

COMMIT;
