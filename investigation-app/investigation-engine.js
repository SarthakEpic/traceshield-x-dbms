const FIELD_RULES = [
  { key: 'account holder name', sensitivity: 'HIGH', purposes: ['FRAUD_INVESTIGATION', 'RECOVERY', 'AML_REVIEW'], label: 'Account holder name' },
  { key: 'registered mobile', sensitivity: 'VERY_HIGH', purposes: ['RECOVERY'], label: 'Registered mobile' },
  { key: 'registered email', sensitivity: 'VERY_HIGH', purposes: ['RECOVERY'], label: 'Registered email' },
  { key: 'account status', sensitivity: 'LOW', purposes: ['FRAUD_INVESTIGATION', 'RECOVERY', 'AML_REVIEW', 'AUDIT'], label: 'Account status' },
  { key: 'institution confirmation', sensitivity: 'LOW', purposes: ['FRAUD_INVESTIGATION', 'RECOVERY', 'AML_REVIEW', 'AUDIT'], label: 'Institution confirmation' }
];

export const REVEAL_FIELD_KEYS = Object.freeze(FIELD_RULES.map((rule) => rule.key));

const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, Number(value) || 0));
const asNumber = (value) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};
const asDate = (value) => {
  const result = new Date(value || 0).getTime();
  return Number.isFinite(result) && result > 0 ? result : null;
};
const unique = (items) => [...new Set(items.filter(Boolean))];

export function riskBand(value) {
  const score = clamp(value);
  if (score >= 0.8) return 'CRITICAL_REVIEW';
  if (score >= 0.6) return 'ELEVATED_REVIEW';
  if (score >= 0.35) return 'CONTEXT_REVIEW';
  return 'LOW_SIGNAL';
}

function accountLabel(account, fallbackId) {
  return {
    id: account?.id || fallbackId || 'unknown',
    token: account?.token || 'masked account',
    institution: account?.institution || 'Protected institution',
    institutionCode: account?.institutionCode || 'PROTECTED',
    status: account?.status || 'UNKNOWN',
    role: account?.role || ''
  };
}

function transactionMap(detail) {
  return new Map((detail?.transactions || []).map((transaction) => [transaction.id, transaction]));
}

function hopAmount(hop, transactions) {
  const transaction = hop.transaction || transactions.get(hop.transactionId);
  return asNumber(hop.amount ?? transaction?.amount);
}

function pathInstitutions(hops) {
  return unique(hops.flatMap((hop) => [hop.from?.institution, hop.to?.institution]));
}

