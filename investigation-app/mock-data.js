import crypto from 'node:crypto';

const ids = {
  caseOne: '11111111-1111-4111-8111-111111111111',
  caseTwo: '22222222-2222-4222-8222-222222222222',
  caseThree: '33333333-3333-4333-8333-333333333333',
  pathOne: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  accountVictim: '10000000-0000-4000-8000-000000000001',
  accountMuleOne: '10000000-0000-4000-8000-000000000002',
  accountMuleTwo: '10000000-0000-4000-8000-000000000003',
  accountCashout: '10000000-0000-4000-8000-000000000004',
  accountCashoutMerchant: '10000000-0000-4000-8000-000000000005',
  transactionOne: '20000000-0000-4000-8000-000000000001',
  transactionTwo: '20000000-0000-4000-8000-000000000002',
  transactionThree: '20000000-0000-4000-8000-000000000003',
  transactionFour: '20000000-0000-4000-8000-000000000004',
  revealOne: '70000000-0000-4000-8000-000000000001'
};

const institutions = [
  { id: 101, code: 'NSB', name: 'Northstar Bank', type: 'BANK' },
  { id: 102, code: 'RVB', name: 'Riverbank', type: 'BANK' },
  { id: 103, code: 'CWP', name: 'Civic Wallet', type: 'WALLET' }
];

const investigators = [
  { id: '1', displayName: 'A. Singh', role: 'INVESTIGATOR', institutionId: 101, institution: 'Northstar Bank', status: 'ACTIVE' },
  { id: '2', displayName: 'K. Rao', role: 'SUPERVISOR', institutionId: 101, institution: 'Northstar Bank', status: 'ACTIVE' },
  { id: '3', displayName: 'S. Mehta', role: 'AUDITOR', institutionId: 101, institution: 'Northstar Bank', status: 'ACTIVE' },
  { id: '4', displayName: 'R. Kumar', role: 'INVESTIGATOR', institutionId: 102, institution: 'Riverbank', status: 'ACTIVE' }
];

const cases = [
  {
    id: ids.caseOne,
    caseReference: 'TSX-2026-0001',
    description: 'UPI mule-account chain from a compromised victim account',
    severity: 'CRITICAL',
    status: 'OPEN',
    purpose: 'FRAUD_INVESTIGATION',
    openedAt: '2026-09-20T09:15:00Z',
    expiresAt: '2026-10-04T09:15:00Z',
    riskScore: 0.94,
    transactionCount: 4,
    alertCount: 3,
    pathCount: 1,
    evidenceCount: 7,
    institutions: ['Northstar Bank', 'Riverbank', 'Civic Wallet'],
    assignedTo: 'A. Singh',
    lastActivity: '12 minutes ago'
  },
  {
    id: ids.caseTwo,
    caseReference: 'TSX-2026-0002',
    description: 'Shared device review across two merchant accounts',
    severity: 'MEDIUM',
    status: 'OPEN',
    purpose: 'AML_REVIEW',
    openedAt: '2026-09-19T14:40:00Z',
    expiresAt: '2026-10-03T14:40:00Z',
    riskScore: 0.61,
    transactionCount: 9,
    alertCount: 1,
    pathCount: 0,
    evidenceCount: 3,
    institutions: ['Northstar Bank', 'Civic Wallet'],
    assignedTo: 'R. Kumar',
    lastActivity: '1 hour ago'
  },
  {
    id: ids.caseThree,
    caseReference: 'TSX-2026-0003',
    description: 'Resolved false positive involving a shared household network',
    severity: 'LOW',
    status: 'CLOSED',
    purpose: 'AUDIT',
    openedAt: '2026-09-12T08:20:00Z',
    expiresAt: '2026-09-26T08:20:00Z',
    riskScore: 0.22,
    transactionCount: 4,
    alertCount: 1,
    pathCount: 0,
    evidenceCount: 4,
    institutions: ['Riverbank'],
    assignedTo: 'A. Singh',
    lastActivity: 'Yesterday'
  }
];

