const state = {
  health: { mode: 'mock', status: 'loading', consoleIngestionEnabled: true },
  authMode: 'demo',
  authenticated: true,
  loginBusy: false,
  session: null,
  dashboard: null,
  cases: [],
  institutions: [],
  selectedCaseId: null,
  detail: null,
  analysis: null,
  timeline: [],
  notes: [],
  caseFilters: { status: '', severity: '', sort: 'opened' },
  revealRequests: [],
  auditEvents: [],
  ingestionBatches: [],
  auditVerification: null,
  query: '',
  view: 'overview',
  modal: null,
  adapterDraft: null,
  busy: false,
  error: null
};

const app = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');
let caseListUpdateTimer = null;
let caseListSelectionStart = 0;
let motionRefreshFrame = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function shortId(value, length = 14) {
  const text = String(value ?? '');
  if (!text) return '—';
  if (text.length <= length) return text;
  const side = Math.max(3, Math.floor((length - 3) / 2));
  return `${text.slice(0, side)}...${text.slice(-side)}`;
}

function formatDate(value, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata'
  }).format(date);
}

function formatAmount(amount, currency = 'INR') {
  if (amount === null || amount === undefined || amount === '') return '—';
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return `${amount} ${currency}`;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(numeric);
}

function percent(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return `${(numeric * 100).toFixed(digits)}%`;
}

function statusClass(value) {
  return String(value || '').toLowerCase().replaceAll('_', '-');
}

function friendlyLabel(value) {
  const raw = String(value || '').trim();
  const normalized = raw.toUpperCase();
  const normalizedSpaced = normalized.replaceAll('_', ' ');
  const labels = {
    CONTEXT_REVIEW: 'Review context',
    TRACE_REQUIRED: 'Path needed',
    HIGH_RISK_REVIEW: 'High-risk review',
    EVIDENCE_CONFLICT: 'Evidence conflict',
    DATA_INGESTED: 'Data added',
    CASE_CREATED: 'Case created',
    TRACE_EXECUTED: 'Money path found',
    CASE_STATUS_CHANGED: 'Case status changed',
    REVEAL_REQUESTED: 'Details requested',
    EVIDENCE_ADDED: 'Evidence added',
    PATH_CERTIFICATE: 'Path certificate',
    SOURCE_TRANSACTION: 'Source transaction',
    DEVICE_ASSERTION: 'Device check',
    CASH_OUT: 'Cash-out',
    'REVEAL REQUESTED': 'Details requested',
    'EVIDENCE ADDED': 'Evidence added',
    'DATA INGESTED': 'Data added',
    'CASE CREATED': 'Case created',
    'CASH OUT TRANSACTION OBSERVED': 'Cash-out observed',
    'WALLET TRANSACTION OBSERVED': 'Wallet transfer observed',
    VELOCITY: 'Quick follow-up transfer',
    CROSS_BANK: 'Cross-institution transfer',
    DEVICE_REUSE: 'Same device used again',
    AMOUNT_CONSERVATION: 'Amount stayed similar',
    SUBSTANTIATED: 'Confirmed',
    UNVERIFIED: 'Needs checking'
  };
  if (labels[normalized] || labels[normalizedSpaced]) return labels[normalized] || labels[normalizedSpaced];
  return raw.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function purposeLabel(value) {
  const labels = {
    FRAUD_INVESTIGATION: 'Fraud investigation',
    AML_REVIEW: 'Financial crime review',
    RECOVERY: 'Recovery',
    AUDIT: 'Audit'
  };
  return labels[String(value || '').toUpperCase()] || friendlyLabel(value || 'Investigation');
}

function actorLabel(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'System';
  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  if (['a. singh', 'a singh', 'asingh'].includes(normalized)) return 'You';
  return text;
}

function decisionTitle(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('generate a bounded trace')) return 'Find the money path first';
  if (normalized.includes('high-risk path')) return 'Review the high-risk transfers';
  if (normalized.includes('context review')) return 'Review the case context';
  return value || 'Review the case before acting';
}

function decisionRationale(value) {
  const text = String(value || '');
  if (text.toLowerCase().includes('no persisted path is available')) return 'The payment path has not been checked yet. Find it to see how the transfers connect.';
  if (text.toLowerCase().includes('review the protected case context')) return 'Review the evidence below before choosing the next step.';
  return text || 'Review the evidence below before choosing the next step.';
}

function decisionAction(value) {
  const text = String(value || '');
  const normalized = text.toLowerCase();
  if (normalized.includes('run the trace')) return 'Find the money path';
  if (normalized.includes('resulting hop explanations')) return 'Review why each transfer was linked';
  if (normalized.includes('confirm or exclude')) return 'Confirm which transfers belong in the case';
  return text;
}