export function buildPathAnalysis(path, detail = {}) {
  const hops = [...(path?.hops || [])].sort((left, right) => Number(left.hopNo || 0) - Number(right.hopNo || 0));
  const transactions = transactionMap(detail);
  const nodes = new Map();
  const edges = [];
  const ensureNode = (account, fallbackId, hopIndex) => {
    const item = accountLabel(account, fallbackId);
    if (!nodes.has(item.id)) {
      nodes.set(item.id, {
        id: item.id,
        token: item.token,
        institution: item.institution,
        institutionCode: item.institutionCode,
        status: item.status,
        role: hopIndex === 0 ? 'SOURCE' : 'INTERMEDIARY',
        incoming: 0,
        outgoing: 0
      });
    }
    return nodes.get(item.id);
  };

  for (const [index, hop] of hops.entries()) {
    const from = ensureNode(hop.from, hop.fromAccountId, index);
    const to = ensureNode(hop.to, hop.toAccountId, index + 1);
    from.outgoing += 1;
    to.incoming += 1;
    const transaction = hop.transaction || transactions.get(hop.transactionId);
    edges.push({
      id: hop.transactionId || `${path?.id || 'path'}-${index + 1}`,
      hopNo: Number(hop.hopNo || index + 1),
      from: from.id,
      to: to.id,
      fromToken: from.token,
      toToken: to.token,
      amount: hopAmount(hop, transactions),
      amountBucket: hop.amountBucket || null,
      currency: hop.currency || transaction?.currency || 'INR',
      occurredAt: hop.occurredAt || transaction?.occurredAt || null,
      gapSeconds: Number(hop.temporalGapSeconds ?? hop.gapSeconds ?? 0),
      riskScore: clamp(hop.riskScore ?? hop.hopRiskScore),
      reason: hop.reason || 'Temporal and account continuity connect this hop.'
    });
  }

  const lastNode = [...nodes.values()].at(-1);
  if (lastNode) lastNode.role = 'DESTINATION';
  const amounts = edges.map((edge) => edge.amount).filter((value) => value !== null);
  const firstAmount = amounts[0] ?? null;
  const finalAmount = amounts.at(-1) ?? null;
  const amountRetention = firstAmount && finalAmount !== null ? clamp(finalAmount / firstAmount) : null;
  const gaps = edges.map((edge) => edge.gapSeconds).filter((value) => value > 0);
  const maxGap = gaps.length ? Math.max(...gaps) : 0;
  const riskScore = clamp(path?.riskScore ?? (edges.length ? Math.max(...edges.map((edge) => edge.riskScore)) : 0));
  const institutions = pathInstitutions(hops);
  const accountStatuses = unique([...nodes.values()].map((node) => node.status));
  const highRiskHops = edges.filter((edge) => edge.riskScore >= 0.8).map((edge) => edge.hopNo);

  const explanations = [];
  if (institutions.length > 1) explanations.push(`The route crosses ${institutions.length} protected institutions without exposing source identity.`);
  if (gaps.some((gap) => gap <= 600)) explanations.push('At least one successive transfer occurs within ten minutes, supporting a velocity signal.');
  if (amountRetention !== null && amountRetention >= 0.8) explanations.push(`The path retains ${(amountRetention * 100).toFixed(1)}% of the seed amount before the final observed hop.`);
  if (accountStatuses.some((status) => ['FROZEN', 'SUSPENDED'].includes(status))) explanations.push('A destination or intermediary account has a restricted status and requires investigator review.');
  if (!explanations.length) explanations.push('The path is available for contextual review, but the current evidence does not establish a high-risk pattern by itself.');

  return {
    id: path?.id || null,
    status: path?.status || 'GENERATED',
    hopCount: hops.length,
    riskScore,
    riskBand: riskBand(riskScore),
    institutionCount: institutions.length,
    institutions,
    amountRetention,
    maxTemporalGapSeconds: maxGap,
    highRiskHops,
    explanations,
    graph: { nodes: [...nodes.values()], edges },
    indicators: {
      crossInstitution: institutions.length > 1,
      rapidMovement: gaps.some((gap) => gap <= 600),
      restrictedAccount: accountStatuses.some((status) => ['FROZEN', 'SUSPENDED'].includes(status)),
      amountConservation: amountRetention !== null && amountRetention >= 0.8
    }
  };
}

export function buildRevealRecommendation(detail = {}, input = {}) {
  const purpose = String(detail.purpose || 'FRAUD_INVESTIGATION').toUpperCase();
  const requestedFields = unique((input.requestedFields || []).map((field) => String(field).trim().toLowerCase()));
  const reason = String(input.reason || '').trim();
  const recoveryLanguage = /recover|refund|contact|notify|return|complain/i.test(reason);
  const minimumFields = ['account holder name'];
  if (purpose === 'AUDIT') minimumFields.splice(0, minimumFields.length, 'account status', 'institution confirmation');
  if (purpose === 'AML_REVIEW' && /contact|verify|reach/i.test(reason)) minimumFields.push('institution confirmation');
  if (purpose === 'RECOVERY' && recoveryLanguage) minimumFields.push('institution confirmation');

  const normalizedMinimum = unique(minimumFields);
  const unnecessaryFields = requestedFields.filter((field) => !normalizedMinimum.includes(field));
  const rules = requestedFields.map((field) => FIELD_RULES.find((rule) => rule.key === field)).filter(Boolean);
  const highSensitivity = rules.filter((rule) => ['HIGH', 'VERY_HIGH'].includes(rule.sensitivity)).map((rule) => rule.label);
  const purposeFit = normalizedMinimum.every((field) => FIELD_RULES.find((rule) => rule.key === field)?.purposes.includes(purpose));

  let rationale = 'Use the smallest field set that supports the documented next action.';
  if (purpose === 'RECOVERY') rationale = 'Recovery coordination normally needs a holder confirmation and institution-level routing, not direct contact data.';
  if (purpose === 'AML_REVIEW') rationale = 'AML review should remain focused on risk context; contact fields require a separate necessity statement.';
  if (purpose === 'AUDIT') rationale = 'An audit can usually be completed with status and institution confirmation while keeping identity fields sealed.';

  return {
    policy: 'MINIMUM_NECESSARY_DISCLOSURE',
    purpose,
    requestedFields,
    minimumFields: normalizedMinimum,
    unnecessaryFields,
    highSensitivity,
    purposeFit,
    requiredApprovals: 2,
    expiryHours: 4,
    rationale,
    decision: unnecessaryFields.length ? 'NARROW_REQUEST' : 'READY_FOR_APPROVAL'
  };
}