const accounts = [
  {
    id: ids.accountVictim,
    token: 'acct_4e91...8f0a',
    institution: 'Northstar Bank',
    institutionCode: 'NSB',
    accountType: 'SAVINGS',
    status: 'ACTIVE',
    role: 'Victim account'
  },
  {
    id: ids.accountMuleOne,
    token: 'acct_91bd...2a4c',
    institution: 'Riverbank',
    institutionCode: 'RVB',
    accountType: 'SAVINGS',
    status: 'FROZEN',
    role: 'Mule account 1'
  },
  {
    id: ids.accountMuleTwo,
    token: 'acct_7c31...a6d9',
    institution: 'Riverbank',
    institutionCode: 'RVB',
    accountType: 'CURRENT',
    status: 'FROZEN',
    role: 'Mule account 2'
  },
  {
    id: ids.accountCashout,
    token: 'acct_c2b7...d8e2',
    institution: 'Civic Wallet',
    institutionCode: 'CWP',
    accountType: 'WALLET',
    status: 'SUSPENDED',
    role: 'Cash-out destination'
  },
  {
    id: ids.accountCashoutMerchant,
    token: 'acct_ee41...c7b0',
    institution: 'Civic Wallet',
    institutionCode: 'CWP',
    accountType: 'MERCHANT',
    status: 'SUSPENDED',
    role: 'Cash-out merchant endpoint'
  }
];

const transactions = [
  {
    id: ids.transactionOne,
    reference: 'txn_01f8...a2c1',
    fromAccountId: ids.accountVictim,
    toAccountId: ids.accountMuleOne,
    amount: 48500,
    currency: 'INR',
    rail: 'UPI',
    status: 'SETTLED',
    occurredAt: '2026-09-20T09:04:11Z',
    sourceInstitution: 'Northstar Bank',
    sourceCode: 'NSB'
  },
  {
    id: ids.transactionTwo,
    reference: 'txn_02b0...9c33',
    fromAccountId: ids.accountMuleOne,
    toAccountId: ids.accountMuleTwo,
    amount: 47200,
    currency: 'INR',
    rail: 'IMPS',
    status: 'SETTLED',
    occurredAt: '2026-09-20T09:08:42Z',
    sourceInstitution: 'Riverbank',
    sourceCode: 'RVB'
  },
  {
    id: ids.transactionThree,
    reference: 'txn_034c...1bd4',
    fromAccountId: ids.accountMuleTwo,
    toAccountId: ids.accountCashout,
    amount: 45900,
    currency: 'INR',
    rail: 'WALLET',
    status: 'SETTLED',
    occurredAt: '2026-09-20T09:12:20Z',
    sourceInstitution: 'Riverbank',
    sourceCode: 'RVB'
  },
  {
    id: ids.transactionFour,
    reference: 'txn_04d4...1e82',
    fromAccountId: ids.accountCashout,
    toAccountId: ids.accountCashoutMerchant,
    amount: 45000,
    currency: 'INR',
    rail: 'CASH_OUT',
    status: 'BLOCKED',
    occurredAt: '2026-09-20T09:15:33Z',
    sourceInstitution: 'Civic Wallet',
    sourceCode: 'CWP'
  }
];

const pathHops = [
  { hopNo: 1, transactionId: ids.transactionOne, fromAccountId: ids.accountVictim, toAccountId: ids.accountMuleOne, amountBucket: '45k-50k INR', gapSeconds: 0, riskScore: 0.83, reason: 'Seed transfer from reported victim account' },
  { hopNo: 2, transactionId: ids.transactionTwo, fromAccountId: ids.accountMuleOne, toAccountId: ids.accountMuleTwo, amountBucket: '45k-50k INR', gapSeconds: 271, riskScore: 0.92, reason: 'Rapid cross-account movement within Riverbank' },
  { hopNo: 3, transactionId: ids.transactionThree, fromAccountId: ids.accountMuleTwo, toAccountId: ids.accountCashout, amountBucket: '45k-50k INR', gapSeconds: 218, riskScore: 0.97, reason: 'Cross-institution movement into suspended wallet' }
];

const signals = [
  { id: 'signal-1', type: 'VELOCITY', label: 'Rapid movement', score: 0.92, explanation: 'Three transfers completed within 8 minutes of the seed transaction.', severity: 'HIGH' },
  { id: 'signal-2', type: 'CROSS_BANK', label: 'Cross-bank path', score: 0.88, explanation: 'The path crosses Northstar Bank, Riverbank, and Civic Wallet.', severity: 'HIGH' },
  { id: 'signal-3', type: 'DEVICE_REUSE', label: 'Device reuse', score: 0.81, explanation: 'The same protected device token was observed on both Riverbank accounts.', severity: 'MEDIUM' },
  { id: 'signal-4', type: 'AMOUNT_CONSERVATION', label: 'Amount conservation', score: 0.76, explanation: 'The path preserves 94.6% of the original amount before cash-out.', severity: 'MEDIUM' }
];

