import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtectedToken, hashCanonical, prepareIngestionBatch } from '../ingestion-engine.js';

const caseId = '11111111-1111-4111-8111-111111111111';
const secret = 'test-secret-that-is-long-enough-for-hmac-2026';

test('protected tokens are deterministic only inside the same context and field namespace', () => {
  const first = createProtectedToken('  Account-001  ', '60000000-0000-4000-8000-000000000001', 'ACCOUNT', secret);
  const same = createProtectedToken('account-001', '60000000-0000-4000-8000-000000000001', 'ACCOUNT', secret);
  const otherContext = createProtectedToken('account-001', '60000000-0000-4000-8000-000000000002', 'ACCOUNT', secret);
  const otherField = createProtectedToken('account-001', '60000000-0000-4000-8000-000000000001', 'IDENTITY', secret);
  assert.equal(first, same);
  assert.notEqual(first, otherContext);
  assert.notEqual(first, otherField);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test('ingestion preparation normalizes records and creates a stable payload commitment', () => {
  const input = {
    caseId,
    sourceInstitutionCode: 'nsb',
    batchReference: 'batch-001',
    sourceSystem: 'bank-adapter',
    records: {
      accounts: [{ sourceAccountRef: ' ACCOUNT 001 ', accountType: 'savings', status: 'active' }],
      transactions: [{
        sourceRecordId: 'tx-001',
        sourceAccountRef: 'ACCOUNT 001',
        receiverAccountRef: 'ACCOUNT 002',
        amount: 100,
        currencyCode: 'inr',
        paymentRail: 'upi',
        occurredAt: '2026-10-15T10:00:00Z',
        observedAt: '2026-10-15T10:01:00Z',
        caseRelevance: 'seed'
      }]
    }
  };
  const first = prepareIngestionBatch(input);
  const second = prepareIngestionBatch(structuredClone(input));
  assert.equal(first.sourceInstitutionCode, 'NSB');
  assert.equal(first.records.accounts[0].sourceAccountRef, 'account 001');
  assert.equal(first.records.transactions[0].caseRelevance, 'SEED');
  assert.equal(first.recordCount, 2);
  assert.equal(first.payloadHash, second.payloadHash);
  assert.match(hashCanonical(first.records), /^sha256:[0-9a-f]{64}$/);
});

test('ingestion preparation rejects unsafe temporal and evidence references', () => {
  assert.throws(() => prepareIngestionBatch({
    caseId,
    sourceInstitutionCode: 'NSB',
    batchReference: 'batch-time-invalid',
    records: { transactions: [{ sourceRecordId: 'tx', sourceAccountRef: 'a', receiverAccountRef: 'b', amount: 1, occurredAt: '2026-10-15T10:02:00Z', observedAt: '2026-10-15T10:01:00Z' }] }
  }), /observedAt cannot be before occurredAt/);
  assert.throws(() => prepareIngestionBatch({
    caseId,
    sourceInstitutionCode: 'NSB',
    batchReference: 'batch-evidence-invalid',
    records: { evidence: [{ evidenceType: 'SOURCE_TRANSACTION', sourceRecordHash: 'evidence', contentCommitment: 'sha256:test' }] }
  }), /must reference a transaction, account, device, or network record/);
  assert.throws(() => prepareIngestionBatch({
    caseId,
    sourceInstitutionCode: 'NSB',
    batchReference: 'batch-evidence-multi-target',
    records: { evidence: [{ evidenceType: 'DOCUMENT', sourceRecordHash: 'evidence', contentCommitment: 'sha256:test', accountSourceRef: 'a', deviceSourceRef: 'device-a' }] }
  }), /must reference exactly one protected target/);
});