function badge(value) {
  const text = String(value || 'UNKNOWN');
  return `<span class="badge ${escapeHtml(statusClass(text))}">${escapeHtml(friendlyLabel(text))}</span>`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof payload === 'object' ? payload.error : payload;
    const error = new Error(message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showToast(message, type = 'success') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  toastRegion.append(element);
  window.setTimeout(() => element.remove(), 4200);
}

function setError(error) {
  state.error = error ? (error.message || String(error)) : null;
}

function accountDisplay(account, fallbackId) {
  if (account && typeof account === 'object') {
    return {
      token: account.token || account.accountToken || shortId(account.id),
      institution: account.institution || account.institutionCode || 'Protected institution',
      status: account.status || '',
      id: account.id || fallbackId
    };
  }
  return {
    token: shortId(account || fallbackId),
    institution: 'Protected institution',
    status: '',
    id: fallbackId || account
  };
}

function caseAccounts(detail) {
  const map = new Map();
  const add = (account, id) => {
    const item = accountDisplay(account, id);
    if (item.id && !map.has(item.id)) map.set(item.id, item);
  };
  for (const transaction of detail?.transactions || []) {
    add(transaction.from, transaction.fromAccountId);
    add(transaction.to, transaction.toAccountId);
  }
  for (const path of detail?.paths || []) {
    for (const hop of path.hops || []) {
      add(hop.from, hop.fromAccountId);
      add(hop.to, hop.toAccountId);
    }
  }
  return [...map.values()];
}

function preferredCaseId(cases) {
  return cases.find((item) => Number(item.pathCount || 0) > 0 || Number(item.riskScore || 0) >= 0.8)?.id || cases[0]?.id || null;
}

function renderLogin() {
  return `<main class="auth-shell">
    <section class="auth-card" aria-labelledby="login-title">
      <div class="brand auth-brand"><div class="brand-mark">TS</div><div><div class="brand-name">TraceShield X</div><div class="brand-caption">Investigation console</div></div></div>
      <div class="section-kicker">Protected operator access</div>
      <h1 id="login-title">Enter the investigation boundary.</h1>
      <p class="auth-copy">Use your assigned investigator credential. Raw identity data stays outside this console until an approved reveal is recorded.</p>
      ${state.error ? `<div class="error-banner" role="alert">${escapeHtml(state.error)}</div>` : ''}
      <form class="auth-form" data-form="login">
        <div class="field"><label for="login-name">Login name</label><input id="login-name" name="loginName" autocomplete="username" required autofocus /></div>
        <div class="field"><label for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" required /></div>
        <button class="button primary auth-submit" type="submit" ${state.loginBusy ? 'disabled' : ''}>${state.loginBusy ? 'Signing in…' : 'Sign in securely'}</button>
      </form>
      <div class="auth-foot"><span>Session duration: 8 hours</span><span>Identity fields masked</span></div>
    </section>
  </main>`;
}

function renderSidebar() {
  const pendingCount = Number(state.dashboard?.pendingReveals || state.revealRequests.filter((item) => item.status === 'PENDING').length || 0);
  const nav = [
    ['overview', 'O', 'Overview'],
    ['cases', 'C', 'Cases'],
    ['reveals', 'R', 'Approvals'],
    ['audit', 'A', 'Activity']
  ];
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">TS</div>
        <div>
          <div class="brand-name">TraceShield X</div>
          <div class="brand-caption">Investigation console</div>
        </div>
      </div>
      <div class="nav-label">Workspace</div>
      <nav class="nav-list" aria-label="Primary navigation">
        ${nav.map(([view, icon, label]) => `
          <button class="nav-item ${state.view === view ? 'active' : ''}" data-view="${view}" type="button" ${state.view === view ? 'aria-current="page"' : ''}>
            <span class="nav-icon" aria-hidden="true">${icon}</span>
            <span>${label}</span>
            ${view === 'reveals' && pendingCount ? `<span class="nav-badge">${pendingCount}</span>` : ''}
          </button>`).join('')}
      </nav>
      <div class="sidebar-footer">
        <div class="private-session"><span class="live-dot" aria-hidden="true"></span><span>Private session</span></div>
        ${state.authMode === 'session' ? '<button class="button ghost small logout-button" type="button" data-action="logout">Sign out</button>' : ''}
      </div>
    </aside>`;
}

function renderMetric(label, value, note, icon) {
  return `
    <article class="metric-card">
      <div class="metric-top"><span>${escapeHtml(label)}</span><span class="metric-icon">${icon}</span></div>
      <div class="metric-value">${escapeHtml(value)}</div>
      <div class="metric-note">${escapeHtml(note)}</div>
    </article>`;
}

function displayAuditHealth(value) {
  const readable = String(value || '—').replaceAll('_', ' ');
  return readable === 'DATABASE VERIFIED' ? 'Verified' : readable;
}

function renderMetrics() {
  const dashboard = state.dashboard || {};
  return `<section class="metrics" aria-label="Investigation metrics">
    ${renderMetric('Open cases', dashboard.openCases ?? '—', 'Cases ready to review', 'OPEN')}
    ${renderMetric('High-risk paths', dashboard.criticalPaths ?? '—', 'Cases needing extra review', 'REVIEW')}
    ${renderMetric('Pending approvals', dashboard.pendingReveals ?? '—', 'Waiting for two people', 'WAIT')}
    ${renderMetric('Records verified', displayAuditHealth(dashboard.auditHealth), `Last check ${dashboard.lastIngest || '—'}`, 'READY')}
  </section>`;
}

function renderStartGuide() {
  return `<section class="start-guide" aria-labelledby="start-guide-title" data-reveal>
    <div class="start-guide-copy"><div class="section-kicker">Start here</div><h2 id="start-guide-title">Three simple steps from signal to decision.</h2><p>You do not need to understand every record at once. Begin with the case, follow the path, then ask for details only when the decision needs them.</p></div>
    <ol class="start-guide-steps">
      <li><span class="guide-step-mark">1</span><div><strong>Choose a case</strong><small>Start with the question you need to answer.</small></div></li>
      <li><span class="guide-step-mark">2</span><div><strong>Find the money path</strong><small>See how value moved while names stay hidden.</small></div></li>
      <li><span class="guide-step-mark">3</span><div><strong>Make the next move</strong><small>Use evidence and approvals before acting.</small></div></li>
    </ol>
  </section>`;
}

function renderCaseList() {
  const query = state.query.trim().toLowerCase();
  const filters = state.caseFilters;
  const visible = state.cases
    .filter((item) => !query || `${item.caseReference} ${item.description} ${item.severity} ${item.status}`.toLowerCase().includes(query))
    .filter((item) => !filters.status || item.status === filters.status)
    .filter((item) => !filters.severity || item.severity === filters.severity)
    .sort((left, right) => filters.sort === 'risk'
      ? Number(right.riskScore || 0) - Number(left.riskScore || 0)
      : filters.sort === 'severity'
        ? ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }[left.severity] ?? 9) - ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }[right.severity] ?? 9)
        : new Date(right.openedAt || 0).getTime() - new Date(left.openedAt || 0).getTime());
  return `
    <section class="panel case-panel">
      <div class="panel-header">
        <div><h2 class="panel-title">Cases</h2><p class="panel-caption">Choose a case to see what happened</p></div>
        <span class="badge open">${state.cases.length}</span>
      </div>
      <div class="search-wrap">
        <span class="search-symbol" aria-hidden="true">/</span>
        <label class="sr-only" for="case-search">Search cases</label>
        <input id="case-search" class="search-input" type="search" placeholder="Search by case or description" value="${escapeHtml(state.query)}" data-action="search-cases" />
      </div>
      <div class="case-filters" aria-label="Case filters">
        <label><span class="sr-only">Status</span><select data-case-filter="status"><option value="">All status</option><option value="OPEN" ${filters.status === 'OPEN' ? 'selected' : ''}>Open</option><option value="REOPENED" ${filters.status === 'REOPENED' ? 'selected' : ''}>Reopened</option><option value="PAUSED" ${filters.status === 'PAUSED' ? 'selected' : ''}>Paused</option><option value="CLOSED" ${filters.status === 'CLOSED' ? 'selected' : ''}>Closed</option></select></label>
        <label><span class="sr-only">Severity</span><select data-case-filter="severity"><option value="">All severity</option><option value="CRITICAL" ${filters.severity === 'CRITICAL' ? 'selected' : ''}>Critical</option><option value="HIGH" ${filters.severity === 'HIGH' ? 'selected' : ''}>High</option><option value="MEDIUM" ${filters.severity === 'MEDIUM' ? 'selected' : ''}>Medium</option><option value="LOW" ${filters.severity === 'LOW' ? 'selected' : ''}>Low</option></select></label>
        <label><span class="sr-only">Sort</span><select data-case-filter="sort"><option value="opened" ${filters.sort === 'opened' ? 'selected' : ''}>Newest</option><option value="risk" ${filters.sort === 'risk' ? 'selected' : ''}>Risk first</option><option value="severity" ${filters.sort === 'severity' ? 'selected' : ''}>Severity first</option></select></label>
      </div>
      <div class="case-list">
        ${visible.length ? visible.map((item) => `
          <button class="case-item ${item.id === state.selectedCaseId ? 'selected' : ''}" type="button" data-case-id="${escapeHtml(item.id)}">
            <div class="case-item-top"><span class="case-ref">${escapeHtml(item.caseReference)}</span>${badge(item.severity)}</div>
            <div class="case-summary">${escapeHtml(item.description)}</div>
            <div class="case-item-bottom"><span>${escapeHtml(friendlyLabel(item.status))} · ${escapeHtml(actorLabel(item.assignedTo || 'Unassigned'))}</span><span>${percent(item.riskScore)}</span></div>
          </button>`).join('') : `<div class="empty"><strong>No matching cases</strong>Try a different case reference or keyword.</div>`}
      </div>
    </section>`;
}

function renderPath(path) {
  const hops = path.hops || [];
  if (!hops.length) return `<div class="empty"><strong>No transfers found yet</strong>Run the money-path check after transactions are added.</div>`;
  return `
    <div class="path-banner">
      <div class="path-mark">OK</div>
      <div><strong>Money path found</strong><span>${escapeHtml(path.hopCount || hops.length)} transfer(s) · privacy-safe record created</span></div>
    </div>
    <div class="path-list">
      ${hops.map((hop, index) => {
        const from = accountDisplay(hop.from, hop.fromAccountId);
        const to = accountDisplay(hop.to, hop.toAccountId);
        const risk = Number(hop.riskScore ?? hop.hopRiskScore ?? 0);
        const amount = hop.amountBucket || formatAmount(hop.amount, hop.currency || 'INR');
        return `<div class="hop">
          <div class="hop-number">${escapeHtml(hop.hopNo || index + 1)}</div>
          <div class="hop-main">
            <div class="hop-route"><span class="route-token">${escapeHtml(from.token)}</span><span class="route-arrow" aria-hidden="true">to</span><span class="route-token">${escapeHtml(to.token)}</span></div>
            <div class="hop-meta"><span>${escapeHtml(from.institution)} to ${escapeHtml(to.institution)}</span><span>${escapeHtml(amount)}</span><span>${formatDate(hop.occurredAt, `${hop.gapSeconds ?? hop.temporalGapSeconds ?? 0}s gap`)}</span></div>
            <div class="hop-reason">${escapeHtml(hop.reason || 'This transfer is linked by timing and account continuity.')}</div>
          </div>
          <div class="hop-risk"><div class="risk-number">${percent(risk)}</div><div class="risk-label">risk</div><div class="risk-bar"><span style="width:${Math.max(0, Math.min(100, risk * 100))}%"></span></div></div>
        </div>`;
      }).join('')}
    </div>`;
}

function renderPaths(detail) {
  if (!detail?.paths?.length) return `<div class="empty"><strong>No money path yet</strong>Use “Find the money path” to see how value moved.</div>`;
  return detail.paths.map(renderPath).join('<div style="height:12px"></div>');
}

function renderSignals(detail) {
  const signals = detail?.signals || [];
  if (!signals.length) return `<div class="empty"><strong>No warning signs yet</strong>Signals appear after the source data is checked.</div>`;
  return signals.map((signal) => `
    <article class="signal">
      <div class="signal-top"><span class="signal-label">${escapeHtml(friendlyLabel(signal.label || signal.type || 'Signal'))}</span><span class="signal-score">${percent(signal.score)}</span></div>
      <div class="signal-text">${escapeHtml(signal.explanation || 'No explanation supplied.')}</div>
    </article>`).join('');
}

function renderTransactions(detail) {
  const transactions = detail?.transactions || [];
  if (!transactions.length) return `<div class="empty"><strong>No transactions yet</strong>Transactions appear when data is added to this case.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Reference</th><th>Route</th><th>Amount</th><th>Rail</th><th>Time</th></tr></thead>
    <tbody>${transactions.map((transaction) => {
      const from = accountDisplay(transaction.from, transaction.fromAccountId);
      const to = accountDisplay(transaction.to, transaction.toAccountId);
      return `<tr><td class="mono">${escapeHtml(transaction.reference || shortId(transaction.id))}</td><td>${escapeHtml(from.token)} to ${escapeHtml(to.token)}</td><td>${escapeHtml(formatAmount(transaction.amount, transaction.currency || 'INR'))}</td><td>${escapeHtml(transaction.rail || transaction.paymentRail || '—')}</td><td>${formatDate(transaction.occurredAt)}</td></tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function renderRevealRequests(requests, detail) {
  const items = requests || [];
  if (!items.length) return `<div class="empty"><strong>No requests for details</strong>Ask for the smallest set of personal details when they are truly needed.</div>`;
  const approvers = state.session?.approvers || [];
  const supervisor = approvers.find((item) => item.role === 'SUPERVISOR') || { id: '2', displayName: 'Supervisor', role: 'SUPERVISOR' };
  const auditor = approvers.find((item) => item.role === 'AUDITOR') || { id: '3', displayName: 'Auditor', role: 'AUDITOR' };
  return items.map((request) => {
    const approvals = request.approvals || [];
    const approvedCount = approvals.filter((item) => item.decision === 'APPROVE').length;
    const pending = request.status === 'PENDING';
    const supervisorApproved = approvals.some((item) => String(item.approverId) === '2' || item.role === 'SUPERVISOR');
    const auditorApproved = approvals.some((item) => String(item.approverId) === '3' || item.role === 'AUDITOR');
    return `<article class="reveal-request">
      <div class="reveal-top"><span class="reveal-target">Protected account · ${escapeHtml(shortId(request.target || request.targetAccountId, 12))}</span>${badge(request.status)}</div>
      <div class="reveal-reason">${escapeHtml(request.reason)}</div>
      <div class="muted">Fields: ${escapeHtml((request.requestedFields || []).join(', '))}</div>
      <div class="approval-row"><span>${approvedCount} of ${request.requiredApprovals || 2} approvals · expires ${formatDate(request.expiresAt)}</span>${pending ? `<span class="approval-actions">${supervisorApproved ? '' : `<button class="button small" type="button" data-action="approve" data-approver-id="${escapeHtml(supervisor.id)}" data-approver-name="${escapeHtml(supervisor.displayName)}" data-approver-role="${escapeHtml(supervisor.role)}" data-request-id="${escapeHtml(request.id)}">${escapeHtml(supervisor.displayName)}</button>`}${auditorApproved ? '' : `<button class="button small" type="button" data-action="approve" data-approver-id="${escapeHtml(auditor.id)}" data-approver-name="${escapeHtml(auditor.displayName)}" data-approver-role="${escapeHtml(auditor.role)}" data-request-id="${escapeHtml(request.id)}">${escapeHtml(auditor.displayName)}</button>`}<button class="button small danger" type="button" data-action="reject" data-approver-id="${escapeHtml(supervisor.id)}" data-approver-name="${escapeHtml(supervisor.displayName)}" data-approver-role="${escapeHtml(supervisor.role)}" data-request-id="${escapeHtml(request.id)}">Reject</button></span>` : ''}</div>
      ${approvals.length ? `<div class="muted">${approvals.map((item) => `${escapeHtml(item.approverName || item.approverId)}: ${escapeHtml(friendlyLabel(item.decision))}`).join(' · ')}</div>` : ''}
    </article>`;
  }).join('');
}

function renderEvidence(detail) {
  const evidence = detail?.evidence || [];
  if (!evidence.length) return `<div class="empty"><strong>No evidence yet</strong>Checks and supporting records will appear here as the case develops.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Evidence</th><th>Source</th><th>Status</th><th>Commitment</th></tr></thead>
    <tbody>${evidence.map((item) => `<tr><td><strong>${escapeHtml(item.title || item.type)}</strong><br><span class="muted">${formatDate(item.capturedAt)}</span></td><td>${escapeHtml(item.source || 'TraceShield X')}</td><td>${badge(item.status || 'UNVERIFIED')}</td><td class="mono">${escapeHtml(shortId(item.commitment || item.contentCommitment))}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function renderIngestionBatches() {
  const batches = state.ingestionBatches || [];
  if (!batches.length) return `<div class="empty compact"><strong>No incoming data yet</strong>Protected institution data will appear here when it is added.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Batch</th><th>Institution</th><th>Records</th><th>Status</th><th>Context / created</th></tr></thead>
    <tbody>${batches.map((batch) => `<tr>
      <td><strong class="mono">${escapeHtml(batch.batchReference)}</strong><br><span class="muted">${escapeHtml(batch.sourceSystem || 'institution adapter')}</span></td>
      <td>${escapeHtml(batch.sourceInstitutionCode || 'Protected institution')}</td>
      <td>${escapeHtml(batch.recordCount ?? 0)}</td>
      <td>${badge(batch.status || 'RECEIVED')}</td>
      <td><span class="mono">${escapeHtml(shortId(batch.contextId, 16))}</span><br><span class="muted">${formatDate(batch.createdAt)}</span></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function createAdapterDraft() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const institution = state.institutions.find((item) => Number(item.id) === Number(state.session?.investigator?.institutionId)) || state.institutions[0];
  return {
    sourceInstitutionCode: institution?.code || 'NSB',
    batchReference: `console-${suffix}`,
    senderRef: `console-sender-${suffix}`,
    receiverRef: `console-receiver-${suffix}`,
    amount: '1750'
  };
}

function renderComplaints(detail) {
  const complaints = detail?.complaints || [];
  if (!complaints.length) return `<div class="empty"><strong>No related complaints</strong>Customer or authority reports can be linked here without exposing raw identity.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Reference</th><th>Source</th><th>Channel</th><th>Status</th></tr></thead>
    <tbody>${complaints.map((item) => `<tr><td><strong class="mono">${escapeHtml(item.reference || shortId(item.id))}</strong><br><span class="muted">${formatDate(item.reportedAt)}</span></td><td>${escapeHtml(item.source || 'Protected institution')}</td><td>${escapeHtml(item.channel || '—')}</td><td>${badge(item.status || 'OPEN')}<br><span class="muted">${escapeHtml(item.summary || '')}</span></td></tr>`).join('')}</tbody>
  </table></div>`;
}

function renderAudit(detail) {
  const events = state.auditEvents || [];
  const verification = state.auditVerification;
  if (!events.length) return `<div class="empty"><strong>No activity recorded yet</strong>Important case actions will appear here.</div>`;
  return `<div class="audit-list">${events.slice().reverse().map((event) => `<article class="audit-event"><div class="audit-dot"></div><div><div class="audit-title">${escapeHtml(friendlyLabel(event.type))}</div><div class="audit-meta">${escapeHtml(actorLabel(event.actor))} · ${formatDate(event.occurredAt)}</div><div class="audit-hash">${escapeHtml(shortId(event.hash, 28))}</div></div></article>`).join('')}</div>
    ${verification ? `<div class="verified-line">${verification.valid ? 'OK' : 'REVIEW'} ${escapeHtml(verification.message || (verification.valid ? 'Activity history verified.' : 'Activity history needs review.'))}</div>` : ''}`;
}

function renderAnalysis(detail) {
  const analysis = state.analysis || detail?.analysis;
  if (!analysis) return `<div class="empty"><strong>Preparing the case summary</strong>The next-step recommendation will appear when the case is loaded.</div>`;
  const summary = analysis.summary || {};
  const decision = analysis.decision || {};
  const path = analysis.paths?.[0];
  const graphNodes = analysis.graph?.nodes || [];
  return `<section class="section-card analysis-card"><div class="section-card-header"><div><h3 class="section-card-title">What we know</h3><div class="section-card-caption">A short summary before you choose the next step</div></div>${badge(decision.status || 'CONTEXT_REVIEW')}</div><div class="section-card-body">
    <div class="decision-banner"><div><strong>${escapeHtml(decisionTitle(decision.title))}</strong><p>${escapeHtml(decisionRationale(decision.rationale))}</p></div><span class="decision-score">${percent(summary.riskScore || 0)}</span></div>
    <div class="analysis-stats"><div><span>Warning signs</span><strong>${escapeHtml(summary.signalCount ?? 0)}</strong></div><div><span>High-risk transfers</span><strong>${escapeHtml(path?.highRiskHops?.length ?? 0)}</strong></div><div><span>Institutions involved</span><strong>${escapeHtml(summary.institutionCount ?? 0)}</strong></div><div><span>Evidence conflicts</span><strong>${escapeHtml(summary.conflictingEvidence ?? 0)}</strong></div></div>
    <div class="analysis-columns"><div><div class="analysis-subtitle">What to do next</div><ul class="next-actions">${(decision.nextActions || []).map((action) => `<li>${escapeHtml(decisionAction(action))}</li>`).join('')}</ul></div><div><div class="analysis-subtitle">Money path</div><div class="graph-lane">${graphNodes.length ? graphNodes.map((node, index) => `<div class="graph-node"><span class="graph-node-dot ${statusClass(node.status)}"></span><strong>${escapeHtml(node.token)}</strong><small>${escapeHtml(node.institution)}</small>${index < graphNodes.length - 1 ? '<span class="graph-link" aria-hidden="true">to</span>' : ''}</div>`).join('') : '<span class="muted">Run the money-path check to see transfers.</span>'}</div></div></div>
    <div class="analysis-footer"><span>Details still hidden: ${escapeHtml((analysis.privacy?.minimumFields || ['account holder name']).join(', '))}</span><span>${escapeHtml(path?.institutionCount ?? 0)} institution change(s)</span></div>
  </div></section>`;
}

function renderTimeline() {
  if (!state.timeline.length) return `<div class="empty"><strong>No activity yet</strong>Case events will appear here as the review continues.</div>`;
  return `<div class="timeline-list">${state.timeline.slice().reverse().slice(0, 8).map((item) => `<article class="timeline-item"><div class="timeline-marker"></div><div><div class="timeline-title">${escapeHtml(friendlyLabel(item.title))}</div><div class="timeline-meta">${escapeHtml(actorLabel(item.actor))} · ${formatDate(item.occurredAt)}</div><div class="timeline-detail">${escapeHtml(item.detail || '')}</div></div></article>`).join('')}</div>`;
}

function renderNotes(detail) {
  const notes = state.notes || detail?.notes || [];
  return `<div class="notes-wrap"><div class="notes-list">${notes.length ? notes.map((note) => `<article class="note"><div class="note-top"><strong>${escapeHtml(actorLabel(note.authorName || 'Protected investigator'))}</strong><span>${formatDate(note.createdAt)}</span></div><p>${escapeHtml(note.body)}</p></article>`).join('') : '<div class="empty compact"><strong>No notes yet</strong>Add the reason for your next decision.</div>'}</div><form class="note-form" data-form="add-note"><label class="sr-only" for="case-note">Add case note</label><textarea id="case-note" name="body" maxlength="4000" required placeholder="Explain why you are taking the next step..."></textarea><button class="button small" type="submit">Save note</button></form></div>`;
}

function renderDetail() {
  const detail = state.detail;
  if (!detail) return `<section class="panel detail"><div class="empty"><strong>Choose a case</strong>Select a case on the left to see what happened and what to do next.</div></section>`;
  const caseRevealRequests = state.revealRequests.filter((item) => item.caseId === detail.id);
  const institutions = detail.institutions || [...new Set((detail.transactions || []).flatMap((item) => [item.from?.institution, item.to?.institution]).filter(Boolean))];
  return `<section class="panel detail">
    <div class="detail-head">
      <div>
        <div class="detail-ref"><span>${escapeHtml(detail.caseReference)}</span>${badge(detail.severity)}${badge(detail.status)}</div>
        <h2 class="detail-title">${escapeHtml(detail.description)}</h2>
        <p class="detail-subtitle">${escapeHtml(purposeLabel(detail.purpose))} · Assigned to ${escapeHtml(actorLabel(detail.assignedTo || 'Lead investigator'))} · ${institutions.length ? escapeHtml(institutions.join(' · ')) : 'No institutions linked yet'}</p>
      </div>
      <div class="detail-actions"><select class="case-status-select" data-case-status aria-label="Change case status">${['OPEN', 'REOPENED', 'PAUSED', 'CLOSED', 'REVOKED'].map((status) => `<option value="${status}" ${detail.status === status ? 'selected' : ''}>${friendlyLabel(status)}</option>`).join('')}</select><button class="button" type="button" data-action="request-reveal">Ask for details</button><button class="button" type="button" data-action="download-report">Download report</button><button class="button primary" type="button" data-action="trace">${state.busy ? 'Finding path…' : 'Find money path'}</button></div>
    </div>
    <div class="detail-metrics">
      <div class="mini-stat"><div class="mini-label">Risk</div><div class="mini-value">${percent(detail.riskScore)}</div></div>
      <div class="mini-stat"><div class="mini-label">Transfers</div><div class="mini-value">${escapeHtml(detail.transactionCount ?? detail.transactions?.length ?? 0)}</div></div>
      <div class="mini-stat"><div class="mini-label">Paths found</div><div class="mini-value">${escapeHtml(detail.pathCount ?? detail.paths?.length ?? 0)}</div></div>
      <div class="mini-stat"><div class="mini-label">Evidence items</div><div class="mini-value">${escapeHtml(detail.evidenceCount ?? detail.evidence?.length ?? 0)}</div></div>
    </div>
    <div class="detail-grid">
      <div class="stack">
        ${renderAnalysis(detail)}
        <section class="section-card"><div class="section-card-header"><div><h3 class="section-card-title">Money path</h3><div class="section-card-caption">Follow the value without showing names</div></div><span class="section-card-caption">${detail.paths?.length || 0} found</span></div><div class="section-card-body">${renderPaths(detail)}</div></section>
        <section class="section-card"><div class="section-card-header"><div><h3 class="section-card-title">Why this case is risky</h3><div class="section-card-caption">Signals that need your attention</div></div></div><div class="section-card-body"><div class="signal-grid">${renderSignals(detail)}</div></div></section>
        <section class="section-card"><div class="section-card-header"><div><h3 class="section-card-title">Transfers in this case</h3><div class="section-card-caption">Names and personal details stay hidden</div></div></div><div class="section-card-body">${renderTransactions(detail)}</div></section>
      </div>
      <div class="stack">
        <section class="section-card reveal-card" id="reveal-queue"><div class="section-card-header"><div><h3 class="section-card-title">Requests for details</h3><div class="section-card-caption">Two people approve before hidden details are shown</div></div><button class="button small" type="button" data-action="request-reveal">Ask</button></div><div class="section-card-body">${renderRevealRequests(caseRevealRequests, detail)}</div></section>
        <section class="section-card"><div class="section-card-header"><div><h3 class="section-card-title">Case notes</h3><div class="section-card-caption">Why the next step makes sense</div></div></div><div class="section-card-body">${renderNotes(detail)}</div></section>
        <section class="section-card"><div class="section-card-header"><div><h3 class="section-card-title">What happened</h3><div class="section-card-caption">Events in this case, newest first</div></div></div><div class="section-card-body">${renderTimeline()}</div></section>
        <details class="supporting-records" id="supporting-records"><summary><span><strong>Supporting records</strong><small>Complaints, evidence, incoming data, and activity history</small></span><span class="supporting-records-toggle"><span class="when-closed">Open</span><span class="when-open">Close</span></span></summary><div class="supporting-records-body">
          <section class="section-card"><div class="section-card-header"><div><h3 class="section-card-title">Related complaints</h3><div class="section-card-caption">Reports connected to this case</div></div></div><div class="section-card-body">${renderComplaints(detail)}</div></section>
          <section class="section-card"><div class="section-card-header"><div><h3 class="section-card-title">Evidence used</h3><div class="section-card-caption">Checks and records supporting the review</div></div></div><div class="section-card-body">${renderEvidence(detail)}</div></section>
          <section class="section-card ingestion-card"><div class="section-card-header"><div><h3 class="section-card-title">Incoming institution data</h3><div class="section-card-caption">Protected batches added to this case</div></div><div class="section-card-header-actions"><span class="section-card-caption">${state.ingestionBatches.length} batch(es)</span><button class="button small" type="button" data-action="submit-ingestion" data-testid="open-adapter-batch" ${state.health.consoleIngestionEnabled === false ? 'disabled title="Console ingestion is disabled; use the signed adapter CLI."' : ''}>Add data</button></div></div><div class="section-card-body">${renderIngestionBatches()}</div></section>
          <section class="section-card" id="audit-log"><div class="section-card-header"><div><h3 class="section-card-title">Activity history</h3><div class="section-card-caption">A record of every important case action</div></div><button class="button small" type="button" data-action="verify-audit">Check record</button></div><div class="section-card-body">${renderAudit(detail)}</div></section>
        </div></details>
      </div>
    </div>
  </section>`;
}

function renderModal() {
  if (!state.modal) return '';
  if (state.modal.type === 'case') {
    return `<div class="modal-backdrop" data-action="close-modal"><form class="modal" data-form="create-case" method="post">
      <div class="modal-header"><div><h2 class="modal-title">Create a case</h2><p class="panel-caption">Tell us what question this case needs to answer.</p></div><button class="button ghost" type="button" data-action="close-modal" aria-label="Close">x</button></div>
      <div class="modal-body">
        <div class="field"><label for="case-reference">Case reference</label><input id="case-reference" name="caseReference" required value="TSX-${new Date().getFullYear()}-${String(state.cases.length + 1).padStart(4, '0')}" /></div>
        <div class="field"><label for="case-severity">Severity</label><select id="case-severity" name="severity"><option>CRITICAL</option><option>HIGH</option><option selected>MEDIUM</option><option>LOW</option></select></div>
        <div class="field"><label for="case-purpose">Purpose</label><select id="case-purpose" name="purpose"><option value="FRAUD_INVESTIGATION">Fraud investigation</option><option value="AML_REVIEW">AML review</option><option value="RECOVERY">Recovery</option><option value="AUDIT">Audit</option></select></div>
        <div class="field"><label for="case-description">Description</label><textarea id="case-description" name="description" required placeholder="What question must this case answer?"></textarea></div>
      </div>
      <div class="modal-footer"><button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit">Create case</button></div>
    </form></div>`;
  }
  if (state.modal.type === 'reveal') {
    const accounts = caseAccounts(state.detail);
    const options = accounts.length ? accounts.map((account, index) => `<option value="${escapeHtml(account.id)}" data-token="${escapeHtml(account.token)}" ${index === 0 ? 'selected' : ''}>Protected account ${index + 1} · ${escapeHtml(account.institution)}</option>`).join('') : '<option value="unknown">No protected account available</option>';
    const minimumFields = state.analysis?.privacy?.minimumFields || ['account holder name'];
    return `<div class="modal-backdrop" data-action="close-modal"><form class="modal" data-form="create-reveal" method="post">
      <div class="modal-header"><div><h2 class="modal-title">Ask to see details</h2><p class="panel-caption">Request only the personal details needed for the next step.</p></div><button class="button ghost" type="button" data-action="close-modal" aria-label="Close">x</button></div>
      <div class="modal-body">
        <div class="planner-note"><strong>Recommended minimum: ${escapeHtml(minimumFields.join(', '))}</strong><span>${escapeHtml(state.analysis?.privacy?.rationale || 'Identity fields remain masked until necessity is documented.')}</span></div>
        <div class="field"><label for="reveal-target">Account to check</label><select id="reveal-target" name="targetAccountId">${options}</select></div>
        <div class="field"><label for="reveal-fields">Requested fields</label><input id="reveal-fields" name="requestedFields" value="${escapeHtml(minimumFields.join(', '))}" /></div>
        <div class="field"><label for="reveal-reason">Why you need it</label><textarea id="reveal-reason" name="reason" required placeholder="Explain why the detail is needed and what you will do next."></textarea></div>
      </div>
      <div class="modal-footer"><button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit">Submit for approval</button></div>
    </form></div>`;
  }
  if (state.modal.type === 'ingestion') {
    const draft = state.adapterDraft || createAdapterDraft();
    const institutionOptions = state.institutions.length
      ? state.institutions.map((institution) => `<option value="${escapeHtml(institution.code)}" ${institution.code === draft.sourceInstitutionCode ? 'selected' : ''}>${escapeHtml(institution.code)} · ${escapeHtml(institution.name)}</option>`).join('')
      : '<option value="NSB" selected>NSB · Northstar Bank</option>';
    return `<div class="modal-backdrop" data-action="close-modal"><form class="modal adapter-modal" data-form="ingestion" method="post">
      <div class="modal-header"><div><h2 class="modal-title">Add institution data</h2><p class="panel-caption">Add a protected sample from an institution without sending raw identity details.</p></div><button class="button ghost" type="button" data-action="close-modal" aria-label="Close">x</button></div>
      <div class="modal-body">
        <div class="planner-note adapter-note"><strong>Names stay protected</strong><span>The server turns source references into protected tokens and records where the data came from.</span></div>
        <div class="adapter-grid">
          <div class="field"><label for="adapter-institution">Source institution</label><select id="adapter-institution" name="sourceInstitutionCode">${institutionOptions}</select></div>
          <div class="field"><label for="adapter-amount">Amount input</label><input id="adapter-amount" name="amount" type="number" min="1" step="0.01" value="${escapeHtml(draft.amount)}" required /></div>
        </div>
        <div class="field"><label for="adapter-reference">Stable batch reference</label><input id="adapter-reference" name="batchReference" value="${escapeHtml(draft.batchReference)}" maxlength="120" required /></div>
        <div class="adapter-grid">
          <div class="field"><label for="adapter-sender">Source-local sender reference</label><input id="adapter-sender" name="senderRef" value="${escapeHtml(draft.senderRef)}" maxlength="256" required /></div>
          <div class="field"><label for="adapter-receiver">Source-local receiver reference</label><input id="adapter-receiver" name="receiverRef" value="${escapeHtml(draft.receiverRef)}" maxlength="256" required /></div>
        </div>
        <p class="modal-help">The source references are used only inside the adapter request. The shared database receives protected digests and commitments.</p>
      </div>
      <div class="modal-footer"><button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit">${state.busy ? 'Submitting…' : 'Commit protected batch'}</button></div>
    </form></div>`;
  }
  return '';
}

function renderHero() {
  const mode = state.health.mode === 'postgres' ? 'Database connected' : 'Demo data loaded';
  return `<section class="hero" aria-labelledby="hero-title">
    <div class="hero-copy" data-hero-copy>
      <div class="hero-kicker"><span class="hero-kicker-line"></span>Privacy-preserving investigations</div>
      <h1 id="hero-title">Trace the <span class="inline-visual" aria-hidden="true"><i></i><i></i><i></i></span> signal.<br><em>Keep the person private.</em></h1>
      <p class="hero-description">Follow a suspicious payment across institutions, understand why it was flagged, and request personal details only when the next action truly needs them.</p>
      <div class="hero-actions"><button class="button primary hero-button" type="button" data-action="trace">${state.busy ? 'Finding path…' : 'Find the money path'}</button><button class="button hero-button-secondary" type="button" data-action="new-case">Start a new case</button></div>
      <div class="hero-note"><span class="live-dot"></span><span>${escapeHtml(mode)}</span><span class="hero-note-divider"></span><span>Personal details stay hidden</span></div>
    </div>
    <div class="hero-visual" data-scroll-image role="img" aria-label="Abstract protected transaction path visualization">
      <div class="visual-noise"></div>
      <div class="visual-header"><span>Identity layer / closed</span><span class="visual-code">TSX / protected</span></div>
      <div class="visual-field">
        <div class="visual-axis axis-one"></div><div class="visual-axis axis-two"></div><div class="visual-axis axis-three"></div>
        <div class="visual-route route-one"></div><div class="visual-route route-two"></div><div class="visual-route route-three"></div>
        <div class="trace-node node-one"><span class="node-point"></span><span>source account</span></div>
        <div class="trace-node node-two"><span class="node-point"></span><span>next transfer</span></div>
        <div class="trace-node node-three"><span class="node-point"></span><span>destination account</span></div>
        <div class="trace-core"><span>TRACE</span><strong>masked</strong></div>
      </div>
      <div class="visual-footer"><span>Value path</span><span>Purpose</span><span>Activity saved</span></div>
    </div>
  </section>`;
}

function initMotion() {
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  if (!gsap || !ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.getAll().forEach((trigger) => trigger.kill());

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    gsap.set('[data-reveal], [data-hero-copy], [data-scroll-image], [data-stack-card]', { clearProps: 'all' });
    return;
  }

  gsap.fromTo('[data-hero-copy]', { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: 'power3.out' });
  const scrollVisual = document.querySelector('[data-scroll-image]');
  if (scrollVisual) {
    gsap.fromTo(scrollVisual, { autoAlpha: 0.2, scale: 0.8 }, { autoAlpha: 1, scale: 1, ease: 'none', scrollTrigger: { trigger: scrollVisual, start: 'top bottom', end: 'bottom top', scrub: true } });
  }

  const revealItems = gsap.utils.toArray('[data-reveal]');
  revealItems.forEach((item) => gsap.fromTo(item, { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.7, ease: 'power2.out', scrollTrigger: { trigger: item, start: 'top 86%', once: true } }));

  const stage = document.querySelector('.stack-stage');
  const stackCards = gsap.utils.toArray('[data-stack-card]');
  const stackEnabled = window.matchMedia?.('(min-width: 981px)').matches ?? true;
  if (stage && stackCards.length && stackEnabled) {
    stackCards.forEach((card, index) => gsap.fromTo(card, { y: 120 + index * 28, rotate: (index - 1) * 2.5, autoAlpha: 0.34 }, { y: index * 8, rotate: 0, autoAlpha: 1, ease: 'none', scrollTrigger: { trigger: stage, start: `top+=${index * 80} 78%`, end: `top+=${index * 80 + 360} 34%`, scrub: true } }));
  } else if (stackCards.length) {
    gsap.set(stackCards, { clearProps: 'all' });
  }

  if (motionRefreshFrame) cancelAnimationFrame(motionRefreshFrame);
  motionRefreshFrame = requestAnimationFrame(() => {
    motionRefreshFrame = null;
    ScrollTrigger.refresh();
  });
}

function updateCaseList({ preserveFocus = false, selectionStart = state.query.length } = {}) {
  const panel = document.querySelector('.case-panel');
  if (!panel) {
    render();
    return;
  }

  panel.outerHTML = renderCaseList();
  if (preserveFocus) {
    const input = document.querySelector('#case-search');
    input?.focus();
    input?.setSelectionRange(selectionStart, selectionStart);
  }
}

function scheduleCaseListUpdate(selectionStart) {
  caseListSelectionStart = selectionStart;
  if (caseListUpdateTimer) window.clearTimeout(caseListUpdateTimer);
  caseListUpdateTimer = window.setTimeout(() => {
    caseListUpdateTimer = null;
    updateCaseList({ preserveFocus: true, selectionStart: caseListSelectionStart });
  }, 90);
}

function render() {
  if (caseListUpdateTimer) {
    window.clearTimeout(caseListUpdateTimer);
    caseListUpdateTimer = null;
  }
  if (state.authenticated === false) {
    app.innerHTML = renderLogin();
    document.querySelector('#login-name')?.focus();
    return;
  }
  app.innerHTML = `${renderSidebar()}<main class="main" id="overview">
    <header class="topbar"><div><div class="eyebrow">Investigation workspace</div><p>Follow the evidence. Protect the person.</p></div><div class="topbar-actions"><div class="mode-pill"><span class="mode-dot"></span>${escapeHtml(state.health.mode === 'postgres' ? 'Database connected' : 'Demo data loaded')}</div></div></header>
    ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
    ${renderHero()}
    ${renderMetrics()}
    ${renderStartGuide()}
    <section class="workspace-anchor" id="case-workspace" aria-labelledby="workspace-title"><div class="workspace-heading" data-reveal><div><div class="section-kicker">Your work area</div><h2 id="workspace-title">Work through a case without exposing personal details.</h2></div><span class="workspace-status">Names hidden</span></div><div class="workspace">${renderCaseList()}${renderDetail()}</div></section>
  </main>${renderModal()}`;
  initMotion();
  if (state.modal) requestAnimationFrame(() => document.querySelector('.modal input, .modal select, .modal textarea')?.focus());
}

async function loadCase(caseId) {
  if (!caseId) return;
  state.selectedCaseId = caseId;
  state.auditVerification = null;
  state.error = null;
  render();
  try {
    const [detail, revealRequests, auditEvents, analysis, timeline, notes, ingestionBatches] = await Promise.all([
      api(`/api/cases/${encodeURIComponent(caseId)}`),
      api(`/api/reveal-requests?caseId=${encodeURIComponent(caseId)}`),
      api(`/api/audit?caseId=${encodeURIComponent(caseId)}`),
      api(`/api/cases/${encodeURIComponent(caseId)}/analysis`),
      api(`/api/cases/${encodeURIComponent(caseId)}/timeline`),
      api(`/api/cases/${encodeURIComponent(caseId)}/notes`),
      api(`/api/ingestion/batches?caseId=${encodeURIComponent(caseId)}`)
    ]);
    state.detail = detail;
    state.analysis = analysis;
    state.timeline = timeline;
    state.notes = notes;
    state.revealRequests = revealRequests;
    state.auditEvents = auditEvents;
    state.ingestionBatches = ingestionBatches;
  } catch (error) {
    setError(error);
    showToast(error.message, 'error');
  }
  render();
}

async function refreshDashboard() {
  state.dashboard = await api('/api/dashboard');
  state.cases = await api('/api/cases');
  if (!state.selectedCaseId && state.cases[0]) state.selectedCaseId = preferredCaseId(state.cases);
}

async function traceSelectedCase() {
  if (!state.selectedCaseId || state.busy) return;
  state.busy = true;
  state.error = null;
  render();
  try {
    const result = await api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}/trace`, { method: 'POST', body: JSON.stringify({ maxHops: 5 }) });
    const [detail, auditEvents, analysis, timeline, notes] = await Promise.all([
      api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}`),
      api(`/api/audit?caseId=${encodeURIComponent(state.selectedCaseId)}`),
      api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}/analysis`),
      api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}/timeline`),
      api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}/notes`)
    ]);
    state.detail = detail;
    state.analysis = analysis;
    state.timeline = timeline;
    state.notes = notes;
    state.auditEvents = auditEvents;
    state.auditVerification = null;
    await refreshDashboard();
    state.revealRequests = await api(`/api/reveal-requests?caseId=${encodeURIComponent(state.selectedCaseId)}`);
    showToast('Money path found and activity saved.');
  } catch (error) {
    setError(error);
    showToast(error.message, 'error');
  } finally {
    state.busy = false;
    render();
  }
}

async function submitCase(form) {
  const data = new FormData(form);
  state.busy = true;
  try {
    const created = await api('/api/cases', {
      method: 'POST',
      body: JSON.stringify({
        caseReference: data.get('caseReference'),
        severity: data.get('severity'),
        purpose: data.get('purpose'),
        description: data.get('description')
      })
    });
    state.modal = null;
    await refreshDashboard();
    await loadCase(created.id);
    showToast(`${created.caseReference} created.`);
  } catch (error) {
    setError(error);
    showToast(error.message, 'error');
  } finally {
    state.busy = false;
    render();
  }
}

async function submitReveal(form) {
  if (!state.detail) return;
  const data = new FormData(form);
  const targetOption = form.querySelector('[name="targetAccountId"] option:checked');
  state.busy = true;
  try {
    const request = await api('/api/reveal-requests', {
      method: 'POST',
      body: JSON.stringify({
        caseId: state.detail.id,
        target: targetOption?.dataset.token || data.get('targetAccountId'),
        targetAccountId: data.get('targetAccountId'),
        requestedFields: String(data.get('requestedFields') || '').split(',').map((item) => item.trim()).filter(Boolean),
        reason: data.get('reason')
      })
    });
    state.modal = null;
    state.revealRequests = await api(`/api/reveal-requests?caseId=${encodeURIComponent(state.detail.id)}`);
    await refreshDashboard();
    showToast('Details request submitted for approval.');
  } catch (error) {
    setError(error);
    showToast(error.message, 'error');
  } finally {
    state.busy = false;
    render();
  }
}

async function submitIngestion(form) {
  if (!state.detail || state.busy) return;
  const data = new FormData(form);
  const caseId = state.detail.id;
  const batchReference = String(data.get('batchReference') || '').trim();
  const senderRef = String(data.get('senderRef') || '').trim();
  const receiverRef = String(data.get('receiverRef') || '').trim();
  const amount = Number(data.get('amount'));
  const sourceInstitutionCode = String(data.get('sourceInstitutionCode') || '').trim().toUpperCase();
  const observedAt = new Date().toISOString();
  const occurredAt = new Date(Date.now() - 60_000).toISOString();
  const transactionSourceRecordId = `${batchReference}-transaction`;
  const batch = {
    caseId,
    sourceInstitutionCode,
    batchReference,
    sourceSystem: 'investigator-console-adapter-v1',
    records: {
      accounts: [
        { sourceAccountRef: senderRef, accountType: 'SAVINGS', status: 'ACTIVE' },
        { sourceAccountRef: receiverRef, accountType: 'CURRENT', status: 'ACTIVE' }
      ],
      transactions: [{
        sourceRecordId: transactionSourceRecordId,
        sourceAccountRef: senderRef,
        receiverAccountRef: receiverRef,
        amount,
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
        transactionSourceRecordId,
        sourceRecordHash: `sha256:console-${batchReference}`,
        contentCommitment: `sha256:console-content-${batchReference}`,
        capturedAt: observedAt,
        integrityStatus: 'VERIFIED'
      }]
    }
  };
  state.busy = true;
  try {
    const result = await api('/api/ingestion/console', { method: 'POST', body: JSON.stringify(batch) });
    state.modal = null;
    await loadCase(caseId);
    showToast(result.status === 'DUPLICATE' ? 'This data was already added.' : 'Institution data added and activity saved.');
  } catch (error) {
    setError(error);
    showToast(error.message, 'error');
  } finally {
    state.busy = false;
    render();
  }
}

async function decideReveal(requestId, decision, approver = {}) {
  if (state.busy) return;
  state.busy = true;
  try {
    await api(`/api/reveal-requests/${encodeURIComponent(requestId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ decision, approverId: approver.id || '2', approverName: approver.name || 'Supervisor K. Rao', role: approver.role || 'SUPERVISOR', reason: decision === 'APPROVE' ? 'Approved for the documented recovery step.' : 'Rejected because the request requires a narrower purpose.' })
    });
    if (state.selectedCaseId) {
      state.revealRequests = await api(`/api/reveal-requests?caseId=${encodeURIComponent(state.selectedCaseId)}`);
      state.auditEvents = await api(`/api/audit?caseId=${encodeURIComponent(state.selectedCaseId)}`);
    }
    await refreshDashboard();
    showToast(decision === 'APPROVE' ? 'Approval saved.' : 'Details request rejected.', decision === 'APPROVE' ? 'success' : 'error');
  } catch (error) {
    setError(error);
    showToast(error.message, 'error');
  } finally {
    state.busy = false;
    render();
  }
}

async function verifyAudit() {
  if (!state.selectedCaseId) return;
  try {
    state.auditVerification = await api(`/api/audit/verify?caseId=${encodeURIComponent(state.selectedCaseId)}`);
    showToast(state.auditVerification.valid ? 'Activity history verified.' : 'Activity history needs review.', state.auditVerification.valid ? 'success' : 'error');
  } catch (error) {
    setError(error);
    showToast(error.message, 'error');
  }
  render();
}

async function updateCaseStatus(status) {
  if (!state.selectedCaseId || !status || state.busy) return;
  state.busy = true;
  try {
    await api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    showToast(`Case status changed to ${friendlyLabel(status).toLowerCase()}.`);
    await loadCase(state.selectedCaseId);
    await refreshDashboard();
  } catch (error) {
    setError(error);
    showToast(error.message, 'error');
  } finally {
    state.busy = false;
    render();
  }
}

async function submitNote(form) {
  if (!state.selectedCaseId || state.busy) return;
  const data = new FormData(form);
  const body = String(data.get('body') || '').trim();
  if (!body) return;
  state.busy = true;
  try {
    await api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}/notes`, { method: 'POST', body: JSON.stringify({ body }) });
    state.notes = await api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}/notes`);
    state.timeline = await api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}/timeline`);
    state.auditEvents = await api(`/api/audit?caseId=${encodeURIComponent(state.selectedCaseId)}`);
    showToast('Investigator note added to the case.');
  } catch (error) {
    setError(error);
    showToast(error.message, 'error');
  } finally {
    state.busy = false;
    render();
  }
}