const evidence = [
  { id: 'evidence-1', type: 'SOURCE_TRANSACTION', title: 'Seed transaction assertion', source: 'Northstar Bank', status: 'VERIFIED', capturedAt: '09:05 UTC', commitment: 'sha256:1a84...d0f2' },
  { id: 'evidence-2', type: 'SOURCE_TRANSACTION', title: 'Riverbank transfer assertion', source: 'Riverbank', status: 'VERIFIED', capturedAt: '09:10 UTC', commitment: 'sha256:3b91...e27a' },
  { id: 'evidence-3', type: 'DEVICE_ASSERTION', title: 'Protected device overlap', source: 'Riverbank', status: 'VERIFIED', capturedAt: '09:11 UTC', commitment: 'sha256:5f80...bb43' },
  { id: 'evidence-4', type: 'PATH_CERTIFICATE', title: 'Generated path certificate', source: 'TraceShield X', status: 'VERIFIED', capturedAt: '09:18 UTC', commitment: 'sha256:7c31...0a8d' }
];

const complaints = [
  {
    id: 'complaint-1',
    reference: 'cmp_2026_0001',
    channel: 'BANK_APP',
    source: 'Northstar Bank',
    reportedAt: '2026-09-20T09:00:00Z',
    summary: 'Customer reported an unauthorised transfer from the protected seed account.',
    status: 'SUBSTANTIATED',
    sourceRecordHash: 'sha256:complaint_0001'
  }
];

const notes = [
  {
    id: 'note-1',
    caseId: ids.caseOne,
    body: 'The first three hops preserve the seed amount closely enough to justify a bounded recovery review. Keep identity fields masked until the source institution confirms necessity.',
    authorId: '1',
    authorName: 'A. Singh',
    createdAt: '2026-09-20T09:20:00Z'
  },
  {
    id: 'note-2',
    caseId: ids.caseTwo,
    body: 'Shared device evidence is useful context, but the current case does not yet have a generated path. Avoid a reveal request until a second independent signal is available.',
    authorId: '4',
    authorName: 'R. Kumar',
    createdAt: '2026-09-20T08:45:00Z'
  }
];

const revealRequests = [
  {
    id: ids.revealOne,
    caseId: ids.caseOne,
    target: 'acct_91bd...2a4c',
    requestedFields: ['account holder name', 'registered mobile'],
    reason: 'Identify the receiving mule account for recovery coordination.',
    status: 'PENDING',
    requiredApprovals: 2,
    approvals: [],
    createdBy: 'A. Singh',
    createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
  }
];

const auditEvents = [
  { id: 1, caseId: ids.caseOne, type: 'CASE_CREATED', actor: 'A. Singh', target: 'TSX-2026-0001', occurredAt: '2026-09-20T09:15:00Z', hash: 'sha256:0f1c...aa91', previousHash: null },
  { id: 2, caseId: ids.caseOne, type: 'DATA_INGESTED', actor: 'Bank adapter', target: 'batch_20260920_01', occurredAt: '2026-09-20T09:16:00Z', hash: 'sha256:19a2...bb02', previousHash: 'sha256:0f1c...aa91' },
  { id: 3, caseId: ids.caseOne, type: 'TRACE_EXECUTED', actor: 'A. Singh', target: 'path_aaaaaaaa', occurredAt: '2026-09-20T09:18:00Z', hash: 'sha256:2bd9...c640', previousHash: 'sha256:19a2...bb02' },
  { id: 4, caseId: ids.caseOne, type: 'EVIDENCE_ADDED', actor: 'A. Singh', target: 'evidence-4', occurredAt: '2026-09-20T09:19:00Z', hash: 'sha256:3c01...d4a7', previousHash: 'sha256:2bd9...c640' },
  { id: 5, caseId: ids.caseOne, type: 'REVEAL_REQUESTED', actor: 'A. Singh', target: 'reveal_70000000', occurredAt: '2026-09-20T09:23:00Z', hash: 'sha256:4d12...e5b8', previousHash: 'sha256:3c01...d4a7' }
];

const makeHash = (input) => `sha256:${crypto.createHash('sha256').update(input).digest('hex').slice(0, 12)}`;

export const mockData = {
  institutions,
  investigators,
  cases,
  accounts,
  transactions,
  pathHops,
  signals,
  evidence,
  complaints,
  notes,
  revealRequests,
  auditEvents,
  ids,
  makeHash
};