export function buildInvestigationAnalysis(detail = {}) {
  const paths = (detail.paths || []).map((path) => buildPathAnalysis(path, detail));
  const signals = [...(detail.signals || [])].sort((left, right) => clamp(right.score) - clamp(left.score));
  const scoreCandidates = [detail.riskScore, ...paths.map((path) => path.riskScore), ...signals.map((signal) => signal.score)].map(asNumber).filter((value) => value !== null);
  const riskScore = scoreCandidates.length ? clamp(Math.max(...scoreCandidates)) : 0;
  const institutions = unique(paths.flatMap((path) => path.institutions));
  const highRiskSignals = signals.filter((signal) => clamp(signal.score) >= 0.8).map((signal) => signal.label || signal.type);
  const conflictingEvidence = (detail.evidence || []).filter((item) => item.status === 'CONFLICTING').length;
  const recommendation = buildRevealRecommendation(detail);

  let status = 'CONTEXT_REVIEW';
  let title = 'Context review recommended';
  let rationale = 'Use the available signals and evidence to decide whether the case needs a bounded trace.';
  const nextActions = [];
  if (!paths.length) {
    status = 'TRACE_REQUIRED';
    title = 'Generate a bounded trace';
    rationale = 'No persisted path is available yet. Start with the earliest case transaction and keep the hop limit bounded.';
    nextActions.push('Run the trace from the earliest case transaction', 'Review the resulting hop explanations', 'Confirm or exclude candidate transactions');
  } else if (conflictingEvidence) {
    status = 'EVIDENCE_CONFLICT';
    title = 'Resolve conflicting evidence';
    rationale = 'At least one evidence commitment is marked conflicting, so a reveal request should wait until source assertions are reconciled.';
    nextActions.push('Open the conflicting evidence record', 'Request a source re-check through the institution channel', 'Record the resolution in the audit chain');
  } else if (riskScore >= 0.8) {
    status = 'HIGH_RISK_REVIEW';
    title = 'High-risk path requires decision';
    rationale = 'The strongest signal or generated path is above the critical review threshold and has explainable supporting indicators.';
    nextActions.push('Review high-risk hops and their evidence', 'Use the minimum-disclosure planner before requesting identity', 'Record the next action or close the case with a reason');
  } else {
    nextActions.push('Review the strongest signal', 'Compare the path with complaint and evidence context', 'Close or pause the case with a documented reason');
  }

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    summary: {
      riskScore,
      riskBand: riskBand(riskScore),
      pathCount: paths.length,
      hopCount: paths.reduce((total, path) => total + path.hopCount, 0),
      institutionCount: institutions.length,
      institutions,
      transactionCount: Number(detail.transactionCount ?? detail.transactions?.length ?? 0),
      signalCount: signals.length,
      evidenceCount: Number(detail.evidenceCount ?? detail.evidence?.length ?? 0),
      complaintCount: detail.complaints?.length || 0,
      conflictingEvidence
    },
    decision: { status, title, rationale, nextActions, highRiskSignals },
    paths,
    graph: paths[0]?.graph || { nodes: [], edges: [] },
    privacy: recommendation
  };
}

