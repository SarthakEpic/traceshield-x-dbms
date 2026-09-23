const state = {
  health: { mode: 'mock', status: 'loading' },
  session: null,
  dashboard: null,
  cases: [],
  selectedCaseId: null,
  detail: null,
  analysis: null,
  timeline: [],
  notes: [],
  caseFilters: { status: '', severity: '', sort: 'opened' },
  revealRequests: [],
  auditEvents: [],
  auditVerification: null,
  query: '',
  view: 'overview',
  modal: null,
  busy: false,
  error: null
};

const app = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');

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

function badge(value) {
  const text = String(value || 'UNKNOWN');
  return `<span class="badge ${escapeHtml(statusClass(text))}">${escapeHtml(text.replaceAll('_', ' '))}</span>`;
}

function initials(name) {
  return String(name || 'TS').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'TS';
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
    throw new Error(message || `Request failed (${response.status})`);
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

function renderSidebar() {
  const pendingCount = Number(state.dashboard?.pendingReveals || state.revealRequests.filter((item) => item.status === 'PENDING').length || 0);
  const nav = [
    ['overview', 'O', 'Overview'],
    ['cases', 'C', 'Cases'],
    ['reveals', 'R', 'Reveal queue'],
    ['audit', 'A', 'Audit trail']
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
          <button class="nav-item ${state.view === view ? 'active' : ''}" data-view="${view}" type="button">
            <span class="nav-icon" aria-hidden="true">${icon}</span>
            <span>${label}</span>
            ${view === 'reveals' && pendingCount ? `<span class="nav-badge">${pendingCount}</span>` : ''}
          </button>`).join('')}
      </nav>
      <div class="sidebar-footer">
        <div class="operator">
          <div class="avatar">${escapeHtml(initials(state.session?.investigator?.displayName || 'PI'))}</div>
          <div>
            <div class="operator-name">${escapeHtml(state.session?.investigator?.displayName || 'Protected investigator')}</div>
            <div class="operator-role">${escapeHtml(state.session?.investigator?.role || 'Investigator')}</div>
          </div>
        </div>
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

function renderMetrics() {
  const dashboard = state.dashboard || {};
  return `<section class="metrics" aria-label="Investigation metrics">
    ${renderMetric('Open cases', dashboard.openCases ?? '—', `${dashboard.institutions ?? 0} connected institutions`, 'OPEN')}
    ${renderMetric('Critical paths', dashboard.criticalPaths ?? '—', 'Risk score at or above 80%', 'RISK')}
    ${renderMetric('Reveal approvals', dashboard.pendingReveals ?? '—', 'Waiting for dual control', 'DUAL')}
    ${renderMetric('Audit health', dashboard.auditHealth || '—', `Last ingest ${dashboard.lastIngest || '—'}`, 'HASH')}
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
        <div><h2 class="panel-title">Investigation cases</h2><p class="panel-caption">Protected case-scoped views</p></div>
        <span class="badge open">${state.cases.length}</span>
      </div>
      <div class="search-wrap">
        <span class="search-symbol" aria-hidden="true">/</span>
        <label class="sr-only" for="case-search">Search cases</label>
        <input id="case-search" class="search-input" type="search" placeholder="Search reference or description" value="${escapeHtml(state.query)}" data-action="search-cases" />
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
            <div class="case-item-bottom"><span>${escapeHtml(item.status)} · ${escapeHtml(item.assignedTo || 'Unassigned')}</span><span>${percent(item.riskScore)}</span></div>
          </button>`).join('') : `<div class="empty"><strong>No matching cases</strong>Try a different case reference or keyword.</div>`}
      </div>
    </section>`;
}

function renderPath(path) {
  const hops = path.hops || [];
  if (!hops.length) return `<div class="empty"><strong>No path hops yet</strong>Run the trace after transactions are in the case scope.</div>`;
  return `
    <div class="path-banner">
      <div class="path-mark">OK</div>
      <div><strong>Minimum-disclosure trace certificate generated</strong><span>${escapeHtml(path.hopCount || hops.length)} hop(s) · ${(path.certificateHash || 'certificate pending')}</span></div>
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
            <div class="hop-reason">${escapeHtml(hop.reason || `Transaction ${shortId(hop.transactionId)} is linked by temporal and account continuity.`)}</div>
          </div>
          <div class="hop-risk"><div class="risk-number">${percent(risk)}</div><div class="risk-label">hop risk</div><div class="risk-bar"><span style="width:${Math.max(0, Math.min(100, risk * 100))}%"></span></div></div>
        </div>`;
      }).join('')}
    </div>`;
}

function renderPaths(detail) {
  if (!detail?.paths?.length) return `<div class="empty"><strong>No generated path</strong>Use “Run trace” to create a reviewable fund-flow path.</div>`;
  return detail.paths.map(renderPath).join('<div style="height:12px"></div>');
}

function renderSignals(detail) {
  const signals = detail?.signals || [];
  if (!signals.length) return `<div class="empty"><strong>No risk signals</strong>Signals will appear after source data is scored.</div>`;
  return signals.map((signal) => `
    <article class="signal">
      <div class="signal-top"><span class="signal-label">${escapeHtml(signal.label || signal.type || 'Signal')}</span><span class="signal-score">${percent(signal.score)}</span></div>
      <div class="signal-text">${escapeHtml(signal.explanation || 'No explanation supplied.')}</div>
    </article>`).join('');
}

function renderTransactions(detail) {
  const transactions = detail?.transactions || [];
  if (!transactions.length) return `<div class="empty"><strong>No transactions in scope</strong>Person 1’s ingestion module will add source transactions here.</div>`;
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
  if (!items.length) return `<div class="empty"><strong>No reveal requests</strong>Request the smallest necessary field set when a protected identity needs source confirmation.</div>`;
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
      <div class="reveal-top"><span class="reveal-target">${escapeHtml(request.target || shortId(request.targetAccountId))}</span>${badge(request.status)}</div>
      <div class="reveal-reason">${escapeHtml(request.reason)}</div>
      <div class="muted">Fields: ${escapeHtml((request.requestedFields || []).join(', '))}</div>
      <div class="approval-row"><span>${approvedCount}/${request.requiredApprovals || 2} approvals · expires ${formatDate(request.expiresAt)}</span>${pending ? `<span class="approval-actions">${supervisorApproved ? '' : `<button class="button small" type="button" data-action="approve" data-approver-id="${escapeHtml(supervisor.id)}" data-approver-name="${escapeHtml(supervisor.displayName)}" data-approver-role="${escapeHtml(supervisor.role)}" data-request-id="${escapeHtml(request.id)}">${escapeHtml(supervisor.displayName)}</button>`}${auditorApproved ? '' : `<button class="button small" type="button" data-action="approve" data-approver-id="${escapeHtml(auditor.id)}" data-approver-name="${escapeHtml(auditor.displayName)}" data-approver-role="${escapeHtml(auditor.role)}" data-request-id="${escapeHtml(request.id)}">${escapeHtml(auditor.displayName)}</button>`}<button class="button small danger" type="button" data-action="reject" data-approver-id="${escapeHtml(supervisor.id)}" data-approver-name="${escapeHtml(supervisor.displayName)}" data-approver-role="${escapeHtml(supervisor.role)}" data-request-id="${escapeHtml(request.id)}">Reject</button></span>` : ''}</div>
      ${approvals.length ? `<div class="muted">${approvals.map((item) => `${escapeHtml(item.approverName || item.approverId)}: ${escapeHtml(item.decision)}`).join(' · ')}</div>` : ''}
    </article>`;
  }).join('');
}

