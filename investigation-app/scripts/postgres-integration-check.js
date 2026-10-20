import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signAdapterRequest } from '../adapter-security.js';

const baseUrl = String(process.env.TRACESHIELD_BASE_URL || 'http://127.0.0.1:4172').replace(/\/$/, '');
const loginName = String(process.env.TRACESHIELD_TEST_LOGIN || '').trim();
const password = String(process.env.TRACESHIELD_TEST_PASSWORD || '');
const adapterSecret = String(process.env.TRACESHIELD_ADAPTER_SIGNING_SECRET || '');
if (!loginName || !password) {
  throw new Error('Set TRACESHIELD_TEST_LOGIN and TRACESHIELD_TEST_PASSWORD for the PostgreSQL integration check.');
}

let sessionCookie = '';

function cookieFromResponse(response) {
  const value = response.headers.get('set-cookie') || '';
  return value.split(';')[0] || '';
}

async function request(route, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (sessionCookie) headers.Cookie = sessionCookie;
  const response = await fetch(`${baseUrl}${route}`, { ...options, headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

function expectStatus(result, status, label) {
  assert.equal(result.response.status, status, `${label}: ${JSON.stringify(result.body)}`);
}

function commitment(label) {
  return `sha256:${crypto.createHash('sha256').update(label).digest('hex')}`;
}

function adapterHeaders(body) {
  return adapterSecret ? signAdapterRequest(body, adapterSecret) : {};
}

const health = await request('/api/health');
expectStatus(health, 200, 'health');
assert.equal(health.body.mode, 'postgres');
assert.equal(health.body.status, 'ok');

const unauthenticatedCases = await request('/api/cases');
expectStatus(unauthenticatedCases, 401, 'unauthenticated case access');

const login = await request('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ loginName, password })
});
expectStatus(login, 200, 'login');
sessionCookie = cookieFromResponse(login.response);
assert.match(sessionCookie, /^traceshield_session=/);

const authenticatedSession = await request('/api/auth/session');
expectStatus(authenticatedSession, 200, 'authenticated session');
assert.equal(authenticatedSession.body.authenticated, true);

const crossOriginMutation = await request('/api/cases', {
  method: 'POST',
  headers: { Origin: 'https://attacker.invalid' },
  body: JSON.stringify({ caseReference: 'blocked', description: 'blocked' })
});
expectStatus(crossOriginMutation, 403, 'cross-origin mutation');

const institutions = await request('/api/institutions');
expectStatus(institutions, 200, 'institutions');
const investigatorInstitution = institutions.body.find(
  (institution) => Number(institution.id) === Number(authenticatedSession.body.investigator.institutionId)
);
const sourceInstitutionCode = String(
  process.env.TRACESHIELD_TEST_INSTITUTION || investigatorInstitution?.code || ''
).toUpperCase();
assert.ok(sourceInstitutionCode, 'An active source institution must be available.');

const suffix = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const caseResult = await request('/api/cases', {
  method: 'POST',
  body: JSON.stringify({
    caseReference: `E2E-${suffix}`,
    description: 'Automated end-to-end verification of protected institution ingestion.',
    severity: 'HIGH',
    purpose: 'FRAUD_INVESTIGATION'
  })
});
expectStatus(caseResult, 201, 'case creation');
const caseId = caseResult.body.id;
assert.match(caseId, /^[0-9a-f-]{36}$/i);

const senderRef = `e2e-sender-${suffix}`;
const receiverRef = `e2e-receiver-${suffix}`;
const deviceRef = `e2e-device-${suffix}`;
const networkRef = `e2e-network-${suffix}`;
const transactionSourceRecordId = `e2e-transaction-${suffix}`;
const occurredAt = new Date(Date.now() - 60_000).toISOString();
const observedAt = new Date().toISOString();
const batch = {
  caseId,
  sourceInstitutionCode,
  batchReference: `e2e-batch-${suffix}`,
  sourceSystem: 'trace-shield-e2e-adapter',
  records: {
    accounts: [
      { sourceAccountRef: senderRef, accountType: 'SAVINGS', status: 'ACTIVE' },
      { sourceAccountRef: receiverRef, accountType: 'CURRENT', status: 'ACTIVE' }
    ],
    devices: [
      { sourceDeviceRef: deviceRef, deviceType: 'MOBILE', osFamily: 'ANDROID', manufacturer: 'E2E' }
    ],
    networks: [
      { sourceNetworkRef: networkRef, networkType: 'IPV4', countryCode: 'IN', ispName: 'E2E Network' }
    ],
    transactions: [
      {
        sourceRecordId: transactionSourceRecordId,
        sourceAccountRef: senderRef,
        receiverAccountRef: receiverRef,
        amount: 1250,
        currencyCode: 'INR',
        paymentRail: 'UPI',
        transactionType: 'TRANSFER',
        transactionStatus: 'COMPLETED',
        occurredAt,
        observedAt,
        caseRelevance: 'SEED'
      }
    ],
    observations: [
      {
        sourceAccountRef: senderRef,
        sourceDeviceRef: deviceRef,
        sourceNetworkRef: networkRef,
        sourceRecordId: transactionSourceRecordId,
        observedAt,
        confidenceScore: 0.98
      }
    ],
    evidence: [
      {
        evidenceType: 'SOURCE_TRANSACTION',
        transactionSourceRecordId,
        sourceRecordHash: commitment(`transaction-evidence-${suffix}`),
        contentCommitment: commitment(`transaction-content-${suffix}`),
        capturedAt: observedAt,
        integrityStatus: 'VERIFIED'
      },
      {
        evidenceType: 'ACCOUNT_ASSERTION',
        accountSourceRef: receiverRef,
        sourceRecordHash: commitment(`account-evidence-${suffix}`),
        contentCommitment: commitment(`account-content-${suffix}`),
        capturedAt: observedAt,
        integrityStatus: 'VERIFIED'
      },
      {
        evidenceType: 'DEVICE_ASSERTION',
        deviceSourceRef: deviceRef,
        sourceRecordHash: commitment(`device-evidence-${suffix}`),
        contentCommitment: commitment(`device-content-${suffix}`),
        capturedAt: observedAt,
        integrityStatus: 'VERIFIED'
      },
      {
        evidenceType: 'NETWORK_ASSERTION',
        networkSourceRef: networkRef,
        sourceRecordHash: commitment(`network-evidence-${suffix}`),
        contentCommitment: commitment(`network-content-${suffix}`),
        capturedAt: observedAt,
        integrityStatus: 'VERIFIED'
      }
    ]
  }
};

const applied = await request('/api/ingestion/batches', {
  method: 'POST',
  headers: adapterHeaders(batch),
  body: JSON.stringify(batch)
});
expectStatus(applied, 201, 'first ingestion');
assert.equal(applied.body.status, 'APPLIED');
assert.equal(applied.body.caseId, caseId);
assert.equal(applied.body.counts.accounts, 2);
assert.equal(applied.body.counts.devices, 1);
assert.equal(applied.body.counts.networks, 1);
assert.equal(applied.body.counts.transactions, 1);
assert.equal(applied.body.counts.observations, 1);
assert.equal(applied.body.counts.evidence, 4);

let consoleIngestion = null;
if (health.body.consoleIngestionEnabled) {
  consoleIngestion = await request('/api/ingestion/console', {
    method: 'POST',
    body: JSON.stringify(batch)
  });
  expectStatus(consoleIngestion, 200, 'console adapter duplicate replay');
  assert.equal(consoleIngestion.body.status, 'DUPLICATE');
}

const replay = await request('/api/ingestion/batches', {
  method: 'POST',
  headers: adapterHeaders(batch),
  body: JSON.stringify(batch)
});
expectStatus(replay, 200, 'idempotent replay');
assert.equal(replay.body.status, 'DUPLICATE');
assert.equal(replay.body.batchId, applied.body.batchId);

const conflictingBatch = structuredClone(batch);
conflictingBatch.sourceSystem = 'different-adapter-payload';
const conflict = await request('/api/ingestion/batches', {
  method: 'POST',
  headers: adapterHeaders(conflictingBatch),
  body: JSON.stringify(conflictingBatch)
});
expectStatus(conflict, 409, 'conflicting replay');

const rollbackBatch = structuredClone(batch);
rollbackBatch.batchReference = `${batch.batchReference}-rollback`;
rollbackBatch.records.evidence[2].deviceSourceRef = `e2e-missing-device-${suffix}`;
const rollback = await request('/api/ingestion/batches', {
  method: 'POST',
  headers: adapterHeaders(rollbackBatch),
  body: JSON.stringify(rollbackBatch)
});
expectStatus(rollback, 422, 'invalid evidence rollback');

const detail = await request(`/api/cases/${caseId}`);
expectStatus(detail, 200, 'case detail');
assert.equal(detail.body.transactionCount, 1);
assert.equal(detail.body.evidenceCount, 4);

const batches = await request(`/api/ingestion/batches?caseId=${encodeURIComponent(caseId)}`);
expectStatus(batches, 200, 'ingestion list');
const listedBatch = batches.body.find((item) => item.id === applied.body.batchId);
assert.ok(listedBatch, 'The applied batch must be visible in the protected case view.');
assert.equal(listedBatch.contextId, applied.body.contextId);
assert.equal(batches.body.some((item) => item.batchReference === rollbackBatch.batchReference), false);

const audit = await request(`/api/audit/verify?caseId=${encodeURIComponent(caseId)}`);
expectStatus(audit, 200, 'audit verification');
assert.equal(audit.body.valid, true);

const logout = await request('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
expectStatus(logout, 200, 'logout');
const postLogoutSession = await request('/api/session');
expectStatus(postLogoutSession, 401, 'revoked session access');

console.log(JSON.stringify({
  ok: true,
  caseId,
  batchId: applied.body.batchId,
  contextId: applied.body.contextId,
  sourceInstitutionCode,
  appliedStatus: applied.body.status,
  replayStatus: replay.body.status,
  conflictStatus: conflict.response.status,
  rollbackStatus: rollback.response.status,
  consoleIngestionStatus: consoleIngestion?.body?.status || 'DISABLED',
  logoutStatus: logout.response.status,
  evidenceCount: detail.body.evidenceCount,
  auditValid: audit.body.valid
}, null, 2));