async function submitLogin(form) {
  const data = new FormData(form);
  state.loginBusy = true;
  state.error = null;
  render();
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ loginName: data.get('loginName'), password: data.get('password') })
    });
    state.authenticated = true;
    state.session = { investigator: result.investigator };
    await bootWorkspace();
    showToast('Secure investigator session established.');
  } catch (error) {
    state.authenticated = false;
    setError(error);
    showToast(error.message, 'error');
  } finally {
    state.loginBusy = false;
    render();
  }
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  } catch (error) {
    setError(error);
  }
  state.authenticated = false;
  state.session = null;
  state.detail = null;
  state.cases = [];
  state.institutions = [];
  state.ingestionBatches = [];
  state.adapterDraft = null;
  state.error = null;
  render();
}

async function downloadReport() {
  if (!state.selectedCaseId || state.busy) return;
  try {
    const report = await api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}/report`);
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report.case?.reference || 'traceshield-case'}-report.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('Protected report downloaded.');
  } catch (error) {
    setError(error);
    showToast(error.message, 'error');
    render();
  }
}

async function handleClick(event) {
  const target = event.target.closest('[data-action], [data-case-id], [data-view]');
  if (!target) return;
  if (target.matches('[data-case-id]')) {
    await loadCase(target.dataset.caseId);
    return;
  }
  if (target.matches('[data-view]')) {
    state.view = target.dataset.view;
    const destination = { overview: '#overview', cases: '#case-workspace', reveals: '#reveal-queue', audit: '#audit-log' }[state.view] || '#overview';
    if (state.view === 'reveals') {
      const pending = state.revealRequests.find((item) => item.status === 'PENDING') || state.revealRequests[0];
      if (pending?.caseId && pending.caseId !== state.selectedCaseId) await loadCase(pending.caseId);
    }
    if (state.view === 'audit' && state.selectedCaseId) {
      state.auditVerification = null;
      try {
        state.auditEvents = await api(`/api/audit?caseId=${encodeURIComponent(state.selectedCaseId)}`);
      } catch (error) {
        setError(error);
      }
    }
    render();
    requestAnimationFrame(() => {
      if (state.view === 'audit') document.querySelector('#supporting-records')?.setAttribute('open', '');
      document.querySelector(destination)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return;
  }
  const action = target.dataset.action;
  if (action === 'new-case') {
    state.modal = { type: 'case' };
    render();
  } else if (action === 'close-modal') {
    if (target.classList.contains('modal-backdrop') && event.target !== target) return;
    state.modal = null;
    render();
  } else if (action === 'trace') {
    await traceSelectedCase();
  } else if (action === 'scroll-to-case') {
    document.querySelector('#case-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (action === 'request-reveal') {
    state.modal = { type: 'reveal' };
    render();
  } else if (action === 'submit-ingestion') {
    state.adapterDraft = createAdapterDraft();
    state.modal = { type: 'ingestion' };
    render();
  } else if (action === 'approve') {
    await decideReveal(target.dataset.requestId, 'APPROVE', { id: target.dataset.approverId, name: target.dataset.approverName, role: target.dataset.approverRole });
  } else if (action === 'reject') {
    await decideReveal(target.dataset.requestId, 'REJECT', { id: target.dataset.approverId, name: target.dataset.approverName, role: target.dataset.approverRole });
  } else if (action === 'verify-audit') {
    await verifyAudit();
  } else if (action === 'download-report') {
    await downloadReport();
  } else if (action === 'logout') {
    await logout();
  }
}

async function handleSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  if (form.dataset.form === 'create-case') await submitCase(form);
  if (form.dataset.form === 'create-reveal') await submitReveal(form);
  if (form.dataset.form === 'ingestion') await submitIngestion(form);
  if (form.dataset.form === 'add-note') await submitNote(form);
  if (form.dataset.form === 'login') await submitLogin(form);
}

function handleInput(event) {
  if (event.target.matches('[data-action="search-cases"]')) {
    state.query = event.target.value;
    scheduleCaseListUpdate(event.target.selectionStart ?? state.query.length);
  }
}

function handleChange(event) {
  if (event.target.matches('[data-case-filter]')) {
    state.caseFilters[event.target.dataset.caseFilter] = event.target.value;
    updateCaseList();
    return;
  }
  if (event.target.matches('[data-case-status]')) updateCaseStatus(event.target.value);
}

document.addEventListener('click', handleClick);
document.addEventListener('submit', handleSubmit);
document.addEventListener('input', handleInput);
document.addEventListener('change', handleChange);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.modal) {
    state.modal = null;
    render();
    return;
  }
  if (event.key === 'Tab' && state.modal) {
    const focusable = [...document.querySelectorAll('.modal button, .modal input, .modal select, .modal textarea')].filter((element) => !element.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

async function bootWorkspace() {
  const [session, dashboard, cases, reveals, institutions] = await Promise.all([
    api('/api/session'),
    api('/api/dashboard'),
    api('/api/cases'),
    api('/api/reveal-requests'),
    api('/api/institutions')
  ]);
  state.session = session;
  state.dashboard = dashboard;
  state.cases = cases;
  state.revealRequests = reveals;
  state.institutions = institutions;
  state.selectedCaseId = preferredCaseId(cases);
  if (state.selectedCaseId) {
    [state.detail, state.auditEvents, state.analysis, state.timeline, state.notes, state.ingestionBatches] = await Promise.all([
      api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}`),
      api(`/api/audit?caseId=${encodeURIComponent(state.selectedCaseId)}`),
      api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}/analysis`),
      api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}/timeline`),
      api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}/notes`),
      api(`/api/ingestion/batches?caseId=${encodeURIComponent(state.selectedCaseId)}`)
    ]);
  }
}

async function boot() {
  try {
    const health = await api('/api/health');
    state.health = health;
    state.authMode = health.authMode || 'env';
    if (state.authMode === 'session') {
      try {
        const authSession = await api('/api/auth/session');
        state.authenticated = authSession.authenticated === true;
      } catch (error) {
        if (error.status === 401) {
          state.authenticated = false;
          state.error = null;
          render();
          return;
        }
        throw error;
      }
    }
    state.authenticated = true;
    await bootWorkspace();
  } catch (error) {
    setError(error);
    state.health = { mode: 'offline', status: 'error' };
  }
  render();
}

boot();