function renderEvidence(detail) {
  const evidence = detail?.evidence || [];
  if (!evidence.length) return `<div class="empty"><strong>No evidence records</strong>Evidence commitments will appear with source assertions and path certificates.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Evidence</th><th>Source</th><th>Status</th><th>Commitment</th></tr></thead>
    <tbody>${evidence.map((item) => `<tr><td><strong>${escapeHtml(item.title || item.type)}</strong><br><span class="muted">${formatDate(item.capturedAt)}</span></td><td>${escapeHtml(item.source || 'TraceShield X')}</td><td>${badge(item.status || 'UNVERIFIED')}</td><td class="mono">${escapeHtml(shortId(item.commitment || item.contentCommitment))}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function renderComplaints(detail) {
  const complaints = detail?.complaints || [];
  if (!complaints.length) return `<div class="empty"><strong>No complaints in scope</strong>Customer or authority reports will be linked to the case without exposing raw identity.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Reference</th><th>Source</th><th>Channel</th><th>Status</th></tr></thead>
    <tbody>${complaints.map((item) => `<tr><td><strong class="mono">${escapeHtml(item.reference || shortId(item.id))}</strong><br><span class="muted">${formatDate(item.reportedAt)}</span></td><td>${escapeHtml(item.source || 'Protected institution')}</td><td>${escapeHtml(item.channel || '—')}</td><td>${badge(item.status || 'OPEN')}<br><span class="muted">${escapeHtml(item.summary || '')}</span></td></tr>`).join('')}</tbody>
  </table></div>`;
}

function renderAudit(detail) {
  const events = state.auditEvents || [];
  const verification = state.auditVerification;
  if (!events.length) return `<div class="empty"><strong>No audit events loaded</strong>Auditable actions will appear here.</div>`;
  return `<div class="audit-list">${events.slice().reverse().map((event) => `<article class="audit-event"><div class="audit-dot"></div><div><div class="audit-title">${escapeHtml(String(event.type || '').replaceAll('_', ' '))}</div><div class="audit-meta">${escapeHtml(event.actor || 'System')} · ${formatDate(event.occurredAt)}</div><div class="audit-hash">${escapeHtml(shortId(event.hash, 28))}</div></div></article>`).join('')}</div>
    ${verification ? `<div class="verified-line">${verification.valid ? 'OK' : 'REVIEW'} ${escapeHtml(verification.message || (verification.valid ? 'Audit chain verified.' : 'Audit chain requires review.'))}</div>` : ''}`;
}

function renderAnalysis(detail) {
  const analysis = state.analysis || detail?.analysis;
  if (!analysis) return `<div class="empty"><strong>Analysis is loading</strong>The decision brief will appear after the protected case is loaded.</div>`;
  const summary = analysis.summary || {};
  const decision = analysis.decision || {};
  const path = analysis.paths?.[0];
  const graphNodes = analysis.graph?.nodes || [];
  return `<section class="section-card analysis-card"><div class="section-card-header"><div><h3 class="section-card-title">Decision brief</h3><div class="section-card-caption">Explainable findings before the next action</div></div>${badge(decision.status || 'CONTEXT_REVIEW')}</div><div class="section-card-body">
    <div class="decision-banner"><div><strong>${escapeHtml(decision.title || 'Context review recommended')}</strong><p>${escapeHtml(decision.rationale || 'Review the protected case context before taking action.')}</p></div><span class="decision-score">${percent(summary.riskScore || 0)}</span></div>
    <div class="analysis-stats"><div><span>Signals</span><strong>${escapeHtml(summary.signalCount ?? 0)}</strong></div><div><span>High-risk hops</span><strong>${escapeHtml(path?.highRiskHops?.length ?? 0)}</strong></div><div><span>Institutions</span><strong>${escapeHtml(summary.institutionCount ?? 0)}</strong></div><div><span>Evidence conflicts</span><strong>${escapeHtml(summary.conflictingEvidence ?? 0)}</strong></div></div>
    <div class="analysis-columns"><div><div class="analysis-subtitle">Next defensible actions</div><ul class="next-actions">${(decision.nextActions || []).map((action) => `<li>${escapeHtml(action)}</li>`).join('')}</ul></div><div><div class="analysis-subtitle">Protected graph</div><div class="graph-lane">${graphNodes.length ? graphNodes.map((node, index) => `<div class="graph-node"><span class="graph-node-dot ${statusClass(node.status)}"></span><strong>${escapeHtml(node.token)}</strong><small>${escapeHtml(node.institution)}</small>${index < graphNodes.length - 1 ? '<span class="graph-link" aria-hidden="true">to</span>' : ''}</div>`).join('') : '<span class="muted">Run a trace to build the graph.</span>'}</div></div></div>
    <div class="analysis-footer"><span>Privacy decision: ${escapeHtml((analysis.privacy?.minimumFields || ['account holder name']).join(', '))}</span><span>${escapeHtml(path?.institutionCount ?? 0)} institution transition(s)</span></div>
  </div></section>`;
}

function renderTimeline() {
  if (!state.timeline.length) return `<div class="empty"><strong>No timeline events</strong>Timeline entries will appear as the case accumulates transactions, evidence, and decisions.</div>`;
  return `<div class="timeline-list">${state.timeline.slice().reverse().slice(0, 8).map((item) => `<article class="timeline-item"><div class="timeline-marker"></div><div><div class="timeline-title">${escapeHtml(item.title)}</div><div class="timeline-meta">${escapeHtml(item.actor || 'System')} · ${formatDate(item.occurredAt)}</div><div class="timeline-detail">${escapeHtml(item.detail || '')}</div></div></article>`).join('')}</div>`;
}

function renderNotes(detail) {
  const notes = state.notes || detail?.notes || [];
  return `<div class="notes-wrap"><div class="notes-list">${notes.length ? notes.map((note) => `<article class="note"><div class="note-top"><strong>${escapeHtml(note.authorName || 'Protected investigator')}</strong><span>${formatDate(note.createdAt)}</span></div><p>${escapeHtml(note.body)}</p></article>`).join('') : '<div class="empty compact"><strong>No investigator notes</strong>Add the reasoning behind the next decision.</div>'}</div><form class="note-form" data-form="add-note"><label class="sr-only" for="case-note">Add investigator note</label><textarea id="case-note" name="body" maxlength="4000" required placeholder="Record the reasoning behind the next action..."></textarea><button class="button small" type="submit">Save note</button></form></div>`;
}

function renderDetail() {
  const detail = state.detail;
  if (!detail) return `<section class="panel detail"><div class="empty"><strong>Select a case</strong>Choose a case to inspect its protected transaction path.</div></section>`;
  const caseRevealRequests = state.revealRequests.filter((item) => item.caseId === detail.id);
  const institutions = detail.institutions || [...new Set((detail.transactions || []).flatMap((item) => [item.from?.institution, item.to?.institution]).filter(Boolean))];
  return `<section class="panel detail">
    <div class="detail-head">
      <div>
        <div class="detail-ref"><span>${escapeHtml(detail.caseReference)}</span>${badge(detail.severity)}${badge(detail.status)}</div>
        <h2 class="detail-title">${escapeHtml(detail.description)}</h2>
        <p class="detail-subtitle">${escapeHtml(detail.purpose || 'FRAUD_INVESTIGATION')} · Assigned to ${escapeHtml(detail.assignedTo || 'Lead investigator')} · ${institutions.length ? escapeHtml(institutions.join(' · ')) : 'No institutions linked yet'}</p>
      </div>
      <div class="detail-actions"><select class="case-status-select" data-case-status aria-label="Case status">${['OPEN', 'REOPENED', 'PAUSED', 'CLOSED', 'REVOKED'].map((status) => `<option value="${status}" ${detail.status === status ? 'selected' : ''}>${status.replaceAll('_', ' ')}</option>`).join('')}</select><button class="button" type="button" data-action="request-reveal">Request reveal</button><button class="button" type="button" data-action="download-report">Export report</button><button class="button primary" type="button" data-action="trace">${state.busy ? 'Tracing' : 'Run trace'}</button></div>
    </div>
    <div class="detail-metrics">
      <div class="mini-stat"><div class="mini-label">Risk score</div><div class="mini-value">${percent(detail.riskScore)}</div></div>
      <div class="mini-stat"><div class="mini-label">Transactions</div><div class="mini-value">${escapeHtml(detail.transactionCount ?? detail.transactions?.length ?? 0)}</div></div>
      <div class="mini-stat"><div class="mini-label">Generated paths</div><div class="mini-value">${escapeHtml(detail.pathCount ?? detail.paths?.length ?? 0)}</div></div>
      <div class="mini-stat"><div class="mini-label">Evidence records</div><div class="mini-value">${escapeHtml(detail.evidenceCount ?? detail.evidence?.length ?? 0)}</div></div>
    </div>
    <div class="detail-grid">
      <div class="stack">
        ${renderAnalysis(detail)}
        <section class="section-card"><div class="section-card-header"><div><h3 class="section-card-title">Fund-flow investigation</h3><div class="section-card-caption">Temporal continuity and protected account joins</div></div><span class="section-card-caption">${detail.paths?.length || 0} path(s)</span></div><div class="section-card-body">${renderPaths(detail)}</div></section>
        <section class="section-card"><div class="section-card-header"><div><h3 class="section-card-title">Risk signals</h3><div class="section-card-caption">Explainable signals supporting investigator review</div></div></div><div class="section-card-body"><div class="signal-grid">${renderSignals(detail)}</div></div></section>
        <section class="section-card"><div class="section-card-header"><div><h3 class="section-card-title">Transactions in scope</h3><div class="section-card-caption">Raw identity fields remain masked</div></div></div><div class="section-card-body">${renderTransactions(detail)}</div></section>
      </div>
      <div class="stack">
        <section class="section-card reveal-card"><div class="section-card-header"><div><h3 class="section-card-title">Controlled reveal queue</h3><div class="section-card-caption">Dual approval before source disclosure</div></div><button class="button small" type="button" data-action="request-reveal">Request</button></div><div class="section-card-body">${renderRevealRequests(caseRevealRequests, detail)}</div></section>
        <section class="section-card"><div class="section-card-header"><div><h3 class="section-card-title">Investigator notes</h3><div class="section-card-caption">Reasoning that stays inside the case boundary</div></div></div><div class="section-card-body">${renderNotes(detail)}</div></section>
        <section class="section-card"><div class="section-card-header"><div><h3 class="section-card-title">Case timeline</h3><div class="section-card-caption">Events ordered by observed time</div></div></div><div class="section-card-body">${renderTimeline()}</div></section>
        <section class="section-card"><div class="section-card-header"><div><h3 class="section-card-title">Complaint register</h3><div class="section-card-caption">Purpose-limited reports linked to this case</div></div></div><div class="section-card-body">${renderComplaints(detail)}</div></section>
        <section class="section-card"><div class="section-card-header"><div><h3 class="section-card-title">Evidence register</h3><div class="section-card-caption">Hash commitments and provenance</div></div></div><div class="section-card-body">${renderEvidence(detail)}</div></section>
        <section class="section-card"><div class="section-card-header"><div><h3 class="section-card-title">Audit chain</h3><div class="section-card-caption">Append-only case activity</div></div><button class="button small" type="button" data-action="verify-audit">Verify</button></div><div class="section-card-body">${renderAudit(detail)}</div></section>
      </div>
    </div>
  </section>`;
}

function renderModal() {
  if (!state.modal) return '';
  if (state.modal.type === 'case') {
    return `<div class="modal-backdrop" data-action="close-modal"><form class="modal" data-form="create-case" method="post">
      <div class="modal-header"><div><h2 class="modal-title">Create investigation case</h2><p class="panel-caption">Start with purpose limitation and an expiry window.</p></div><button class="button ghost" type="button" data-action="close-modal" aria-label="Close">x</button></div>
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
    const options = accounts.length ? accounts.map((account, index) => `<option value="${escapeHtml(account.id)}" data-token="${escapeHtml(account.token)}" ${index === 0 ? 'selected' : ''}>${escapeHtml(account.token)} · ${escapeHtml(account.institution)}</option>`).join('') : '<option value="unknown">No account token available</option>';
    const minimumFields = state.analysis?.privacy?.minimumFields || ['account holder name'];
    return `<div class="modal-backdrop" data-action="close-modal"><form class="modal" data-form="create-reveal" method="post">
      <div class="modal-header"><div><h2 class="modal-title">Request protected reveal</h2><p class="panel-caption">Use the minimum field set needed for the next investigation action.</p></div><button class="button ghost" type="button" data-action="close-modal" aria-label="Close">x</button></div>
      <div class="modal-body">
        <div class="planner-note"><strong>Recommended minimum: ${escapeHtml(minimumFields.join(', '))}</strong><span>${escapeHtml(state.analysis?.privacy?.rationale || 'Identity fields remain masked until necessity is documented.')}</span></div>
        <div class="field"><label for="reveal-target">Protected account target</label><select id="reveal-target" name="targetAccountId">${options}</select></div>
        <div class="field"><label for="reveal-fields">Requested fields</label><input id="reveal-fields" name="requestedFields" value="${escapeHtml(minimumFields.join(', '))}" /></div>
        <div class="field"><label for="reveal-reason">Reason and next action</label><textarea id="reveal-reason" name="reason" required placeholder="Explain why the identity is necessary and what action follows."></textarea></div>
      </div>
      <div class="modal-footer"><button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit">Submit for approval</button></div>
    </form></div>`;
  }
  return '';
}

function renderHero() {
  const mode = state.health.mode === 'postgres' ? 'PostgreSQL link live' : 'Synthetic repository online';
  return `<section class="hero" aria-labelledby="hero-title">
    <div class="hero-copy" data-hero-copy>
      <div class="hero-kicker"><span class="hero-kicker-line"></span>Privacy-preserving investigations</div>
      <h1 id="hero-title">Trace the <span class="inline-visual" aria-hidden="true"><i></i><i></i><i></i></span> signal.<br><em>Keep the person private.</em></h1>
      <p class="hero-description">A focused workspace for following suspicious value across institutions, testing explainable signals, and requesting only the identity fields that the next action truly needs.</p>
      <div class="hero-actions"><button class="button primary hero-button" type="button" data-action="trace">${state.busy ? 'Tracing' : 'Run selected trace'}</button><button class="button hero-button-secondary" type="button" data-action="new-case">Open a new case</button></div>
      <div class="hero-note"><span class="live-dot"></span><span>${escapeHtml(mode)}</span><span class="hero-note-divider"></span><span>Identity fields masked by default</span></div>
    </div>
    <div class="hero-visual" data-scroll-image role="img" aria-label="Abstract protected transaction path visualization">
      <div class="visual-noise"></div>
      <div class="visual-header"><span>Identity layer / closed</span><span class="visual-code">TSX / protected</span></div>
      <div class="visual-field">
        <div class="visual-axis axis-one"></div><div class="visual-axis axis-two"></div><div class="visual-axis axis-three"></div>
        <div class="visual-route route-one"></div><div class="visual-route route-two"></div><div class="visual-route route-three"></div>
        <div class="trace-node node-one"><span class="node-point"></span><span>source token</span></div>
        <div class="trace-node node-two"><span class="node-point"></span><span>linked hop</span></div>
        <div class="trace-node node-three"><span class="node-point"></span><span>destination token</span></div>
        <div class="trace-core"><span>TRACE</span><strong>masked</strong></div>
      </div>
      <div class="visual-footer"><span>Token continuity</span><span>Purpose limit</span><span>Audit ready</span></div>
    </div>
  </section>`;
}

function renderInterest() {
  const dashboard = state.dashboard || {};
  const cases = state.cases.slice(0, 3);
  const caseRows = cases.length ? cases.map((item) => `<button class="accordion-item ${item.id === state.selectedCaseId ? 'active' : ''}" type="button" data-case-id="${escapeHtml(item.id)}"><span class="accordion-status ${statusClass(item.severity)}"></span><span class="accordion-main"><strong>${escapeHtml(item.caseReference)}</strong><span>${escapeHtml(item.description)}</span></span><span class="accordion-action">open</span></button>`).join('') : `<div class="bento-empty">Cases will appear when the investigation repository is connected.</div>`;
  return `<section class="interest" id="interest" aria-labelledby="interest-title">
    <div class="section-heading" data-reveal><div><div class="section-kicker">A sharper way to see the case</div><h2 id="interest-title">Evidence that moves at investigation speed.</h2></div><p>Every surface is built around one question: what can the investigator prove next without widening the identity boundary?</p></div>
    <div class="bento-grid">
      <article class="bento-card bento-card--wide" data-reveal data-hover-lift>
        <div class="bento-card-top"><div><div class="bento-label">Case pulse</div><h3>Choose the thread that matters now.</h3></div><span class="bento-index">01</span></div>
        <div class="horizontal-accordion">${caseRows}</div>
        <div class="bento-card-foot"><span>Protected case-scoped views</span><span>${escapeHtml(dashboard.openCases ?? state.cases.length)} open</span></div>
      </article>
      <article class="bento-card bento-card--side" data-reveal data-hover-lift>
        <div class="bento-label">Path view</div><h3>Follow value, not identity.</h3><p>Temporal continuity and account-token joins turn scattered transactions into a reviewable path.</p>
        <div class="mini-route-art" aria-hidden="true"><span></span><i></i><span></span><i></i><span></span></div>
        <div class="bento-card-foot"><span>Generated paths</span><strong>${escapeHtml(state.detail?.pathCount ?? state.detail?.paths?.length ?? 0)}</strong></div>
      </article>
      <article class="bento-card bento-card--small" data-reveal data-hover-lift>
        <div class="bento-label">Reveal gate</div><h3>Minimum disclosure.</h3><p>Two approvals before a protected field can cross the boundary.</p><div class="bento-accent accent-amber">${escapeHtml(dashboard.pendingReveals ?? 0)} pending</div>
      </article>
      <article class="bento-card bento-card--small" data-reveal data-hover-lift>
        <div class="bento-label">Audit memory</div><h3>Every action leaves a receipt.</h3><p>Hash-linked events make the investigative story verifiable after the case closes.</p><div class="hash-stripe" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
      </article>
      <article class="bento-card bento-card--small bento-card--marquee" data-reveal data-hover-lift>
        <div class="bento-label">Across the network</div><h3>One protected view.</h3><p>Institutions coordinate without exchanging raw identity fields.</p><div class="marquee-window" aria-label="Privacy principles"><div class="marquee-track"><span>masked identity</span><span>purpose limit</span><span>dual control</span><span>masked identity</span><span>purpose limit</span><span>dual control</span></div></div>
      </article>
    </div>
  </section>`;
}

function renderDesire() {
  const detail = state.detail || {};
  const words = ['Investigate', 'the', 'movement.', 'Defend', 'the', 'decision.'];
  const cards = [
    ['Signal layer', 'Explainable risk signals turn suspicion into a question that can be checked.'],
    ['Path layer', 'Protected tokens preserve continuity while source identities stay sealed.'],
    ['Decision layer', 'Approvals, evidence, and audit receipts keep the next action accountable.']
  ];
  return `<section class="desire" id="desire" aria-labelledby="desire-title">
    <div class="desire-copy" data-reveal><div class="section-kicker">A decision layer with receipts</div><h2 id="desire-title" class="desire-title">${words.map((word) => `<span>${escapeHtml(word)}</span>`).join(' ')}</h2><p>TraceShield X keeps the investigator moving through a controlled sequence: see the signal, inspect the path, justify the reveal, and preserve the proof.</p><button class="button primary" type="button" data-action="scroll-to-case">Review current case</button></div>
    <div class="stack-stage" aria-label="Investigation layers">
      ${cards.map(([title, body], index) => `<article class="stack-card stack-card-${index + 1}" data-stack-card><div class="stack-card-line"></div><div class="bento-label">${escapeHtml(title)}</div><h3>${escapeHtml(body)}</h3><div class="stack-card-meta"><span>${index === 0 ? `${escapeHtml(detail.signalCount ?? detail.signals?.length ?? 0)} signals in scope` : index === 1 ? `${escapeHtml(detail.pathCount ?? detail.paths?.length ?? 0)} generated path(s)` : 'Append-only record'}</span><span>TraceShield X</span></div></article>`).join('')}
    </div>
  </section>`;
}

function renderFooter() {
  return `<footer class="footer-cta" data-reveal><div><div class="section-kicker">TraceShield X</div><h2>Make the next action defensible.</h2></div><div class="footer-action"><p>Start with a protected case. Keep the evidence. Reveal only what the purpose requires.</p><button class="button primary" type="button" data-action="new-case">Start a protected case</button></div><div class="footer-bottom"><span>Privacy by design</span><span>Purpose limitation</span><span>Audit continuity</span></div></footer>`;
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
  if (stage && stackCards.length) {
    stackCards.forEach((card, index) => gsap.fromTo(card, { y: 120 + index * 28, rotate: (index - 1) * 2.5, autoAlpha: 0.34 }, { y: index * 8, rotate: 0, autoAlpha: 1, ease: 'none', scrollTrigger: { trigger: stage, start: `top+=${index * 80} 78%`, end: `top+=${index * 80 + 360} 34%`, scrub: true } }));
  }

  document.querySelectorAll('[data-hover-lift]').forEach((card) => {
    card.addEventListener('pointermove', () => card.classList.add('is-hovered'));
    card.addEventListener('pointerleave', () => card.classList.remove('is-hovered'));
  });
  requestAnimationFrame(() => ScrollTrigger.refresh());
}

function render() {
  app.innerHTML = `${renderSidebar()}<main class="main">
    <header class="topbar"><div><div class="eyebrow">Investigator workspace</div><p>Follow the evidence. Protect the person.</p></div><div class="topbar-actions"><div class="mode-pill"><span class="mode-dot"></span>${escapeHtml(state.health.mode === 'postgres' ? 'PostgreSQL connected' : 'Demo repository')}</div><button class="button topbar-new-case" type="button" data-action="new-case">New case</button></div></header>
    ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
    ${renderHero()}
    ${renderMetrics()}
    ${renderInterest()}
    ${renderDesire()}
    <section class="workspace-anchor" id="case-workspace" aria-labelledby="workspace-title"><div class="workspace-heading" data-reveal><div><div class="section-kicker">The working surface</div><h2 id="workspace-title">Investigate without exposing the subject.</h2></div><span class="workspace-status">Protected case scope</span></div><div class="workspace">${renderCaseList()}${renderDetail()}</div></section>
    ${renderFooter()}
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
    const [detail, revealRequests, auditEvents, analysis, timeline, notes] = await Promise.all([
      api(`/api/cases/${encodeURIComponent(caseId)}`),
      api(`/api/reveal-requests?caseId=${encodeURIComponent(caseId)}`),
      api(`/api/audit?caseId=${encodeURIComponent(caseId)}`),
      api(`/api/cases/${encodeURIComponent(caseId)}/analysis`),
      api(`/api/cases/${encodeURIComponent(caseId)}/timeline`),
      api(`/api/cases/${encodeURIComponent(caseId)}/notes`)
    ]);
    state.detail = detail;
    state.analysis = analysis;
    state.timeline = timeline;
    state.notes = notes;
    state.revealRequests = revealRequests;
    state.auditEvents = auditEvents;
  } catch (error) {
    setError(error);
    showToast(error.message, 'error');
  }
  render();
}

async function refreshDashboard() {
  state.dashboard = await api('/api/dashboard');
  state.cases = await api('/api/cases');
  if (!state.selectedCaseId && state.cases[0]) state.selectedCaseId = state.cases[0].id;
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
    showToast('Trace generated and added to the audit chain.');
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
    showToast(`Reveal request ${shortId(request.id)} submitted for dual approval.`);
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
    showToast(decision === 'APPROVE' ? 'Approval recorded.' : 'Reveal request rejected.', decision === 'APPROVE' ? 'success' : 'error');
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
    showToast(state.auditVerification.valid ? 'Audit chain verified.' : 'Audit chain requires review.', state.auditVerification.valid ? 'success' : 'error');
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
    showToast(`Case status changed to ${status.toLowerCase().replaceAll('_', ' ')}.`);
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
    showToast('Privacy-safe investigation report exported.');
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
  } else if (action === 'approve') {
    await decideReveal(target.dataset.requestId, 'APPROVE', { id: target.dataset.approverId, name: target.dataset.approverName, role: target.dataset.approverRole });
  } else if (action === 'reject') {
    await decideReveal(target.dataset.requestId, 'REJECT', { id: target.dataset.approverId, name: target.dataset.approverName, role: target.dataset.approverRole });
  } else if (action === 'verify-audit') {
    await verifyAudit();
  } else if (action === 'download-report') {
    await downloadReport();
  }
}

