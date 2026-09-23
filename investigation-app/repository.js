import crypto from 'node:crypto';
import { mockData } from './mock-data.js';

let pgModule = null;
try {
  pgModule = await import('pg');
} catch {
  // The mock repository remains usable without npm dependencies.
}

const nowIso = () => new Date().toISOString();

function shortToken(value) {
  const text = String(value || 'unknown');
  return text.length <= 14 ? text : `${text.slice(0, 6)}...${text.slice(-5)}`;
}

function accountById(id) {
  return mockData.accounts.find((account) => account.id === id) ?? {
    id,
    token: 'acct_unknown',
    institution: 'Unknown institution',
    institutionCode: 'UNK',
    accountType: 'UNKNOWN',
    status: 'UNKNOWN',
    role: 'Unknown account'
  };
}

function transactionById(id) {
  return mockData.transactions.find((transaction) => transaction.id === id);
}

function investigatorById(id) {
  return mockData.investigators.find((investigator) => String(investigator.id) === String(id)) || null;
}

function makePath() {
  return {
    id: mockData.ids.pathOne,
    status: 'GENERATED',
    hopCount: mockData.pathHops.length,
    riskScore: 0.94,
    certificateHash: 'sha256:7c31...0a8d',
    generatedAt: '2026-09-20T09:18:00Z',
    hops: mockData.pathHops.map((hop) => ({
      ...hop,
      from: accountById(hop.fromAccountId),
      to: accountById(hop.toAccountId),
      transaction: transactionById(hop.transactionId)
    }))
  };
}

function makeDetail(caseId) {
  const summary = mockData.cases.find((item) => item.id === caseId);
  if (!summary) return null;

  const caseTransactions = caseId === mockData.ids.caseOne
    ? mockData.transactions
    : mockData.transactions.slice(0, 1);

  return {
    ...summary,
    transactions: caseTransactions.map((transaction) => ({
      ...transaction,
      from: accountById(transaction.fromAccountId),
      to: accountById(transaction.toAccountId)
    })),
    paths: caseId === mockData.ids.caseOne ? [makePath()] : [],
    signals: caseId === mockData.ids.caseOne ? mockData.signals : mockData.signals.slice(2),
    evidence: caseId === mockData.ids.caseOne ? mockData.evidence : mockData.evidence.slice(0, 2),
    complaints: caseId === mockData.ids.caseOne ? mockData.complaints : [],
    notes: mockData.notes.filter((item) => item.caseId === caseId),
    revealRequests: mockData.revealRequests.filter((item) => item.caseId === caseId)
  };
}

function appendMockAudit(caseId, type, actor, target) {
  const previous = mockData.auditEvents.filter((item) => item.caseId === caseId).at(-1);
  const eventId = Math.max(...mockData.auditEvents.map((item) => item.id), 0) + 1;
  const occurredAt = nowIso();
  const hash = mockData.makeHash(`${previous?.hash ?? ''}|${caseId}|${type}|${target}|${occurredAt}`);
  mockData.auditEvents.push({
    id: eventId,
    caseId,
    type,
    actor,
    target,
    occurredAt,
    hash,
    previousHash: previous?.hash ?? null
  });
}

function verifyMockAuditChain(caseId) {
  const events = mockData.auditEvents.filter((item) => item.caseId === caseId);
  let previousHash = null;
  for (const event of events) {
    if ((event.previousHash || null) !== previousHash) return false;
    previousHash = event.hash;
  }
  return true;
}

class MockRepository {
  mode = 'mock';

  async health() {
    return { mode: this.mode, database: 'synthetic repository', status: 'ok', serviceVersion: '1.1.0', capabilities: ['trace', 'minimum-disclosure', 'dual-control', 'audit-verification', 'case-notes'] };
  }

  async session() {
    const current = investigatorById('1');
    return {
      investigator: structuredClone(current),
      approvers: structuredClone(mockData.investigators.filter((item) => ['SUPERVISOR', 'AUDITOR', 'ADMIN'].includes(item.role))),
      capabilities: { canTrace: true, canRequestReveal: true, canApproveReveal: false, canManageCase: true, canExportReport: true }
    };
  }

  async getApprover(id) {
    const approver = investigatorById(id);
    if (!approver || !['SUPERVISOR', 'AUDITOR', 'ADMIN'].includes(approver.role) || approver.status !== 'ACTIVE') return null;
    return structuredClone(approver);
  }

  async dashboard() {
    const openCases = mockData.cases.filter((item) => item.status === 'OPEN').length;
    const criticalPaths = mockData.cases.filter((item) => item.riskScore >= 0.8).length;
    const pendingReveals = mockData.revealRequests.filter((item) => item.status === 'PENDING').length;
    return {
      openCases,
      criticalPaths,
      pendingReveals,
      auditHealth: 'VERIFIED',
      institutions: mockData.institutions.length,
      lastIngest: '12 minutes ago',
      conflictingEvidence: mockData.evidence.filter((item) => item.status === 'CONFLICTING').length,
      overdueCases: mockData.cases.filter((item) => new Date(item.expiresAt).getTime() < Date.now() && !['CLOSED', 'REVOKED'].includes(item.status)).length
    };
  }

