import crypto from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTITUTION_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/;
const PAYMENT_RAILS = new Set(['UPI', 'IMPS', 'NEFT', 'CARD', 'WALLET', 'CASH_OUT', 'OTHER']);
const TRANSACTION_TYPES = new Set(['TRANSFER', 'REFUND', 'REVERSAL', 'CASH_OUT', 'TOP_UP', 'OTHER']);
const TRANSACTION_STATUSES = new Set(['PENDING', 'COMPLETED', 'SETTLED', 'FAILED', 'REVERSED', 'BLOCKED']);
const ACCOUNT_TYPES = new Set(['SAVINGS', 'CURRENT', 'WALLET', 'MERCHANT', 'ESCROW', 'UNKNOWN']);
const ACCOUNT_STATUSES = new Set(['ACTIVE', 'FROZEN', 'CLOSED', 'SUSPENDED', 'UNKNOWN']);
const IDENTITY_TYPES = new Set(['PHONE', 'EMAIL', 'GOVERNMENT_ID', 'CUSTOMER_REFERENCE']);
const MATCHING_BASES = new Set(['EXACT_NORMALISED', 'PROBABILISTIC', 'SOURCE_ASSERTED']);
const NETWORK_TYPES = new Set(['IPV4', 'IPV6', 'ASN', 'PROXY', 'VPN', 'UNKNOWN']);
const EVIDENCE_TYPES = new Set(['SOURCE_TRANSACTION', 'ACCOUNT_ASSERTION', 'DEVICE_ASSERTION', 'NETWORK_ASSERTION', 'COMPLAINT', 'DOCUMENT']);
const RELATIONSHIP_TYPES = new Set(['OWNER', 'AUTHORIZED_USER', 'BENEFICIARY', 'MERCHANT']);
const CASE_RELEVANCES = new Set(['SEED', 'CANDIDATE', 'CONFIRMED', 'EXCLUDED']);

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function requiredText(value, field, max = 256) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) fail(`${field} is required and must be at most ${max} characters.`);
  return text;
}

function optionalText(value, field, max = 256) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (text.length > max) fail(`${field} must be at most ${max} characters.`);
  return text || null;
}

function finiteNumber(value, field, minimum = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= minimum) fail(`${field} must be greater than ${minimum}.`);
  return number;
}

function isoDate(value, field, fallback = null) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== null) return fallback;
    fail(`${field} is required.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(`${field} must be a valid date.`);
  return date.toISOString();
}

function arrayValue(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${field} must be an array.`);
  return value;
}

function enumValue(value, field, allowed, fallback) {
  const normalized = String(value ?? fallback ?? '').trim().toUpperCase();
  if (!allowed.has(normalized)) fail(`${field} is not supported.`);
  return normalized;
}