async function handleSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  if (form.dataset.form === 'create-case') await submitCase(form);
  if (form.dataset.form === 'create-reveal') await submitReveal(form);
  if (form.dataset.form === 'add-note') await submitNote(form);
}

function handleInput(event) {
  if (event.target.matches('[data-action="search-cases"]')) {
    state.query = event.target.value;
    const selectionStart = event.target.selectionStart;
    render();
    const input = document.querySelector('#case-search');
    input?.focus();
    input?.setSelectionRange(selectionStart, selectionStart);
  }
}

function handleChange(event) {
  if (event.target.matches('[data-case-filter]')) {
    state.caseFilters[event.target.dataset.caseFilter] = event.target.value;
    render();
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

async function boot() {
  try {
    const [health, session, dashboard, cases, reveals] = await Promise.all([
      api('/api/health'),
      api('/api/session'),
      api('/api/dashboard'),
      api('/api/cases'),
      api('/api/reveal-requests')
    ]);
    state.health = health;
    state.session = session;
    state.dashboard = dashboard;
    state.cases = cases;
    state.revealRequests = reveals;
    state.selectedCaseId = cases[0]?.id || null;
    if (state.selectedCaseId) {
      [state.detail, state.auditEvents, state.analysis, state.timeline, state.notes] = await Promise.all([
        api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}`),
        api(`/api/audit?caseId=${encodeURIComponent(state.selectedCaseId)}`),
        api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}/analysis`),
        api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}/timeline`),
        api(`/api/cases/${encodeURIComponent(state.selectedCaseId)}/notes`)
      ]);
    }
  } catch (error) {
    setError(error);
    state.health = { mode: 'offline', status: 'error' };
  }
  render();
}

boot();
