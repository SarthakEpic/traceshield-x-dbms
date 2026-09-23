import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCaseReport,
  buildInvestigationAnalysis,
  buildPathAnalysis,
  buildRevealRecommendation,
  normalizeCaseUpdate
} from '../investigation-engine.js';

const detail = {
  id: 'case-1',
  caseReference: 'TSX-TEST-0001',
  purpose: 'RECOVERY',
  severity: 'CRITICAL',
  status: 'OPEN',
  description: 'Synthetic protected path',
  riskScore: 0.94,
  transactionCount: 3,
  evidenceCount: 2,
  transactions: [
    { id: 'tx-1', amount: 100, currency: 'INR', rail: 'UPI', occurredAt: '2026-09-20T09:00:00Z', from: { id: 'a', token: 'acct_source', institution: 'Northstar Bank', status: 'ACTIVE' }, to: { id: 'b', token: 'acct_mule', institution: 'Riverbank', status: 'FROZEN' } },
    { id: 'tx-2', amount: 92, currency: 'INR', rail: 'IMPS', occurredAt: '2026-09-20T09:04:00Z', from: { id: 'b', token: 'acct_mule', institution: 'Riverbank', status: 'FROZEN' }, to: { id: 'c', token: 'acct_wallet', institution: 'Civic Wallet', status: 'SUSPENDED' } }
  ],
  paths: [{ id: 'path-1', status: 'GENERATED', riskScore: 0.94, hops: [
    { hopNo: 1, transactionId: 'tx-1', fromAccountId: 'a', toAccountId: 'b', from: { id: 'a', token: 'acct_source', institution: 'Northstar Bank', status: 'ACTIVE' }, to: { id: 'b', token: 'acct_mule', institution: 'Riverbank', status: 'FROZEN' }, amount: 100, gapSeconds: 0, riskScore: 0.83, reason: 'Seed transfer' },
    { hopNo: 2, transactionId: 'tx-2', fromAccountId: 'b', toAccountId: 'c', from: { id: 'b', token: 'acct_mule', institution: 'Riverbank', status: 'FROZEN' }, to: { id: 'c', token: 'acct_wallet', institution: 'Civic Wallet', status: 'SUSPENDED' }, amount: 92, gapSeconds: 240, riskScore: 0.94, reason: 'Rapid cross-institution movement' }
  ] }],
  signals: [{ label: 'Rapid movement', score: 0.92, explanation: 'Transfers occur close together.' }],
  evidence: [{ id: 'e-1', title: 'Source assertion', source: 'Northstar Bank', status: 'VERIFIED', capturedAt: '2026-09-20T09:01:00Z', commitment: 'sha256:test' }],
  complaints: []
};

test('path analysis builds a masked explainable graph', () => {
  const result = buildPathAnalysis(detail.paths[0], detail);
  assert.equal(result.hopCount, 2);
  assert.equal(result.institutionCount, 3);
  assert.equal(result.indicators.crossInstitution, true);
  assert.equal(result.indicators.rapidMovement, true);
  assert.equal(result.amountRetention, 0.92);
  assert.deepEqual(result.highRiskHops, [1, 2]);
  assert.equal(result.graph.nodes.length, 3);
});

test('minimum-disclosure planner rejects unnecessary mobile data for recovery', () => {
  const result = buildRevealRecommendation(detail, {
    requestedFields: ['account holder name', 'registered mobile'],
    reason: 'Identify the receiving account for recovery coordination.'
  });
  assert.deepEqual(result.minimumFields, ['account holder name', 'institution confirmation']);
  assert.deepEqual(result.unnecessaryFields, ['registered mobile']);
  assert.equal(result.requiredApprovals, 2);
});

test('investigation analysis produces a next-action decision', () => {
  const result = buildInvestigationAnalysis(detail);
  assert.equal(result.decision.status, 'HIGH_RISK_REVIEW');
  assert.ok(result.decision.nextActions.length >= 3);
  assert.equal(result.summary.institutionCount, 3);
  assert.equal(result.privacy.policy, 'MINIMUM_NECESSARY_DISCLOSURE');
});

test('case report excludes raw account identifiers', () => {
  const report = buildCaseReport(detail, [{ id: 1, type: 'TRACE_EXECUTED', actor: 'A. Singh', occurredAt: '2026-09-20T09:05:00Z', hash: 'sha256:test' }], { valid: true, checkedEvents: 1 });
  assert.equal(report.privacy.rawIdentityIncluded, false);
  assert.equal('fromAccountId' in report.transactions[0], false);
  assert.equal(report.audit.valid, true);
  assert.ok(report.timeline.length >= 2);
});

test('case updates accept only controlled workflow values', () => {
  assert.deepEqual(normalizeCaseUpdate({ status: 'PAUSED', severity: 'HIGH' }), { status: 'PAUSED', severity: 'HIGH' });
  assert.throws(() => normalizeCaseUpdate({ status: 'DELETED' }), /Invalid case status/);
});