  async listCases() {
    return structuredClone(mockData.cases);
  }

  async createCase(input) {
    const id = crypto.randomUUID();
    const created = {
      id,
      caseReference: input.caseReference || `TSX-${new Date().getFullYear()}-${String(mockData.cases.length + 1).padStart(4, '0')}`,
      description: input.description || 'New investigation case',
      severity: input.severity || 'MEDIUM',
      status: 'OPEN',
      purpose: input.purpose || 'FRAUD_INVESTIGATION',
      openedAt: nowIso(),
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      riskScore: 0,
      transactionCount: 0,
      alertCount: 0,
      pathCount: 0,
      evidenceCount: 0,
      institutions: [],
      assignedTo: input.assignedTo || 'A. Singh',
      lastActivity: 'just now'
    };
    mockData.cases.unshift(created);
    appendMockAudit(id, 'CASE_CREATED', created.assignedTo, created.caseReference);
    return structuredClone(created);
  }

  async getCase(caseId) {
    return structuredClone(makeDetail(caseId));
  }

  async updateCase(caseId, input = {}) {
    const item = mockData.cases.find((entry) => entry.id === caseId);
    if (!item) return null;
    const previousStatus = item.status;
    Object.assign(item, input);
    if (input.status === 'CLOSED' && !item.closedAt) item.closedAt = nowIso();
    if (input.status && input.status !== 'CLOSED') item.closedAt = null;
    item.lastActivity = 'just now';
    if (input.status && input.status !== previousStatus) appendMockAudit(caseId, 'CASE_STATUS_CHANGED', 'A. Singh', `${previousStatus} to ${input.status}`);
    return structuredClone(item);
  }

  async listNotes(caseId) {
    return structuredClone(mockData.notes.filter((item) => item.caseId === caseId));
  }

  async addNote(caseId, input = {}) {
    if (!mockData.cases.some((item) => item.id === caseId)) return null;
    const author = investigatorById(input.authorId || '1') || investigatorById('1');
    const note = {
      id: crypto.randomUUID(),
      caseId,
      body: String(input.body || '').trim(),
      authorId: author.id,
      authorName: author.displayName,
      createdAt: nowIso()
    };
    mockData.notes.unshift(note);
    appendMockAudit(caseId, 'NOTE_ADDED', author.displayName, note.id);
    return structuredClone(note);
  }

  async traceCase(caseId, input = {}) {
    const detail = makeDetail(caseId);
    if (!detail) return null;
    if (caseId === mockData.ids.caseOne) {
      appendMockAudit(caseId, 'TRACE_EXECUTED', input.actorName || 'A. Singh', mockData.ids.pathOne);
      return { caseId, startAccountId: input.startAccountId || mockData.ids.accountVictim, paths: [makePath()] };
    }
    return { caseId, startAccountId: input.startAccountId || null, paths: [] };
  }

  async listRevealRequests(caseId = null) {
    const items = caseId
      ? mockData.revealRequests.filter((item) => item.caseId === caseId)
      : mockData.revealRequests;
    return structuredClone(items).map((item) => {
      if (item.status === 'PENDING' && new Date(item.expiresAt).getTime() <= Date.now()) item.status = 'EXPIRED';
      return item;
    });
  }

  async createRevealRequest(input) {
    const request = {
      id: crypto.randomUUID(),
      caseId: input.caseId,
      target: input.target,
      requestedFields: input.requestedFields ?? ['account holder name'],
      reason: input.reason,
      status: 'PENDING',
      requiredApprovals: Number(input.requiredApprovals || 2),
      approvals: [],
      createdBy: input.createdBy || 'A. Singh',
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
    };
    mockData.revealRequests.unshift(request);
    appendMockAudit(request.caseId, 'REVEAL_REQUESTED', request.createdBy, request.id);
    return structuredClone(request);
  }

  async approveReveal(requestId, input) {
    const request = mockData.revealRequests.find((item) => item.id === requestId);
    if (!request) return null;
    const approver = {
      approverId: input.approverId || 'supervisor-1',
      approverName: input.approverName || 'Supervisor K. Rao',
      role: input.role || 'SUPERVISOR',
      decision: input.decision || 'APPROVE',
      decidedAt: nowIso(),
      reason: input.reason || 'Approved for recovery coordination.'
    };
    request.approvals = request.approvals.filter((item) => item.approverId !== approver.approverId);
    request.approvals.push(approver);
    if (request.approvals.some((item) => item.decision === 'REJECT')) request.status = 'REJECTED';
    const approvedRoles = new Set(request.approvals.filter((item) => item.decision === 'APPROVE').map((item) => item.role));
    if (request.approvals.filter((item) => item.decision === 'APPROVE').length >= request.requiredApprovals && approvedRoles.has('SUPERVISOR') && approvedRoles.has('AUDITOR')) request.status = 'APPROVED';
    appendMockAudit(request.caseId, approver.decision === 'REJECT' ? 'REVEAL_REJECTED' : 'REVEAL_APPROVED', approver.approverName, request.id);
    return structuredClone(request);
  }