export function buildTimeline(detail = {}, auditEvents = [], analysis = buildInvestigationAnalysis(detail)) {
  const items = [
    ...(auditEvents || []).map((event) => ({ id: `audit-${event.id}`, type: 'AUDIT', eventType: event.type || 'AUDIT_EVENT', title: String(event.type || 'AUDIT_EVENT').replaceAll('_', ' '), actor: event.actor || 'System', occurredAt: event.occurredAt, detail: event.target || '', hash: event.hash || null })),
    ...(detail.transactions || []).map((transaction) => ({ id: `transaction-${transaction.id}`, type: 'TRANSACTION', title: `${transaction.rail || 'Payment'} transaction observed`, actor: transaction.sourceInstitution || 'Protected institution', occurredAt: transaction.occurredAt, detail: transaction.reference || 'Masked transaction' })),
    ...(detail.evidence || []).map((item) => ({ id: `evidence-${item.id}`, type: 'EVIDENCE', title: item.title || item.type || 'Evidence captured', actor: item.source || 'TraceShield X', occurredAt: item.capturedAt, detail: item.status || 'UNVERIFIED' })),
    ...(detail.complaints || []).map((item) => ({ id: `complaint-${item.id}`, type: 'COMPLAINT', title: 'Complaint linked to case', actor: item.source || 'Protected institution', occurredAt: item.reportedAt, detail: item.reference || 'Protected complaint' }))
  ];
  return items.filter((item) => asDate(item.occurredAt)).sort((left, right) => asDate(left.occurredAt) - asDate(right.occurredAt)).map((item) => ({ ...item, occurredAt: new Date(item.occurredAt).toISOString() }));
}

export function buildCaseReport(detail = {}, auditEvents = [], auditVerification = null) {
  const analysis = buildInvestigationAnalysis(detail);
  return {
    schemaVersion: 'traceshield-investigation-report/1.0',
    generatedAt: new Date().toISOString(),
    case: {
      id: detail.id,
      reference: detail.caseReference,
      purpose: detail.purpose,
      severity: detail.severity,
      status: detail.status,
      description: detail.description,
      openedAt: detail.openedAt,
      expiresAt: detail.expiresAt,
      assignedTo: detail.assignedTo || 'Protected investigator'
    },
    finding: analysis,
    transactions: (detail.transactions || []).map((transaction) => ({
      reference: transaction.reference || transaction.id,
      from: transaction.from?.token || 'masked account',
      to: transaction.to?.token || 'masked account',
      amount: transaction.amount,
      currency: transaction.currency,
      rail: transaction.rail,
      status: transaction.status,
      occurredAt: transaction.occurredAt
    })),
    evidence: (detail.evidence || []).map((item) => ({ title: item.title || item.type, source: item.source || 'TraceShield X', status: item.status, capturedAt: item.capturedAt, commitment: item.commitment || item.contentCommitment })),
    complaints: (detail.complaints || []).map((item) => ({ reference: item.reference, source: item.source, channel: item.channel, status: item.status, reportedAt: item.reportedAt, summary: item.summary })),
    timeline: buildTimeline(detail, auditEvents, analysis),
    audit: {
      valid: auditVerification?.valid ?? null,
      checkedEvents: auditVerification?.checkedEvents ?? auditEvents.length,
      events: (auditEvents || []).map((event) => ({ type: event.type, actor: event.actor, occurredAt: event.occurredAt, hash: event.hash, previousHash: event.previousHash }))
    },
    privacy: {
      rawIdentityIncluded: false,
      maskedAccountsOnly: true,
      revealPolicy: analysis.privacy.policy,
      recommendedFields: analysis.privacy.minimumFields
    }
  };
}

export function normalizeCaseUpdate(input = {}) {
  const allowedStatuses = ['OPEN', 'PAUSED', 'CLOSED', 'REOPENED', 'REVOKED'];
  const allowedSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  const update = {};
  if (input.status !== undefined) {
    const status = String(input.status).toUpperCase();
    if (!allowedStatuses.includes(status)) throw new Error('Invalid case status');
    update.status = status;
  }
  if (input.severity !== undefined) {
    const severity = String(input.severity).toUpperCase();
    if (!allowedSeverities.includes(severity)) throw new Error('Invalid case severity');
    update.severity = severity;
  }
  if (input.description !== undefined) {
    const description = String(input.description).trim();
    if (!description || description.length > 2000) throw new Error('Case description must be between 1 and 2000 characters');
    update.description = description;
  }
  return update;
}
