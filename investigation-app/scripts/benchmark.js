import crypto from 'node:crypto';
import { createProtectedToken, prepareIngestionBatch } from '../ingestion-engine.js';
import { buildInvestigationAnalysis } from '../investigation-engine.js';
import { mockData } from '../mock-data.js';

function elapsedSeconds(start) {
  return Number(process.hrtime.bigint() - start) / 1e9;
}

function operationsPerSecond(count, seconds) {
  return Math.round(count / Math.max(seconds, Number.EPSILON));
}

const tokenIterations = Number(process.env.TRACESHIELD_BENCHMARK_TOKENS || 20_000);
const batchIterations = Number(process.env.TRACESHIELD_BENCHMARK_BATCHES || 200);
const secret = crypto.randomBytes(32).toString('hex');
const contextId = '60000000-0000-4000-8000-000000000001';

let start = process.hrtime.bigint();
for (let index = 0; index < tokenIterations; index += 1) {
  createProtectedToken(`synthetic-reference-${index}`, contextId, 'ACCOUNT', secret);
}
const tokenSeconds = elapsedSeconds(start);

const template = {
  caseId: '11111111-1111-4111-8111-111111111111',
  sourceInstitutionCode: 'NSB',
  batchReference: 'benchmark-batch',
  sourceSystem: 'benchmark-adapter',
  records: {
    accounts: [{ sourceAccountRef: 'sender', accountType: 'SAVINGS', status: 'ACTIVE' }],
    transactions: [{
      sourceRecordId: 'benchmark-transaction',
      sourceAccountRef: 'sender',
      receiverAccountRef: 'receiver',
      amount: 1000,
      currencyCode: 'INR',
      paymentRail: 'UPI',
      transactionType: 'TRANSFER',
      transactionStatus: 'COMPLETED',
      occurredAt: '2026-01-01T00:00:00.000Z',
      observedAt: '2026-01-01T00:01:00.000Z',
      caseRelevance: 'CANDIDATE'
    }]
  }
};

start = process.hrtime.bigint();
let lastBatch;
for (let index = 0; index < batchIterations; index += 1) {
  lastBatch = prepareIngestionBatch({ ...template, batchReference: `benchmark-${index}` });
}
const batchSeconds = elapsedSeconds(start);

start = process.hrtime.bigint();
for (let index = 0; index < batchIterations; index += 1) buildInvestigationAnalysis({
  ...mockData.cases[0],
  transactions: mockData.transactions,
  paths: [{ id: mockData.ids.pathOne, status: 'GENERATED', riskScore: 0.94, hopCount: mockData.pathHops.length, hops: mockData.pathHops }],
  signals: mockData.signals,
  evidence: mockData.evidence
});
const analysisSeconds = elapsedSeconds(start);

const comparisonIterations = Math.max(1_000, batchIterations * 10);
const clearReferenceIndex = new Map();
const protectedReferenceIndex = new Map();
for (let index = 0; index < comparisonIterations; index += 1) {
  const reference = `comparison-reference-${index}`;
  clearReferenceIndex.set(reference, index);
  protectedReferenceIndex.set(createProtectedToken(reference, contextId, 'ACCOUNT', secret), index);
}

start = process.hrtime.bigint();
for (let index = 0; index < comparisonIterations; index += 1) clearReferenceIndex.get(`comparison-reference-${index}`);
const clearJoinSeconds = elapsedSeconds(start);

start = process.hrtime.bigint();
for (let index = 0; index < comparisonIterations; index += 1) {
  protectedReferenceIndex.get(createProtectedToken(`comparison-reference-${index}`, contextId, 'ACCOUNT', secret));
}
const protectedJoinSeconds = elapsedSeconds(start);

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  node: process.version,
  disclaimer: 'Local deterministic engineering baseline, not a production capacity claim. Plaintext comparison uses in-memory fixtures only and never represents an allowed persistence mode.',
  tokenDerivation: { iterations: tokenIterations, seconds: Number(tokenSeconds.toFixed(6)), operationsPerSecond: operationsPerSecond(tokenIterations, tokenSeconds) },
  ingestionNormalization: { iterations: batchIterations, seconds: Number(batchSeconds.toFixed(6)), operationsPerSecond: operationsPerSecond(batchIterations, batchSeconds), lastRecordCount: lastBatch.recordCount },
  investigationAnalysis: { iterations: batchIterations, seconds: Number(analysisSeconds.toFixed(6)), operationsPerSecond: operationsPerSecond(batchIterations, analysisSeconds) },
  inMemoryComparison: {
    iterations: comparisonIterations,
    clearReferenceJoin: { seconds: Number(clearJoinSeconds.toFixed(6)), operationsPerSecond: operationsPerSecond(comparisonIterations, clearJoinSeconds) },
    contextBoundTokenJoin: { seconds: Number(protectedJoinSeconds.toFixed(6)), operationsPerSecond: operationsPerSecond(comparisonIterations, protectedJoinSeconds) }
  }
}, null, 2));
