import crypto from 'node:crypto';
import { signAdapterRequest } from '../adapter-security.js';

const baseUrl = String(process.env.TRACESHIELD_BASE_URL || 'http://127.0.0.1:4170').replace(/\/$/, '');
const loginName = String(process.env.TRACESHIELD_ADAPTER_LOGIN || process.env.TRACESHIELD_TEST_LOGIN || '').trim();
const password = String(process.env.TRACESHIELD_ADAPTER_PASSWORD || process.env.TRACESHIELD_TEST_PASSWORD || '');
const caseId = String(process.env.TRACESHIELD_ADAPTER_CASE_ID || '11111111-1111-4111-8111-111111111111').trim();
const sourceInstitutionCode = String(process.env.TRACESHIELD_ADAPTER_INSTITUTION || 'NSB').trim().toUpperCase();
const adapterSecret = String(process.env.TRACESHIELD_ADAPTER_SIGNING_SECRET || '');
const requireSignature = String(process.env.REQUIRE_ADAPTER_SIGNATURE || '').toLowerCase() === 'true';

if (!loginName || !password) throw new Error('Set TRACESHIELD_ADAPTER_LOGIN and TRACESHIELD_ADAPTER_PASSWORD (or the TRACESHIELD_TEST equivalents).');
if (requireSignature && adapterSecret.length < 32) throw new Error('Set TRACESHIELD_ADAPTER_SIGNING_SECRET to at least 32 characters when adapter signatures are required.');

let sessionCookie = '';

function cookieFromResponse(response) {
  return String(response.headers.get('set-cookie') || '').split(';')[0] || '';
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

async function retry(task, attempts = 3) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await task();
    if (![429, 500, 502, 503, 504].includes(last.response.status) || attempt === attempts - 1) return last;
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return last;
}

function commitment(label) {
  return `sha256:${crypto.createHash('sha256').update(label).digest('hex')}`;
}

const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const senderRef = `adapter-sender-${suffix}`;
const receiverRef = `adapter-receiver-${suffix}`;
const transactionRef = `adapter-transaction-${suffix}`;
const occurredAt = new Date(Date.now() - 60_000).toISOString();
const observedAt = new Date().toISOString();
const batch = {
  caseId,
  sourceInstitutionCode,
  batchReference: `adapter-demo-${suffix}`,
  sourceSystem: 'traceshield-synthetic-institution-adapter-v1',
  records: {
    accounts: [
      { sourceAccountRef: senderRef, accountType: 'SAVINGS', status: 'ACTIVE' },
      { sourceAccountRef: receiverRef, accountType: 'CURRENT', status: 'ACTIVE' }
    ],
    transactions: [{
      sourceRecordId: transactionRef,
      sourceAccountRef: senderRef,
      receiverAccountRef: receiverRef,
      amount: 1750,
      currencyCode: 'INR',
      paymentRail: 'UPI',
      transactionType: 'TRANSFER',
      transactionStatus: 'COMPLETED',
      occurredAt,
      observedAt,
      caseRelevance: 'CANDIDATE'
    }],
    evidence: [{
      evidenceType: 'SOURCE_TRANSACTION',
      transactionSourceRecordId: transactionRef,
      sourceRecordHash: commitment(`adapter-evidence-${suffix}`),
      contentCommitment: commitment(`adapter-content-${suffix}`),
      capturedAt: observedAt,
      integrityStatus: 'VERIFIED'
    }]
  }
};

const login = await request('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ loginName, password })
});
if (!login.response.ok) throw new Error(`Adapter login failed (${login.response.status}): ${JSON.stringify(login.body)}`);
sessionCookie = cookieFromResponse(login.response);

const result = await retry(() => request('/api/ingestion/batches', {
  method: 'POST',
  headers: adapterSecret ? signAdapterRequest(batch, adapterSecret) : {},
  body: JSON.stringify(batch)
}));
if (!result.response.ok) throw new Error(`Adapter ingestion failed (${result.response.status}): ${JSON.stringify(result.body)}`);

console.log(JSON.stringify({
  ok: true,
  mode: result.body?.status === 'MOCK_VALIDATED' ? 'mock-validation' : 'postgres-commit',
  batchReference: batch.batchReference,
  caseId: batch.caseId,
  sourceInstitutionCode: batch.sourceInstitutionCode,
  result: result.body
}, null, 2));