export function normalizeAccountReference(value, field = 'account reference') {
  return requiredText(value, field, 256).normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeIdentityValue(value, fieldType) {
  const text = requiredText(value, `${fieldType.toLowerCase()} value`, 512).normalize('NFKC').trim();
  if (fieldType === 'EMAIL') return text.toLowerCase();
  if (fieldType === 'PHONE') {
    const digits = text.replace(/[^0-9+]/g, '');
    if (digits.length < 7 || digits.length > 20) fail('Phone value is not valid.');
    return digits;
  }
  return text.toLowerCase();
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

export function hashCanonical(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

export function createProtectedToken(value, contextId, fieldType, secret) {
  if (!secret || String(secret).length < 32) {
    throw new Error('TRACESHIELD_TOKEN_SECRET must contain at least 32 characters.');
  }
  return crypto.createHmac('sha256', secret)
    .update(`${String(value).trim().toLowerCase()}|${contextId}|${String(fieldType).toUpperCase()}`)
    .digest('hex');
}

function normalizeAccount(item, index) {
  const sourceAccountRef = normalizeAccountReference(item?.sourceAccountRef, `accounts[${index}].sourceAccountRef`);
  const institutionCode = optionalText(item?.institutionCode, `accounts[${index}].institutionCode`, 32)?.toUpperCase() || null;
  if (institutionCode && !INSTITUTION_CODE_PATTERN.test(institutionCode)) fail(`accounts[${index}].institutionCode is invalid.`);
  const normalized = {
    sourceAccountRef,
    institutionCode,
    accountType: enumValue(item?.accountType, `accounts[${index}].accountType`, ACCOUNT_TYPES, 'UNKNOWN'),
    status: enumValue(item?.status, `accounts[${index}].status`, ACCOUNT_STATUSES, 'UNKNOWN'),
    openedAt: item?.openedAt ? isoDate(item.openedAt, `accounts[${index}].openedAt`) : null,
    closedAt: item?.closedAt ? isoDate(item.closedAt, `accounts[${index}].closedAt`) : null
  };
  return { ...normalized, sourceRecordHash: item?.sourceRecordHash || hashCanonical({ type: 'ACCOUNT', ...normalized }) };
}

function normalizeIdentity(item, index) {
  const fieldType = enumValue(item?.fieldType, `identities[${index}].fieldType`, IDENTITY_TYPES);
  const normalized = {
    sourceAccountRef: normalizeAccountReference(item?.sourceAccountRef, `identities[${index}].sourceAccountRef`),
    institutionCode: optionalText(item?.institutionCode, `identities[${index}].institutionCode`, 32)?.toUpperCase() || null,
    fieldType,
    normalizedValue: normalizeIdentityValue(item?.value, fieldType),
    relationshipType: enumValue(item?.relationshipType, `identities[${index}].relationshipType`, RELATIONSHIP_TYPES, 'OWNER'),
    matchingBasis: enumValue(item?.matchingBasis, `identities[${index}].matchingBasis`, MATCHING_BASES, 'EXACT_NORMALISED'),
    confidenceScore: item?.confidenceScore === undefined ? 1 : Number(item.confidenceScore)
  };
  if (normalized.institutionCode && !INSTITUTION_CODE_PATTERN.test(normalized.institutionCode)) fail(`identities[${index}].institutionCode is invalid.`);
  if (!Number.isFinite(normalized.confidenceScore) || normalized.confidenceScore < 0 || normalized.confidenceScore > 1) fail(`identities[${index}].confidenceScore must be between 0 and 1.`);
  return { ...normalized, sourceRecordHash: item?.sourceRecordHash || hashCanonical({ type: 'IDENTITY', ...normalized }) };
}

function normalizeDevice(item, index) {
  const normalized = {
    sourceDeviceRef: normalizeAccountReference(item?.sourceDeviceRef, `devices[${index}].sourceDeviceRef`),
    deviceType: optionalText(item?.deviceType, `devices[${index}].deviceType`, 80),
    osFamily: optionalText(item?.osFamily, `devices[${index}].osFamily`, 80),
    manufacturer: optionalText(item?.manufacturer, `devices[${index}].manufacturer`, 120)
  };
  return { ...normalized, sourceRecordHash: item?.sourceRecordHash || hashCanonical({ type: 'DEVICE', ...normalized }) };
}

function normalizeNetwork(item, index) {
  const normalized = {
    sourceNetworkRef: normalizeAccountReference(item?.sourceNetworkRef, `networks[${index}].sourceNetworkRef`),
    networkType: enumValue(item?.networkType, `networks[${index}].networkType`, NETWORK_TYPES, 'UNKNOWN'),
    countryCode: optionalText(item?.countryCode, `networks[${index}].countryCode`, 2)?.toUpperCase() || null,
    ispName: optionalText(item?.ispName, `networks[${index}].ispName`, 160)
  };
  return { ...normalized, sourceRecordHash: item?.sourceRecordHash || hashCanonical({ type: 'NETWORK', ...normalized }) };
}

function normalizeTransaction(item, index) {
  const normalized = {
    sourceRecordId: requiredText(item?.sourceRecordId, `transactions[${index}].sourceRecordId`, 256),
    sourceAccountRef: normalizeAccountReference(item?.sourceAccountRef, `transactions[${index}].sourceAccountRef`),
    receiverAccountRef: normalizeAccountReference(item?.receiverAccountRef, `transactions[${index}].receiverAccountRef`),
    senderInstitutionCode: optionalText(item?.senderInstitutionCode, `transactions[${index}].senderInstitutionCode`, 32)?.toUpperCase() || null,
    receiverInstitutionCode: optionalText(item?.receiverInstitutionCode, `transactions[${index}].receiverInstitutionCode`, 32)?.toUpperCase() || null,
    senderAccountId: optionalText(item?.senderAccountId, `transactions[${index}].senderAccountId`, 36),
    receiverAccountId: optionalText(item?.receiverAccountId, `transactions[${index}].receiverAccountId`, 36),
    parentSourceRecordId: optionalText(item?.parentSourceRecordId, `transactions[${index}].parentSourceRecordId`, 256),
    amount: finiteNumber(item?.amount, `transactions[${index}].amount`),
    currencyCode: requiredText(item?.currencyCode || item?.currency || 'INR', `transactions[${index}].currencyCode`, 3).toUpperCase(),
    paymentRail: enumValue(item?.paymentRail || item?.rail, `transactions[${index}].paymentRail`, PAYMENT_RAILS, 'OTHER'),
    transactionType: enumValue(item?.transactionType, `transactions[${index}].transactionType`, TRANSACTION_TYPES, 'TRANSFER'),
    transactionStatus: enumValue(item?.transactionStatus || item?.status, `transactions[${index}].transactionStatus`, TRANSACTION_STATUSES, 'COMPLETED'),
    occurredAt: isoDate(item?.occurredAt, `transactions[${index}].occurredAt`),
    observedAt: isoDate(item?.observedAt, `transactions[${index}].observedAt`, new Date().toISOString()),
    sourceSignature: optionalText(item?.sourceSignature, `transactions[${index}].sourceSignature`, 512),
    caseRelevance: enumValue(item?.caseRelevance, `transactions[${index}].caseRelevance`, CASE_RELEVANCES, 'CANDIDATE')
  };
  for (const [field, value] of [['senderInstitutionCode', normalized.senderInstitutionCode], ['receiverInstitutionCode', normalized.receiverInstitutionCode]]) {
    if (value && !INSTITUTION_CODE_PATTERN.test(value)) fail(`transactions[${index}].${field} is invalid.`);
  }
  for (const [field, value] of [['senderAccountId', normalized.senderAccountId], ['receiverAccountId', normalized.receiverAccountId]]) {
    if (value && !UUID_PATTERN.test(value)) fail(`transactions[${index}].${field} must be a valid UUID.`);
  }
  if (normalized.currencyCode.length !== 3) fail(`transactions[${index}].currencyCode must be a 3-letter code.`);
  if (normalized.sourceAccountRef === normalized.receiverAccountRef) fail(`transactions[${index}] cannot use the same sender and receiver.`);
  if (new Date(normalized.observedAt).getTime() < new Date(normalized.occurredAt).getTime()) fail(`transactions[${index}].observedAt cannot be before occurredAt.`);
  return { ...normalized, sourceRecordHash: item?.sourceRecordHash || hashCanonical({ type: 'TRANSACTION', ...normalized }) };
}

function normalizeObservation(item, index) {
  const normalized = {
    sourceAccountRef: normalizeAccountReference(item?.sourceAccountRef, `observations[${index}].sourceAccountRef`),
    sourceDeviceRef: optionalText(item?.sourceDeviceRef, `observations[${index}].sourceDeviceRef`, 256),
    sourceNetworkRef: optionalText(item?.sourceNetworkRef, `observations[${index}].sourceNetworkRef`, 256),
    sourceRecordId: optionalText(item?.sourceRecordId, `observations[${index}].sourceRecordId`, 256),
    observedAt: isoDate(item?.observedAt, `observations[${index}].observedAt`),
    confidenceScore: item?.confidenceScore === undefined ? 1 : Number(item.confidenceScore)
  };
  if (!normalized.sourceDeviceRef && !normalized.sourceNetworkRef) fail(`observations[${index}] needs a device or network reference.`);
  if (!Number.isFinite(normalized.confidenceScore) || normalized.confidenceScore < 0 || normalized.confidenceScore > 1) fail(`observations[${index}].confidenceScore must be between 0 and 1.`);
  return { ...normalized, sourceRecordHash: item?.sourceRecordHash || hashCanonical({ type: 'OBSERVATION', ...normalized }) };
}

function normalizeEvidence(item, index) {
  const evidenceType = enumValue(item?.evidenceType, `evidence[${index}].evidenceType`, EVIDENCE_TYPES);
  const accountSourceRef = item?.accountSourceRef ? normalizeAccountReference(item.accountSourceRef, `evidence[${index}].accountSourceRef`) : null;
  const deviceSourceRef = item?.deviceSourceRef ? normalizeAccountReference(item.deviceSourceRef, `evidence[${index}].deviceSourceRef`) : null;
  const networkSourceRef = item?.networkSourceRef ? normalizeAccountReference(item.networkSourceRef, `evidence[${index}].networkSourceRef`) : null;
  const accountInstitutionCode = optionalText(item?.accountInstitutionCode, `evidence[${index}].accountInstitutionCode`, 32)?.toUpperCase() || null;
  const normalized = {
    evidenceType,
    sourceRecordHash: requiredText(item?.sourceRecordHash, `evidence[${index}].sourceRecordHash`, 512),
    contentCommitment: requiredText(item?.contentCommitment, `evidence[${index}].contentCommitment`, 512),
    transactionSourceRecordId: optionalText(item?.transactionSourceRecordId, `evidence[${index}].transactionSourceRecordId`, 256),
    accountSourceRef,
    accountInstitutionCode,
    deviceSourceRef,
    networkSourceRef,
    capturedAt: isoDate(item?.capturedAt, `evidence[${index}].capturedAt`, new Date().toISOString()),
    integrityStatus: enumValue(item?.integrityStatus, `evidence[${index}].integrityStatus`, new Set(['UNVERIFIED', 'VERIFIED', 'CONFLICTING', 'REVOKED']), 'VERIFIED')
  };
  if (normalized.accountInstitutionCode && !INSTITUTION_CODE_PATTERN.test(normalized.accountInstitutionCode)) fail(`evidence[${index}].accountInstitutionCode is invalid.`);
  const targetCount = [normalized.transactionSourceRecordId, normalized.accountSourceRef, normalized.deviceSourceRef, normalized.networkSourceRef].filter(Boolean).length;
  if (targetCount === 0) {
    fail(`evidence[${index}] must reference a transaction, account, device, or network record.`);
  }
  if (targetCount !== 1) fail(`evidence[${index}] must reference exactly one protected target.`);
  if (evidenceType === 'SOURCE_TRANSACTION' && !normalized.transactionSourceRecordId) fail(`evidence[${index}].transactionSourceRecordId is required for SOURCE_TRANSACTION.`);
  if (evidenceType === 'ACCOUNT_ASSERTION' && !normalized.accountSourceRef) fail(`evidence[${index}].accountSourceRef is required for ACCOUNT_ASSERTION.`);
  if (evidenceType === 'DEVICE_ASSERTION' && !normalized.deviceSourceRef) fail(`evidence[${index}].deviceSourceRef is required for DEVICE_ASSERTION.`);
  if (evidenceType === 'NETWORK_ASSERTION' && !normalized.networkSourceRef) fail(`evidence[${index}].networkSourceRef is required for NETWORK_ASSERTION.`);
  return normalized;
}

export function prepareIngestionBatch(input = {}) {
  const caseId = requiredText(input.caseId, 'caseId');
  if (!UUID_PATTERN.test(caseId)) fail('caseId must be a valid UUID.');
  const sourceInstitutionCode = requiredText(input.sourceInstitutionCode, 'sourceInstitutionCode', 32).toUpperCase();
  if (!INSTITUTION_CODE_PATTERN.test(sourceInstitutionCode)) fail('sourceInstitutionCode is invalid.');
  const batchReference = requiredText(input.batchReference, 'batchReference', 120);
  const sourceSystem = requiredText(input.sourceSystem || 'institution-adapter', 'sourceSystem', 120);
  const records = input.records && typeof input.records === 'object' ? input.records : {};
  const accounts = arrayValue(records.accounts, 'records.accounts').map(normalizeAccount);
  const identities = arrayValue(records.identities, 'records.identities').map(normalizeIdentity);
  const devices = arrayValue(records.devices, 'records.devices').map(normalizeDevice);
  const networks = arrayValue(records.networks, 'records.networks').map(normalizeNetwork);
  const transactions = arrayValue(records.transactions, 'records.transactions').map(normalizeTransaction);
  const observations = arrayValue(records.observations, 'records.observations').map(normalizeObservation);
  const evidence = arrayValue(records.evidence, 'records.evidence').map(normalizeEvidence);
  if (!accounts.length && !transactions.length && !identities.length && !devices.length && !networks.length) fail('At least one protected source record is required.');
  const recordCount = accounts.length + identities.length + devices.length + networks.length + transactions.length + observations.length + evidence.length;
  if (recordCount > 5000) fail('A single ingestion batch cannot contain more than 5000 records.');
  const canonical = canonicalize({ caseId, sourceInstitutionCode, batchReference, sourceSystem, records: { accounts, identities, devices, networks, transactions, observations, evidence } });
  return {
    caseId,
    sourceInstitutionCode,
    batchReference,
    sourceSystem,
    records: { accounts, identities, devices, networks, transactions, observations, evidence },
    recordCount,
    payloadHash: hashCanonical(canonical)
  };
}