  async audit(caseId) {
    return structuredClone(mockData.auditEvents.filter((item) => !caseId || item.caseId === caseId));
  }

  async verifyAudit(caseId) {
    const events = mockData.auditEvents.filter((item) => item.caseId === caseId);
    const valid = verifyMockAuditChain(caseId);
    return { caseId, valid, checkedEvents: events.length, checkedAt: nowIso(), message: valid ? 'The synthetic audit chain is internally consistent.' : 'The synthetic audit chain requires review.' };
  }
}

class PostgresRepository {
  mode = 'postgres';

  constructor() {
    if (!pgModule?.Pool) throw new Error('The pg package is not installed. Run npm install in investigation-app.');
    this.pool = new pgModule.Pool({ connectionString: process.env.DATABASE_URL });
    this.schema = process.env.DB_SCHEMA || 'traceshield';
    if (!/^[a-z_][a-z0-9_]*$/i.test(this.schema)) throw new Error('DB_SCHEMA must be a simple PostgreSQL identifier');
    this.investigatorId = Number(process.env.INVESTIGATOR_ID || 1);
    this.institutionId = Number(process.env.INSTITUTION_ID || 101);
  }

  async query(text, values = []) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('traceshield.investigator_id', $1, true), set_config('traceshield.institution_id', $2, true), set_config('search_path', $3, true)`, [String(this.investigatorId), String(this.institutionId), `${this.schema}, public`]);
      const result = await client.query(text, values);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async health() {
    await this.query('SELECT 1');
    return { mode: this.mode, database: 'postgresql', status: 'ok', serviceVersion: '1.1.0', capabilities: ['trace', 'minimum-disclosure', 'dual-control', 'audit-verification', 'case-notes'] };
  }

  async session() {
    const { rows } = await this.query(`
      SELECT inv.investigator_id::text AS id, inv.display_name AS "displayName", inv.role_code AS role,
             inv.institution_id AS "institutionId", institution.institution_name AS institution, inv.status
      FROM ${this.schema}.investigator inv
      JOIN ${this.schema}.institution institution ON institution.institution_id = inv.institution_id
      WHERE inv.investigator_id = $1
    `, [this.investigatorId]);
    const approverResult = await this.query(`
      SELECT inv.investigator_id::text AS id, inv.display_name AS "displayName", inv.role_code AS role,
             inv.institution_id AS "institutionId", institution.institution_name AS institution, inv.status
      FROM ${this.schema}.investigator inv
      JOIN ${this.schema}.institution institution ON institution.institution_id = inv.institution_id
      WHERE inv.role_code IN ('SUPERVISOR', 'AUDITOR', 'ADMIN') AND inv.status = 'ACTIVE'
      ORDER BY inv.role_code, inv.display_name
    `);
    return {
      investigator: rows[0] || { id: String(this.investigatorId), displayName: 'Protected investigator', role: 'INVESTIGATOR', institutionId: this.institutionId, institution: 'Protected institution', status: 'ACTIVE' },
      approvers: approverResult.rows,
      capabilities: { canTrace: true, canRequestReveal: true, canApproveReveal: ['SUPERVISOR', 'AUDITOR', 'ADMIN'].includes(rows[0]?.role), canManageCase: rows[0]?.role !== 'AUDITOR', canExportReport: true }
    };
  }

  async getApprover(id) {
    const { rows } = await this.query(`
      SELECT investigator_id::text AS id, display_name AS "displayName", role_code AS role,
             institution_id AS "institutionId", status
      FROM ${this.schema}.investigator
      WHERE investigator_id = $1 AND role_code IN ('SUPERVISOR', 'AUDITOR', 'ADMIN') AND status = 'ACTIVE'
    `, [Number(id)]);
    return rows[0] || null;
  }

  async dashboard() {
    const { rows } = await this.query(`
      SELECT
        (SELECT count(*) FROM ${this.schema}.fraud_case WHERE status IN ('OPEN', 'REOPENED'))::int AS "openCases",
        (SELECT count(*) FROM ${this.schema}.fund_path WHERE risk_score >= 0.8)::int AS "criticalPaths",
        (SELECT count(*) FROM ${this.schema}.reveal_request WHERE status = 'PENDING')::int AS "pendingReveals",
        (SELECT count(*) FROM ${this.schema}.institution WHERE status = 'ACTIVE')::int AS institutions,
        'DATABASE_VERIFIED' AS "auditHealth",
        to_char(max(observed_at), 'YYYY-MM-DD HH24:MI') AS "lastIngest"
      FROM ${this.schema}.payment_transaction
    `);
    return rows[0];
  }

  async listCases() {
    const { rows } = await this.query(`
      SELECT
        fc.case_id::text AS id,
        fc.case_reference AS "caseReference",
        fc.description,
        fc.severity,
        fc.status,
        fc.purpose_code AS purpose,
        fc.opened_at AS "openedAt",
        fc.expires_at AS "expiresAt",
        coalesce(max(fp.risk_score), 0)::float AS "riskScore",
        count(DISTINCT ct.transaction_id)::int AS "transactionCount",
        count(DISTINCT ca.alert_id)::int AS "alertCount",
        count(DISTINCT fp.path_id)::int AS "pathCount",
        count(DISTINCT er.evidence_id)::int AS "evidenceCount",
        coalesce(max(i.display_name), 'Unassigned') AS "assignedTo"
      FROM ${this.schema}.fraud_case fc
      LEFT JOIN ${this.schema}.case_transaction ct ON ct.case_id = fc.case_id
      LEFT JOIN ${this.schema}.case_alert ca ON ca.case_id = fc.case_id
      LEFT JOIN ${this.schema}.fund_path fp ON fp.case_id = fc.case_id
      LEFT JOIN ${this.schema}.evidence_record er ON er.case_id = fc.case_id
      LEFT JOIN ${this.schema}.case_access access ON access.case_id = fc.case_id
      LEFT JOIN ${this.schema}.investigator i ON i.investigator_id = access.investigator_id
      GROUP BY fc.case_id, fc.case_reference, fc.description, fc.severity, fc.status, fc.purpose_code, fc.opened_at, fc.expires_at
      ORDER BY fc.opened_at DESC
    `);
    return rows;
  }

  async createCase(input) {
    const { rows } = await this.query(`
      INSERT INTO ${this.schema}.fraud_case
        (case_reference, opened_by, severity, purpose_code, description, case_nonce_commitment, expires_at)
      VALUES ($1, $2, $3, $4, $5, encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'), now() + interval '14 days')
      RETURNING case_id::text AS id, case_reference AS "caseReference", description, severity, status, purpose_code AS purpose, opened_at AS "openedAt", expires_at AS "expiresAt"
    `, [input.caseReference, input.openedBy || this.investigatorId, input.severity || 'MEDIUM', input.purpose || 'FRAUD_INVESTIGATION', input.description || 'New investigation case']);
    const created = rows[0];
    if (!created) return null;
    await this.query(`
      INSERT INTO ${this.schema}.case_access (case_id, investigator_id, access_level, granted_by, expires_at)
      VALUES ($1::uuid, $2, 'INVESTIGATOR', $2, $3::timestamptz)
      ON CONFLICT (case_id, investigator_id) DO NOTHING
    `, [created.id, input.openedBy || this.investigatorId, created.expiresAt]);
    await this.query(`
      INSERT INTO ${this.schema}.audit_event (case_id, actor_investigator_id, event_type, target_type, target_id, event_payload)
      VALUES ($1::uuid, $2, 'CASE_CREATED', 'FRAUD_CASE', $3, $4::jsonb)
    `, [created.id, input.openedBy || this.investigatorId, created.caseReference, JSON.stringify({ purpose: created.purpose, severity: created.severity })]);
    return created;
  }

  async getCase(caseId) {
    const caseResult = await this.query(`
      SELECT fc.case_id::text AS id, fc.case_reference AS "caseReference", fc.description, fc.severity, fc.status,
             fc.purpose_code AS purpose, fc.opened_at AS "openedAt", fc.expires_at AS "expiresAt",
             coalesce(max(fp.risk_score), 0)::float AS "riskScore",
             count(DISTINCT ct.transaction_id)::int AS "transactionCount",
             count(DISTINCT ca.alert_id)::int AS "alertCount",
             count(DISTINCT fp.path_id)::int AS "pathCount",
             count(DISTINCT er.evidence_id)::int AS "evidenceCount",
             coalesce(max(i.display_name), 'Unassigned') AS "assignedTo"
      FROM ${this.schema}.fraud_case fc
      LEFT JOIN ${this.schema}.case_transaction ct ON ct.case_id = fc.case_id
      LEFT JOIN ${this.schema}.case_alert ca ON ca.case_id = fc.case_id
      LEFT JOIN ${this.schema}.fund_path fp ON fp.case_id = fc.case_id
      LEFT JOIN ${this.schema}.evidence_record er ON er.case_id = fc.case_id
      LEFT JOIN ${this.schema}.case_access access ON access.case_id = fc.case_id
      LEFT JOIN ${this.schema}.investigator i ON i.investigator_id = access.investigator_id
      WHERE fc.case_id = $1::uuid
      GROUP BY fc.case_id
    `, [caseId]);
    if (!caseResult.rows[0]) return null;

    const [transactionResult, pathResult, pathHopResult, signalResult, evidenceResult, complaintResult, noteResult, revealResult] = await Promise.all([
      this.query(`
        SELECT t.transaction_id::text AS id, t.transaction_reference_token AS reference, t.amount::float,
               t.currency_code AS currency, t.payment_rail AS rail, t.transaction_status AS status,
               t.occurred_at AS "occurredAt", t.source_institution_id AS "sourceInstitutionId",
               t.sender_account_id::text AS "fromAccountId", t.receiver_account_id::text AS "toAccountId",
               json_build_object('id', t.sender_account_id::text, 'token', left(from_account.account_token_digest, 12) || '...', 'institution', from_institution.institution_name, 'institutionCode', from_institution.institution_code, 'status', from_account.status) AS "from",
               json_build_object('id', t.receiver_account_id::text, 'token', left(to_account.account_token_digest, 12) || '...', 'institution', to_institution.institution_name, 'institutionCode', to_institution.institution_code, 'status', to_account.status) AS "to"
        FROM ${this.schema}.payment_transaction t
        JOIN ${this.schema}.case_transaction ct ON ct.transaction_id = t.transaction_id
        JOIN ${this.schema}.bank_account from_account ON from_account.account_id = t.sender_account_id
        JOIN ${this.schema}.institution from_institution ON from_institution.institution_id = from_account.institution_id
        JOIN ${this.schema}.bank_account to_account ON to_account.account_id = t.receiver_account_id
        JOIN ${this.schema}.institution to_institution ON to_institution.institution_id = to_account.institution_id
        WHERE ct.case_id = $1::uuid ORDER BY t.occurred_at
      `, [caseId]),
      this.query(`
        SELECT fp.path_id::text AS id, fp.path_status AS status, fp.hop_count AS "hopCount", fp.risk_score::float AS "riskScore",
               fp.certificate_hash AS "certificateHash", fp.generated_at AS "generatedAt"
        FROM ${this.schema}.fund_path fp WHERE fp.case_id = $1::uuid ORDER BY fp.generated_at DESC
      `, [caseId]),
      this.query(`
        SELECT ph.path_id::text AS "pathId", ph.hop_no AS "hopNo", ph.transaction_id::text AS "transactionId",
               ph.from_account_id::text AS "fromAccountId", ph.to_account_id::text AS "toAccountId",
               ph.amount_bucket AS "amountBucket", ph.temporal_gap_seconds AS "temporalGapSeconds",
               ph.hop_risk_score::float AS "riskScore", ph.provenance_hash AS "provenanceHash",
               t.occurred_at AS "occurredAt", t.amount::float, t.currency_code AS currency,
               json_build_object('id', ph.from_account_id::text, 'token', left(from_account.account_token_digest, 12) || '...', 'institution', from_institution.institution_name, 'institutionCode', from_institution.institution_code, 'status', from_account.status) AS "from",
               json_build_object('id', ph.to_account_id::text, 'token', left(to_account.account_token_digest, 12) || '...', 'institution', to_institution.institution_name, 'institutionCode', to_institution.institution_code, 'status', to_account.status) AS "to"
        FROM ${this.schema}.path_hop ph
        JOIN ${this.schema}.payment_transaction t ON t.transaction_id = ph.transaction_id
        JOIN ${this.schema}.bank_account from_account ON from_account.account_id = ph.from_account_id
        JOIN ${this.schema}.institution from_institution ON from_institution.institution_id = from_account.institution_id
        JOIN ${this.schema}.bank_account to_account ON to_account.account_id = ph.to_account_id
        JOIN ${this.schema}.institution to_institution ON to_institution.institution_id = to_account.institution_id
        JOIN ${this.schema}.fund_path fp ON fp.path_id = ph.path_id
        WHERE fp.case_id = $1::uuid ORDER BY ph.path_id, ph.hop_no
      `, [caseId]),
      this.query(`
        SELECT ts.signal_id::text AS id, ts.signal_type AS type, ts.signal_score::float AS score,
               ts.explanation, ts.signal_type AS label
        FROM ${this.schema}.transaction_signal ts
        JOIN ${this.schema}.case_transaction ct ON ct.transaction_id = ts.transaction_id
        WHERE ct.case_id = $1::uuid ORDER BY ts.signal_score DESC
      `, [caseId]),
      this.query(`
        SELECT er.evidence_id::text AS id, er.evidence_type AS type, er.evidence_type AS title,
               er.source_record_hash AS commitment, er.integrity_status AS status, er.captured_at AS "capturedAt",
               coalesce(i.institution_name, 'TraceShield X') AS source
        FROM ${this.schema}.evidence_record er
        LEFT JOIN ${this.schema}.institution i ON i.institution_id = er.source_institution_id
        WHERE er.case_id = $1::uuid ORDER BY er.captured_at DESC
      `, [caseId]),
      this.query(`
        SELECT fc.complaint_id::text AS id, fc.complaint_reference_token AS reference, fc.channel,
               fc.reported_at AS "reportedAt", fc.summary, fc.status, fc.source_record_hash AS "sourceRecordHash",
               i.institution_name AS source
        FROM ${this.schema}.fraud_complaint fc
        LEFT JOIN ${this.schema}.institution i ON i.institution_id = fc.source_institution_id
        WHERE fc.case_id = $1::uuid ORDER BY fc.reported_at DESC
      `, [caseId]),
      this.query(`
        SELECT cn.note_id::text AS id, cn.case_id::text AS "caseId", cn.note_body AS body,
               cn.author_investigator_id::text AS "authorId", inv.display_name AS "authorName", cn.created_at AS "createdAt"
        FROM ${this.schema}.case_note cn
        JOIN ${this.schema}.investigator inv ON inv.investigator_id = cn.author_investigator_id
        WHERE cn.case_id = $1::uuid ORDER BY cn.created_at DESC
      `, [caseId]),
      this.listRevealRequests(caseId)
    ]);

    const paths = pathResult.rows.map((path) => ({
      ...path,
      hops: pathHopResult.rows.filter((hop) => hop.pathId === path.id)
    }));

    return {
      ...caseResult.rows[0],
      transactions: transactionResult.rows,
      paths,
      signals: signalResult.rows,
      evidence: evidenceResult.rows,
      complaints: complaintResult.rows,
      notes: noteResult.rows,
      revealRequests: revealResult
    };
  }

  async updateCase(caseId, input = {}) {
    const values = [caseId];
    const updates = [];
    if (input.status !== undefined) {
      values.push(input.status);
      updates.push(`status = $${values.length}`);
      updates.push(`closed_at = CASE WHEN $${values.length} = 'CLOSED' THEN coalesce(closed_at, now()) ELSE NULL END`);
    }
    if (input.severity !== undefined) {
      values.push(input.severity);
      updates.push(`severity = $${values.length}`);
    }
    if (input.description !== undefined) {
      values.push(input.description);
      updates.push(`description = $${values.length}`);
    }
    if (!updates.length) return null;
    const { rows } = await this.query(`
      UPDATE ${this.schema}.fraud_case
      SET ${updates.join(', ')}
      WHERE case_id = $1::uuid
      RETURNING case_id::text AS id, case_reference AS "caseReference", description, severity, status,
                purpose_code AS purpose, opened_at AS "openedAt", expires_at AS "expiresAt", closed_at AS "closedAt"
    `, values);
    const updated = rows[0] || null;
    if (updated && input.status) {
      await this.query(`
        INSERT INTO ${this.schema}.audit_event (case_id, actor_investigator_id, event_type, target_type, target_id, event_payload)
        VALUES ($1::uuid, $2, 'CASE_STATUS_CHANGED', 'FRAUD_CASE', $3, $4::jsonb)
      `, [caseId, this.investigatorId, caseId, JSON.stringify({ status: input.status })]);
    }
    return updated;
  }

  async listNotes(caseId) {
    const { rows } = await this.query(`
      SELECT cn.note_id::text AS id, cn.case_id::text AS "caseId", cn.note_body AS body,
             cn.author_investigator_id::text AS "authorId", inv.display_name AS "authorName", cn.created_at AS "createdAt"
      FROM ${this.schema}.case_note cn
      JOIN ${this.schema}.investigator inv ON inv.investigator_id = cn.author_investigator_id
      WHERE cn.case_id = $1::uuid ORDER BY cn.created_at DESC
    `, [caseId]);
    return rows;
  }

  async addNote(caseId, input = {}) {
    const { rows } = await this.query(`
      INSERT INTO ${this.schema}.case_note (case_id, author_investigator_id, note_body)
      VALUES ($1::uuid, $2, $3)
      RETURNING note_id::text AS id, case_id::text AS "caseId", author_investigator_id::text AS "authorId", note_body AS body, created_at AS "createdAt"
    `, [caseId, this.investigatorId, input.body]);
    const note = rows[0] || null;
    if (note) {
      const session = await this.session();
      note.authorName = session.investigator?.displayName || 'Protected investigator';
      await this.query(`
        INSERT INTO ${this.schema}.audit_event (case_id, actor_investigator_id, event_type, target_type, target_id, event_payload)
        VALUES ($1::uuid, $2, 'NOTE_ADDED', 'CASE_NOTE', $3, $4::jsonb)
      `, [caseId, this.investigatorId, note.id, JSON.stringify({ characterCount: String(input.body || '').length })]);
    }
    return note;
  }

  async traceCase(caseId, input = {}) {
    const start = input.startAccountId || (await this.query(`
      SELECT t.sender_account_id::text AS id
      FROM ${this.schema}.payment_transaction t
      JOIN ${this.schema}.case_transaction ct ON ct.transaction_id = t.transaction_id
      WHERE ct.case_id = $1::uuid ORDER BY t.occurred_at LIMIT 1
    `, [caseId])).rows[0]?.id;
    if (!start) return { caseId, paths: [] };
    const { rows } = await this.query(`
      SELECT hop_no AS "hopNo", transaction_id::text AS "transactionId", from_account_id::text AS "fromAccountId",
             to_account_id::text AS "toAccountId", amount::float, occurred_at AS "occurredAt", source_institution_id AS "sourceInstitutionId"
      FROM ${this.schema}.trace_fund_path($1::uuid, $2::uuid, $3::int)
    `, [caseId, start, input.maxHops || 5]);
    if (!rows.length) return { caseId, startAccountId: start, paths: [] };

    const accountIds = [...new Set(rows.flatMap((row) => [row.fromAccountId, row.toAccountId]))];
    const accountResult = await this.query(`
      SELECT ba.account_id::text AS id, left(ba.account_token_digest, 12) || '...' AS token,
             ba.status, i.institution_name AS institution, i.institution_code AS "institutionCode"
      FROM ${this.schema}.bank_account ba
      JOIN ${this.schema}.institution i ON i.institution_id = ba.institution_id
      WHERE ba.account_id = ANY($1::uuid[])
    `, [accountIds]);
    const accounts = new Map(accountResult.rows.map((account) => [account.id, account]));
    const enrichedRows = rows.map((row, index) => ({
      ...row,
      from: accounts.get(row.fromAccountId) || { id: row.fromAccountId, token: shortToken(row.fromAccountId) },
      to: accounts.get(row.toAccountId) || { id: row.toAccountId, token: shortToken(row.toAccountId) },
      amountBucket: `${Number(row.amount).toLocaleString('en-IN')} INR`,
      temporalGapSeconds: index === 0 ? 0 : Math.max(0, Math.round((new Date(row.occurredAt).getTime() - new Date(rows[index - 1].occurredAt).getTime()) / 1000)),
      riskScore: Math.min(0.99, 0.68 + (index * 0.08))
    }));
    const pathId = crypto.randomUUID();
    const riskScore = Math.max(...enrichedRows.map((row) => row.riskScore));
    const certificateHash = crypto.createHash('sha256').update(JSON.stringify(enrichedRows)).digest('hex');
    const endAccount = enrichedRows.at(-1)?.toAccountId || start;
    await this.query(`
      INSERT INTO ${this.schema}.fund_path (path_id, case_id, start_account_id, end_account_id, path_status, hop_count, risk_score, certificate_hash, generated_by)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'GENERATED', $5, $6, $7, $8)
    `, [pathId, caseId, start, endAccount, enrichedRows.length, riskScore, certificateHash, this.investigatorId]);
    for (const hop of enrichedRows) {
      await this.query(`
        INSERT INTO ${this.schema}.path_hop (path_id, hop_no, transaction_id, from_account_id, to_account_id, amount_bucket, temporal_gap_seconds, hop_risk_score, provenance_hash)
        VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9)
      `, [pathId, hop.hopNo, hop.transactionId, hop.fromAccountId, hop.toAccountId, hop.amountBucket, hop.temporalGapSeconds, hop.riskScore, crypto.createHash('sha256').update(`${pathId}|${hop.hopNo}|${hop.transactionId}`).digest('hex')]);
    }
    await this.query(`
      INSERT INTO ${this.schema}.audit_event (case_id, actor_investigator_id, event_type, target_type, target_id, event_payload)
      VALUES ($1::uuid, $2, 'TRACE_EXECUTED', 'FUND_PATH', $3, $4::jsonb)
    `, [caseId, this.investigatorId, pathId, JSON.stringify({ startAccountId: start, hopCount: enrichedRows.length, certificateHash })]);
    return { caseId, startAccountId: start, paths: [{ id: pathId, status: 'GENERATED', hopCount: enrichedRows.length, riskScore, certificateHash, generatedAt: nowIso(), hops: enrichedRows }] };
  }

  async listRevealRequests(caseId = null) {
    const values = [];
    const where = caseId ? 'WHERE rr.case_id = $1::uuid' : '';
    if (caseId) values.push(caseId);
    const { rows } = await this.query(`
      SELECT rr.reveal_request_id::text AS id, rr.case_id::text AS "caseId", rr.target_account_id::text AS "targetAccountId",
             coalesce(left(ba.account_token_digest, 12) || '...', rr.target_party_token_id::text) AS target,
             rr.requested_fields AS "requestedFields",
             rr.reason, CASE WHEN rr.status = 'PENDING' AND rr.expires_at <= now() THEN 'EXPIRED' ELSE rr.status END AS status, rr.required_approvals AS "requiredApprovals", rr.created_at AS "createdAt", rr.expires_at AS "expiresAt",
             coalesce(json_agg(json_build_object('approverId', ra.approver_id, 'approverName', approver.display_name, 'role', ra.approver_role, 'decision', ra.decision, 'decidedAt', ra.decided_at)) FILTER (WHERE ra.approver_id IS NOT NULL), '[]') AS approvals
      FROM ${this.schema}.reveal_request rr
      LEFT JOIN ${this.schema}.bank_account ba ON ba.account_id = rr.target_account_id
      LEFT JOIN ${this.schema}.reveal_approval ra ON ra.reveal_request_id = rr.reveal_request_id
      LEFT JOIN ${this.schema}.investigator approver ON approver.investigator_id = ra.approver_id
      ${where}
      GROUP BY rr.reveal_request_id, ba.account_token_digest, rr.status, rr.expires_at ORDER BY rr.created_at DESC
    `, values);
    return rows;
  }

  async createRevealRequest(input) {
    const targetAccountId = input.targetAccountId || input.target;
    if (!targetAccountId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetAccountId)) {
      const error = new Error('A valid protected account id is required for a PostgreSQL reveal request.');
      error.status = 400;
      throw error;
    }
    const scopedAccount = await this.query(`
      SELECT 1
      FROM ${this.schema}.case_transaction ct
      JOIN ${this.schema}.payment_transaction t ON t.transaction_id = ct.transaction_id
      WHERE ct.case_id = $1::uuid
        AND (t.sender_account_id = $2::uuid OR t.receiver_account_id = $2::uuid)
      LIMIT 1
    `, [input.caseId, targetAccountId]);
    if (!scopedAccount.rows[0]) {
      const error = new Error('The reveal target must belong to the selected case scope.');
      error.status = 400;
      throw error;
    }
    const { rows } = await this.query(`
      INSERT INTO ${this.schema}.reveal_request
        (case_id, requested_by, target_account_id, requested_fields, reason, expires_at)
      VALUES ($1::uuid, $2, $3::uuid, $4::jsonb, $5, now() + interval '4 hours')
      RETURNING reveal_request_id::text AS id, case_id::text AS "caseId", requested_fields AS "requestedFields", reason, status, required_approvals AS "requiredApprovals", created_at AS "createdAt", expires_at AS "expiresAt"
    `, [input.caseId, input.requestedBy || this.investigatorId, targetAccountId, JSON.stringify(input.requestedFields || ['account holder name']), input.reason]);
    const created = rows[0];
    if (created) {
      await this.query(`
        INSERT INTO ${this.schema}.audit_event (case_id, actor_investigator_id, event_type, target_type, target_id, event_payload)
        VALUES ($1::uuid, $2, 'REVEAL_REQUESTED', 'REVEAL_REQUEST', $3, $4::jsonb)
      `, [created.caseId, input.requestedBy || this.investigatorId, created.id, JSON.stringify({ requestedFields: input.requestedFields || ['account holder name'], reason: input.reason })]);
    }
    return created;
  }

  async approveReveal(requestId, input) {
    await this.query(`
      INSERT INTO ${this.schema}.reveal_approval (reveal_request_id, approver_id, approver_role, decision, decision_reason)
      VALUES ($1::uuid, $2, $3, $4, $5)
      ON CONFLICT (reveal_request_id, approver_id) DO UPDATE SET decision = EXCLUDED.decision, decision_reason = EXCLUDED.decision_reason, decided_at = now()
    `, [requestId, Number(input.approverId || 2), input.role || 'SUPERVISOR', input.decision || 'APPROVE', input.reason || 'Approved for investigation use.']);
    await this.query(`
      UPDATE ${this.schema}.reveal_request rr SET status = CASE
        WHEN EXISTS (SELECT 1 FROM ${this.schema}.reveal_approval ra WHERE ra.reveal_request_id = rr.reveal_request_id AND ra.decision = 'REJECT') THEN 'REJECTED'
        WHEN (SELECT count(*) FROM ${this.schema}.reveal_approval ra WHERE ra.reveal_request_id = rr.reveal_request_id AND ra.decision = 'APPROVE') >= rr.required_approvals
             AND EXISTS (SELECT 1 FROM ${this.schema}.reveal_approval ra WHERE ra.reveal_request_id = rr.reveal_request_id AND ra.decision = 'APPROVE' AND ra.approver_role = 'SUPERVISOR')
             AND EXISTS (SELECT 1 FROM ${this.schema}.reveal_approval ra WHERE ra.reveal_request_id = rr.reveal_request_id AND ra.decision = 'APPROVE' AND ra.approver_role = 'AUDITOR') THEN 'APPROVED'
        ELSE rr.status END
      WHERE rr.reveal_request_id = $1::uuid
    `, [requestId]);
    const request = (await this.listRevealRequests()).find((item) => item.id === requestId) || null;
    if (!request) return null;
    await this.query(`
      INSERT INTO ${this.schema}.audit_event (case_id, actor_investigator_id, event_type, target_type, target_id, event_payload)
      VALUES ($1::uuid, $2, $3, 'REVEAL_REQUEST', $4, $5::jsonb)
    `, [request.caseId, Number(input.approverId || 2), input.decision === 'REJECT' ? 'REVEAL_REJECTED' : 'REVEAL_APPROVED', requestId, JSON.stringify({ decision: input.decision || 'APPROVE', status: request.status })]);
    return request;
  }

  async audit(caseId) {
    const { rows } = await this.query(`
      SELECT ae.audit_event_id AS id, ae.event_type AS type, ae.target_id AS target,
             actor.display_name AS actor, ae.occurred_at AS "occurredAt", ae.event_hash AS hash, ae.previous_event_hash AS "previousHash"
      FROM ${this.schema}.audit_event ae
      LEFT JOIN ${this.schema}.investigator actor ON actor.investigator_id = ae.actor_investigator_id
      WHERE ae.case_id = $1::uuid ORDER BY ae.audit_event_id
    `, [caseId]);
    return rows;
  }

  async verifyAudit(caseId) {
    const { rows } = await this.query(`SELECT ${this.schema}.verify_case_audit_chain($1::uuid) AS valid`, [caseId]);
    return { caseId, valid: rows[0]?.valid === true, checkedAt: nowIso(), message: rows[0]?.valid ? 'The database audit chain is internally consistent.' : 'The database audit chain requires review.' };
  }
}

export function createRepository() {
  const wantsPostgres = (process.env.DATA_MODE || 'mock').toLowerCase() === 'postgres';
  if (wantsPostgres && process.env.DATABASE_URL) return new PostgresRepository();
  return new MockRepository();
}
