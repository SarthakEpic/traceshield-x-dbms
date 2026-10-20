import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mockData } from './mock-data.js';
import {
  createSessionToken,
  hashSessionToken,
  hashUserAgent,
  verifyPassword
} from './auth.js';
import { createProtectedToken, prepareIngestionBatch } from './ingestion-engine.js';
import { assertRuntimeConfig, getRuntimeConfig } from './runtime-config.js';

export const actorContext = new AsyncLocalStorage();

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
    return { mode: this.mode, database: 'synthetic repository', status: 'ok', serviceVersion: '1.1.0', capabilities: ['trace', 'minimum-disclosure', 'dual-control', 'audit-verification', 'case-notes', 'ingestion-validation'] };
  }

  async authenticate() {
    return null;
  }

  async sessionFromToken() {
    return null;
  }

  async revokeSession() {
    return false;
  }

  async ingestBatch(input) {
    const batch = prepareIngestionBatch(input);
    return {
      status: 'MOCK_VALIDATED',
      batchId: `mock-${batch.payloadHash.slice(-12)}`,
      caseId: batch.caseId,
      sourceInstitutionCode: batch.sourceInstitutionCode,
      recordCount: batch.recordCount,
      payloadHash: batch.payloadHash,
      message: 'The synthetic repository validated the batch but did not persist it.'
    };
  }

  async listIngestionBatches() {
    return [];
  }

  async session() {
    const current = investigatorById('1');
    return {
      investigator: structuredClone(current),
      approvers: structuredClone(mockData.investigators.filter((item) => ['SUPERVISOR', 'AUDITOR', 'ADMIN'].includes(item.role))),
      capabilities: { canTrace: true, canRequestReveal: true, canApproveReveal: false, canManageCase: true, canExportReport: true }
    };
  }

  async createTokenContext(caseId) {
    return { id: `mock-context-${String(caseId).slice(-8)}`, caseId, epochNo: 0, tokenVersion: 1, purpose: 'FRAUD_INVESTIGATION', status: 'ACTIVE', createdAt: nowIso(), expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() };
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
    const config = assertRuntimeConfig(getRuntimeConfig());
    this.pool = new pgModule.Pool({ connectionString: config.databaseUrl });
    this.schema = config.dbSchema;
    this.investigatorId = Number(process.env.INVESTIGATOR_ID || 1);
    this.institutionId = Number(process.env.INSTITUTION_ID || 101);
    this.tokenSecret = config.tokenSecret;
  }

  currentActor() {
    const actor = actorContext.getStore();
    return {
      investigatorId: Number(actor?.id ?? actor?.investigatorId ?? this.investigatorId),
      institutionId: Number(actor?.institutionId ?? this.institutionId),
      role: actor?.role || null
    };
  }

  async query(text, values = []) {
    const client = await this.pool.connect();
    const actor = this.currentActor();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('traceshield.investigator_id', $1, true), set_config('traceshield.institution_id', $2, true), set_config('search_path', $3, true)`, [String(actor.investigatorId), String(actor.institutionId), `${this.schema}, public`]);
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

  async withTransaction(work) {
    const client = await this.pool.connect();
    const actor = this.currentActor();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('traceshield.investigator_id', $1, true), set_config('traceshield.institution_id', $2, true), set_config('search_path', $3, true)`, [String(actor.investigatorId), String(actor.institutionId), `${this.schema}, public`]);
      const result = await work(client, actor);
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
    return { mode: this.mode, database: 'postgresql', status: 'ok', serviceVersion: '1.1.0', capabilities: ['trace', 'minimum-disclosure', 'dual-control', 'audit-verification', 'case-notes', 'session-authentication', 'idempotent-source-ingestion'] };
  }

  async authenticate(loginName, password, userAgent = '') {
    const normalizedLogin = String(loginName || '').trim().toLowerCase();
    const { rows } = await this.query(`
      SELECT credential.investigator_id AS id, credential.login_name AS "loginName",
             credential.password_hash AS "passwordHash", credential.failed_attempts AS "failedAttempts",
             credential.locked_until AS "lockedUntil", inv.display_name AS "displayName",
             inv.role_code AS role, inv.institution_id AS "institutionId", institution.institution_name AS institution,
             inv.status
      FROM ${this.schema}.investigator_credential credential
      JOIN ${this.schema}.investigator inv ON inv.investigator_id = credential.investigator_id
      JOIN ${this.schema}.institution institution ON institution.institution_id = inv.institution_id
      WHERE lower(credential.login_name) = $1
    `, [normalizedLogin]);
    const credential = rows[0];
    const locked = credential?.lockedUntil && new Date(credential.lockedUntil).getTime() > Date.now();
    const passwordMatches = credential ? verifyPassword(password, credential.passwordHash) : false;
    if (!credential || credential.status !== 'ACTIVE' || locked || !passwordMatches) {
      if (credential && !locked && !passwordMatches) {
        await this.query(`
          UPDATE ${this.schema}.investigator_credential
          SET failed_attempts = failed_attempts + 1,
              locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END
          WHERE investigator_id = $1 AND locked_until IS NULL
        `, [credential.id]);
      }
      return null;
    }
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    await this.query(`
      UPDATE ${this.schema}.investigator_credential
      SET failed_attempts = 0, locked_until = NULL, last_login_at = now()
      WHERE investigator_id = $1
    `, [credential.id]);
    await this.query(`
      INSERT INTO ${this.schema}.auth_session (investigator_id, session_token_hash, expires_at, user_agent_hash)
      VALUES ($1, $2, $3::timestamptz, $4)
    `, [credential.id, hashSessionToken(token), expiresAt, hashUserAgent(userAgent)]);
    return { token, expiresAt, investigator: this.publicActor(credential) };
  }

  publicActor(row) {
    return {
      id: String(row.id ?? row.investigatorId),
      displayName: row.displayName,
      role: row.role,
      institutionId: Number(row.institutionId),
      institution: row.institution,
      status: row.status
    };
  }

  async sessionFromToken(token) {
    const value = String(token || '').trim();
    if (!value) return null;
    const { rows } = await this.query(`
      SELECT inv.investigator_id AS id, inv.display_name AS "displayName", inv.role_code AS role,
             inv.institution_id AS "institutionId", institution.institution_name AS institution, inv.status,
             auth.expires_at AS "expiresAt"
      FROM ${this.schema}.auth_session auth
      JOIN ${this.schema}.investigator inv ON inv.investigator_id = auth.investigator_id
      JOIN ${this.schema}.institution institution ON institution.institution_id = inv.institution_id
      WHERE auth.session_token_hash = $1
        AND auth.revoked_at IS NULL
        AND auth.expires_at > now()
        AND inv.status = 'ACTIVE'
    `, [hashSessionToken(value)]);
    const actor = rows[0] ? this.publicActor(rows[0]) : null;
    if (actor) {
      await this.query(`UPDATE ${this.schema}.auth_session SET last_seen_at = now() WHERE session_token_hash = $1`, [hashSessionToken(value)]);
    }
    return actor ? { ...actor, expiresAt: rows[0].expiresAt } : null;
  }

  async revokeSession(token) {
    const value = String(token || '').trim();
    if (!value) return false;
    const result = await this.query(`UPDATE ${this.schema}.auth_session SET revoked_at = now() WHERE session_token_hash = $1 AND revoked_at IS NULL`, [hashSessionToken(value)]);
    return result.rowCount > 0;
  }

  async ingestBatch(input) {
    const batch = prepareIngestionBatch(input);
    if (this.tokenSecret.length < 32) {
      const error = new Error('TRACESHIELD_TOKEN_SECRET must contain at least 32 characters before ingestion is enabled.');
      error.status = 503;
      throw error;
    }

    return this.withTransaction(async (client, actor) => {
      const run = (text, values = []) => client.query(text, values);
      const reject = (message, status = 400) => {
        const error = new Error(message);
        error.status = status;
        throw error;
      };

      const actorResult = await run(`
        SELECT investigator_id AS id, institution_id AS "institutionId", role_code AS role, status
        FROM ${this.schema}.investigator
        WHERE investigator_id = $1
      `, [actor.investigatorId]);
      const actorRow = actorResult.rows[0];
      if (!actorRow || actorRow.status !== 'ACTIVE') reject('The authenticated investigator is not active.', 403);
      const actorRole = actorRow.role || actor.role;
      const sourceInstitutionResult = await run(`
        SELECT institution_id AS id, institution_code AS code, institution_name AS name
        FROM ${this.schema}.institution
        WHERE institution_code = $1 AND status = 'ACTIVE'
      `, [batch.sourceInstitutionCode]);
      const sourceInstitution = sourceInstitutionResult.rows[0];
      if (!sourceInstitution) reject('The source institution is not active or is not registered.', 400);
      if (Number(sourceInstitution.id) !== Number(actorRow.institutionId) && actorRole !== 'ADMIN') {
        reject('Only an administrator can submit a batch for another institution.', 403);
      }

      const contextResult = await run(`
        SELECT tc.context_id::text AS "contextId", tc.case_id::text AS "caseId"
        FROM ${this.schema}.token_context tc
        JOIN ${this.schema}.case_access ca ON ca.case_id = tc.case_id
        WHERE tc.case_id = $1::uuid
          AND ca.investigator_id = $2
          AND ca.revoked_at IS NULL
          AND ca.expires_at > now()
          AND tc.status = 'ACTIVE'
          AND tc.expires_at > now()
        ORDER BY tc.created_at DESC
        LIMIT 1
      `, [batch.caseId, actor.investigatorId]);
      const context = contextResult.rows[0];
      if (!context) reject('The investigator has no active token context for this case.', 403);

      const duplicateResult = await run(`
        SELECT batch_id::text AS "batchId", case_id::text AS "caseId", context_id::text AS "contextId",
               payload_hash AS "payloadHash", status, record_count AS "recordCount", created_at AS "createdAt", completed_at AS "completedAt"
        FROM ${this.schema}.source_ingestion_batch
        WHERE source_institution_id = $1 AND batch_reference = $2
        FOR UPDATE
      `, [sourceInstitution.id, batch.batchReference]);
      const duplicate = duplicateResult.rows[0];
      if (duplicate) {
        if (duplicate.caseId !== batch.caseId || duplicate.contextId !== context.contextId) {
          reject('This batch reference is already bound to a different case or token context.', 409);
        }
        if (duplicate.payloadHash !== batch.payloadHash) reject('This batch reference was already used for a different payload.', 409);
        return {
          status: 'DUPLICATE',
          batchId: duplicate.batchId,
          caseId: duplicate.caseId,
          contextId: duplicate.contextId,
          sourceInstitutionCode: batch.sourceInstitutionCode,
          recordCount: duplicate.recordCount,
          payloadHash: duplicate.payloadHash,
          createdAt: duplicate.createdAt,
          completedAt: duplicate.completedAt
        };
      }

      const batchResult = await run(`
        INSERT INTO ${this.schema}.source_ingestion_batch
          (source_institution_id, submitted_by, case_id, context_id, batch_reference, source_system, payload_hash, record_count, status)
        VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, 'RECEIVED')
        RETURNING batch_id::text AS "batchId", created_at AS "createdAt"
      `, [sourceInstitution.id, actor.investigatorId, batch.caseId, context.contextId, batch.batchReference, batch.sourceSystem, batch.payloadHash, batch.recordCount]);
      const storedBatch = batchResult.rows[0];

      const institutionResult = await run(`
        SELECT institution_id AS id, institution_code AS code
        FROM ${this.schema}.institution
        WHERE status = 'ACTIVE'
      `);
      const institutions = new Map(institutionResult.rows.map((row) => [String(row.code).toUpperCase(), Number(row.id)]));
      const resolveInstitutionId = (code, field) => {
        const normalized = String(code || batch.sourceInstitutionCode).trim().toUpperCase();
        const id = institutions.get(normalized);
        if (!id) reject(`${field} refers to an unknown active institution.`, 400);
        return id;
      };
      const accountCache = new Map();
      const identityCache = new Map();
      const deviceCache = new Map();
      const networkCache = new Map();
      const transactionCache = new Map();

      const resolveAccount = async (sourceRef, institutionCode, explicitId = null) => {
        if (explicitId) {
          const direct = await run(`
            SELECT account_id::text AS id, institution_id AS "institutionId", source_record_hash AS "sourceRecordHash"
            FROM ${this.schema}.bank_account
            WHERE account_id = $1::uuid AND context_id = $2::uuid
          `, [explicitId, context.contextId]);
          if (!direct.rows[0]) reject('The supplied protected account id is outside the active token context.', 403);
          return direct.rows[0].id;
        }
        const normalizedInstitutionCode = String(institutionCode || batch.sourceInstitutionCode).toUpperCase();
        const institutionId = resolveInstitutionId(normalizedInstitutionCode, 'Account institution');
        const normalizedRef = String(sourceRef).trim().toLowerCase();
        const key = `${normalizedInstitutionCode}|${normalizedRef}`;
        if (accountCache.has(key)) return accountCache.get(key);
        const digest = createProtectedToken(normalizedRef, context.contextId, 'ACCOUNT', this.tokenSecret);
        const result = await run(`
          SELECT account_id::text AS id
          FROM ${this.schema}.bank_account
          WHERE context_id = $1::uuid AND institution_id = $2 AND account_token_digest = $3
        `, [context.contextId, institutionId, digest]);
        if (!result.rows[0]) reject('No protected account record was found for the supplied reference.', 422);
        accountCache.set(key, result.rows[0].id);
        return result.rows[0].id;
      };

      const upsertAccount = async (item) => {
        const institutionCode = item.institutionCode || batch.sourceInstitutionCode;
        const institutionId = resolveInstitutionId(institutionCode, 'Account institution');
        const digest = createProtectedToken(item.sourceAccountRef, context.contextId, 'ACCOUNT', this.tokenSecret);
        const inserted = await run(`
          INSERT INTO ${this.schema}.bank_account
            (context_id, institution_id, account_token_digest, account_type, status, opened_at, closed_at, source_record_hash)
          VALUES ($1::uuid, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8)
          ON CONFLICT (context_id, institution_id, account_token_digest) DO NOTHING
          RETURNING account_id::text AS id
        `, [context.contextId, institutionId, digest, item.accountType, item.status, item.openedAt, item.closedAt, item.sourceRecordHash]);
        if (inserted.rows[0]) {
          accountCache.set(`${String(institutionCode).toUpperCase()}|${item.sourceAccountRef}`, inserted.rows[0].id);
          return inserted.rows[0].id;
        }
        const existing = await run(`
          SELECT account_id::text AS id, source_record_hash AS "sourceRecordHash"
          FROM ${this.schema}.bank_account
          WHERE context_id = $1::uuid AND institution_id = $2 AND account_token_digest = $3
        `, [context.contextId, institutionId, digest]);
        if (!existing.rows[0]) reject('The account could not be read after the idempotent insert.', 409);
        if (existing.rows[0].sourceRecordHash !== item.sourceRecordHash) reject('Conflicting source record for a protected account.', 409);
        accountCache.set(`${String(institutionCode).toUpperCase()}|${item.sourceAccountRef}`, existing.rows[0].id);
        return existing.rows[0].id;
      };

      const accountIds = new Map();
      for (const item of batch.records.accounts) {
        accountIds.set(`${String(item.institutionCode || batch.sourceInstitutionCode).toUpperCase()}|${item.sourceAccountRef}`, await upsertAccount(item));
      }

      const resolveIdentity = async (item) => {
        const institutionCode = item.institutionCode || batch.sourceInstitutionCode;
        const institutionId = resolveInstitutionId(institutionCode, 'Identity institution');
        const accountId = accountIds.get(`${String(institutionCode).toUpperCase()}|${item.sourceAccountRef}`)
          || await resolveAccount(item.sourceAccountRef, institutionCode);
        const digest = createProtectedToken(item.normalizedValue, context.contextId, item.fieldType, this.tokenSecret);
        const key = `${institutionId}|${item.fieldType}|${digest}`;
        let identityId = identityCache.get(key);
        if (!identityId) {
          const inserted = await run(`
            INSERT INTO ${this.schema}.identity_token
              (context_id, source_institution_id, token_type, token_digest, matching_basis, confidence_score, source_record_hash)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (context_id, source_institution_id, token_type, token_digest) DO NOTHING
            RETURNING party_token_id::text AS id
          `, [context.contextId, institutionId, item.fieldType, digest, item.matchingBasis, item.confidenceScore, item.sourceRecordHash]);
          identityId = inserted.rows[0]?.id;
          if (!identityId) {
            const existing = await run(`
              SELECT party_token_id::text AS id, source_record_hash AS "sourceRecordHash"
              FROM ${this.schema}.identity_token
              WHERE context_id = $1::uuid AND source_institution_id = $2 AND token_type = $3 AND token_digest = $4
            `, [context.contextId, institutionId, item.fieldType, digest]);
            if (!existing.rows[0]) reject('The identity token could not be read after the idempotent insert.', 409);
          if (existing.rows[0].sourceRecordHash !== item.sourceRecordHash) reject('Conflicting source record for a protected identity token.', 409);
            identityId = existing.rows[0].id;
          }
          identityCache.set(key, identityId);
        }
        await run(`
          INSERT INTO ${this.schema}.account_party (account_id, party_token_id, relationship_type, confidence_score)
          VALUES ($1::uuid, $2::uuid, $3, $4)
          ON CONFLICT (account_id, party_token_id, relationship_type) DO UPDATE SET confidence_score = EXCLUDED.confidence_score
        `, [accountId, identityId, item.relationshipType, item.confidenceScore]);
        return { id: identityId, accountId };
      };

      const deviceIds = new Map();
      for (const item of batch.records.devices) {
        const digest = createProtectedToken(item.sourceDeviceRef, context.contextId, 'DEVICE', this.tokenSecret);
        const key = `${String(sourceInstitution.id)}|${item.sourceDeviceRef}`;
        const inserted = await run(`
          INSERT INTO ${this.schema}.device_token
            (context_id, source_institution_id, device_token_digest, device_type, os_family, manufacturer, source_record_hash)
          VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (context_id, source_institution_id, device_token_digest) DO NOTHING
          RETURNING device_id::text AS id
        `, [context.contextId, sourceInstitution.id, digest, item.deviceType, item.osFamily, item.manufacturer, item.sourceRecordHash]);
        let deviceId = inserted.rows[0]?.id;
        if (!deviceId) {
          const existing = await run(`SELECT device_id::text AS id, source_record_hash AS "sourceRecordHash" FROM ${this.schema}.device_token WHERE context_id = $1::uuid AND source_institution_id = $2 AND device_token_digest = $3`, [context.contextId, sourceInstitution.id, digest]);
          if (!existing.rows[0]) reject('The device token could not be read after the idempotent insert.', 409);
          if (existing.rows[0].sourceRecordHash !== item.sourceRecordHash) reject('Conflicting source record for a protected device token.', 409);
          deviceId = existing.rows[0].id;
        }
        deviceIds.set(key, deviceId);
      }

      const networkIds = new Map();
      for (const item of batch.records.networks) {
        const digest = createProtectedToken(item.sourceNetworkRef, context.contextId, 'NETWORK', this.tokenSecret);
        const key = `${String(sourceInstitution.id)}|${item.sourceNetworkRef}`;
        const inserted = await run(`
          INSERT INTO ${this.schema}.network_token
            (context_id, source_institution_id, network_token_digest, network_type, country_code, isp_name, source_record_hash)
          VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (context_id, source_institution_id, network_token_digest) DO NOTHING
          RETURNING network_id::text AS id
        `, [context.contextId, sourceInstitution.id, digest, item.networkType, item.countryCode, item.ispName, item.sourceRecordHash]);
        let networkId = inserted.rows[0]?.id;
        if (!networkId) {
          const existing = await run(`SELECT network_id::text AS id, source_record_hash AS "sourceRecordHash" FROM ${this.schema}.network_token WHERE context_id = $1::uuid AND source_institution_id = $2 AND network_token_digest = $3`, [context.contextId, sourceInstitution.id, digest]);
          if (!existing.rows[0]) reject('The network token could not be read after the idempotent insert.', 409);
          if (existing.rows[0].sourceRecordHash !== item.sourceRecordHash) reject('Conflicting source record for a protected network token.', 409);
          networkId = existing.rows[0].id;
        }
        networkIds.set(key, networkId);
      }

      for (const item of batch.records.identities) await resolveIdentity(item);

      const transactionIds = new Map();
      const parentLinks = [];
      for (const item of batch.records.transactions) {
        const senderInstitutionCode = item.senderInstitutionCode || batch.sourceInstitutionCode;
        const receiverInstitutionCode = item.receiverInstitutionCode || batch.sourceInstitutionCode;
        const senderId = await resolveAccount(item.sourceAccountRef, senderInstitutionCode, item.senderAccountId);
        const receiverId = await resolveAccount(item.receiverAccountRef, receiverInstitutionCode, item.receiverAccountId);
        const transactionReferenceToken = createProtectedToken(item.sourceRecordId, context.contextId, 'TRANSACTION_REFERENCE', this.tokenSecret);
        const inserted = await run(`
          INSERT INTO ${this.schema}.payment_transaction
            (context_id, source_institution_id, sender_account_id, receiver_account_id, transaction_reference_token,
             amount, currency_code, payment_rail, transaction_type, transaction_status, occurred_at, observed_at, source_record_hash, source_signature)
          VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12::timestamptz, $13, $14)
          ON CONFLICT (context_id, source_institution_id, source_record_hash) DO NOTHING
          RETURNING transaction_id::text AS id
        `, [context.contextId, sourceInstitution.id, senderId, receiverId, transactionReferenceToken, item.amount, item.currencyCode, item.paymentRail, item.transactionType, item.transactionStatus, item.occurredAt, item.observedAt, item.sourceRecordHash, item.sourceSignature]);
        let transactionId = inserted.rows[0]?.id;
        if (!transactionId) {
          const existing = await run(`SELECT transaction_id::text AS id, sender_account_id::text AS "senderId", receiver_account_id::text AS "receiverId" FROM ${this.schema}.payment_transaction WHERE context_id = $1::uuid AND source_institution_id = $2 AND source_record_hash = $3`, [context.contextId, sourceInstitution.id, item.sourceRecordHash]);
          if (!existing.rows[0]) reject('The transaction could not be read after the idempotent insert.', 409);
          if (existing.rows[0].senderId !== senderId || existing.rows[0].receiverId !== receiverId) reject('Conflicting source record for a protected transaction.', 409);
          transactionId = existing.rows[0].id;
        }
        transactionIds.set(item.sourceRecordId, transactionId);
        parentLinks.push([item, transactionId]);
        await run(`
          INSERT INTO ${this.schema}.case_transaction (case_id, transaction_id, relevance, added_by)
          VALUES ($1::uuid, $2::uuid, $3, $4)
          ON CONFLICT (case_id, transaction_id) DO UPDATE SET relevance = EXCLUDED.relevance
        `, [batch.caseId, transactionId, item.caseRelevance, actor.investigatorId]);
      }
      for (const [item, transactionId] of parentLinks) {
        if (!item.parentSourceRecordId) continue;
        const parentId = transactionIds.get(item.parentSourceRecordId);
        if (!parentId) reject('A parent transaction referenced by the batch was not included.', 422);
        await run(`UPDATE ${this.schema}.payment_transaction SET parent_transaction_id = $1::uuid WHERE transaction_id = $2::uuid`, [parentId, transactionId]);
      }

      for (const item of batch.records.observations) {
        const accountId = accountIds.get(`${batch.sourceInstitutionCode}|${item.sourceAccountRef}`) || await resolveAccount(item.sourceAccountRef, batch.sourceInstitutionCode);
        const deviceId = item.sourceDeviceRef ? deviceIds.get(`${String(sourceInstitution.id)}|${item.sourceDeviceRef}`) || null : null;
        const networkId = item.sourceNetworkRef ? networkIds.get(`${String(sourceInstitution.id)}|${item.sourceNetworkRef}`) || null : null;
        const transactionId = item.sourceRecordId ? transactionIds.get(item.sourceRecordId) || null : null;
        if (item.sourceDeviceRef && !deviceId) reject('Observation references an unknown protected device.', 422);
        if (item.sourceNetworkRef && !networkId) reject('Observation references an unknown protected network.', 422);
        if (item.sourceRecordId && !transactionId) reject('Observation references an unknown protected transaction.', 422);
        await run(`
          INSERT INTO ${this.schema}.account_observation
            (account_id, device_id, network_id, transaction_id, observed_at, confidence_score, source_record_hash)
          VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $6, $7)
        `, [accountId, deviceId, networkId, transactionId, item.observedAt, item.confidenceScore, item.sourceRecordHash]);
      }

      for (const item of batch.records.evidence) {
        let targetColumn = null;
        let targetId = null;
        if (item.transactionSourceRecordId) {
          targetColumn = 'transaction_id';
          targetId = transactionIds.get(item.transactionSourceRecordId) || null;
        } else if (item.accountSourceRef) {
          targetColumn = 'account_id';
          const institutionCode = item.accountInstitutionCode || batch.sourceInstitutionCode;
          targetId = accountIds.get(`${String(institutionCode).toUpperCase()}|${item.accountSourceRef}`)
            || await resolveAccount(item.accountSourceRef, institutionCode);
        } else if (item.deviceSourceRef) {
          targetColumn = 'device_id';
          targetId = deviceIds.get(`${String(sourceInstitution.id)}|${item.deviceSourceRef}`) || null;
        } else if (item.networkSourceRef) {
          targetColumn = 'network_id';
          targetId = networkIds.get(`${String(sourceInstitution.id)}|${item.networkSourceRef}`) || null;
        }
        if (!targetColumn || !targetId) reject('Evidence references an unknown protected record.', 422);
        const evidenceResult = await run(`
          INSERT INTO ${this.schema}.evidence_record
            (case_id, source_institution_id, ${targetColumn}, evidence_type, source_record_hash, content_commitment, captured_at, integrity_status, captured_by)
          VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7::timestamptz, $8, $9)
          RETURNING evidence_id::text AS id
        `, [batch.caseId, sourceInstitution.id, targetId, item.evidenceType, item.sourceRecordHash, item.contentCommitment, item.capturedAt, item.integrityStatus, actor.investigatorId]);
        item.targetId = evidenceResult.rows[0]?.id || null;
      }

      const ingestionRows = [
        ...batch.records.accounts.map((item) => ({ type: 'ACCOUNT', hash: item.sourceRecordHash, target: accountIds.get(`${String(item.institutionCode || batch.sourceInstitutionCode).toUpperCase()}|${item.sourceAccountRef}`) })),
        ...batch.records.identities.map((item) => ({ type: 'IDENTITY', hash: item.sourceRecordHash, target: identityCache.get(`${resolveInstitutionId(item.institutionCode || batch.sourceInstitutionCode, 'Identity institution')}|${item.fieldType}|${createProtectedToken(item.normalizedValue, context.contextId, item.fieldType, this.tokenSecret)}`) })),
        ...batch.records.devices.map((item) => ({ type: 'DEVICE', hash: item.sourceRecordHash, target: deviceIds.get(`${String(sourceInstitution.id)}|${item.sourceDeviceRef}`) })),
        ...batch.records.networks.map((item) => ({ type: 'NETWORK', hash: item.sourceRecordHash, target: networkIds.get(`${String(sourceInstitution.id)}|${item.sourceNetworkRef}`) })),
        ...batch.records.transactions.map((item) => ({ type: 'TRANSACTION', hash: item.sourceRecordHash, target: transactionIds.get(item.sourceRecordId) })),
        ...batch.records.observations.map((item) => ({ type: 'OBSERVATION', hash: item.sourceRecordHash, target: null })),
        ...batch.records.evidence.map((item) => ({ type: 'EVIDENCE', hash: item.sourceRecordHash, target: item.targetId }))
      ];
      for (const row of ingestionRows) {
        const inserted = await run(`
          INSERT INTO ${this.schema}.source_ingestion_record
            (batch_id, source_institution_id, context_id, record_type, source_record_hash, target_id)
          VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6)
          ON CONFLICT (source_institution_id, context_id, record_type, source_record_hash) DO NOTHING
          RETURNING ingestion_record_id
        `, [storedBatch.batchId, sourceInstitution.id, context.contextId, row.type, row.hash, row.target ? String(row.target) : null]);
        if (!inserted.rows[0]) reject('A source record with the same commitment already exists in this token context.', 409);
      }

      const counts = {
        accounts: batch.records.accounts.length,
        identities: batch.records.identities.length,
        devices: batch.records.devices.length,
        networks: batch.records.networks.length,
        transactions: batch.records.transactions.length,
        observations: batch.records.observations.length,
        evidence: batch.records.evidence.length
      };
      await run(`UPDATE ${this.schema}.source_ingestion_batch SET status = 'APPLIED', completed_at = now() WHERE batch_id = $1::uuid`, [storedBatch.batchId]);
      await run(`
        INSERT INTO ${this.schema}.audit_event (case_id, actor_investigator_id, event_type, target_type, target_id, event_payload)
        VALUES ($1::uuid, $2, 'DATA_INGESTED', 'INGESTION_BATCH', $3, $4::jsonb)
      `, [batch.caseId, actor.investigatorId, storedBatch.batchId, JSON.stringify({ batchReference: batch.batchReference, sourceInstitutionCode: batch.sourceInstitutionCode, recordCount: batch.recordCount, counts, payloadHash: batch.payloadHash })]);
      return {
        status: 'APPLIED',
        batchId: storedBatch.batchId,
        caseId: batch.caseId,
        contextId: context.contextId,
        sourceInstitutionCode: batch.sourceInstitutionCode,
        recordCount: batch.recordCount,
        counts,
        payloadHash: batch.payloadHash,
        createdAt: storedBatch.createdAt
      };
    });
  }

  async listIngestionBatches(caseId = null) {
    const values = [];
    const where = caseId ? 'WHERE sib.case_id = $1::uuid' : '';
    if (caseId) values.push(caseId);
    const { rows } = await this.query(`
      SELECT sib.batch_id::text AS id, sib.case_id::text AS "caseId", sib.context_id::text AS "contextId", i.institution_code AS "sourceInstitutionCode",
             sib.batch_reference AS "batchReference", sib.source_system AS "sourceSystem", sib.payload_hash AS "payloadHash",
             sib.record_count AS "recordCount", sib.status, sib.created_at AS "createdAt", sib.completed_at AS "completedAt"
      FROM ${this.schema}.source_ingestion_batch sib
      JOIN ${this.schema}.institution i ON i.institution_id = sib.source_institution_id
      ${where}
      ORDER BY sib.created_at DESC
    `, values);
    return rows;
  }

  async session() {
    const current = this.currentActor();
    const { rows } = await this.query(`
      SELECT inv.investigator_id::text AS id, inv.display_name AS "displayName", inv.role_code AS role,
             inv.institution_id AS "institutionId", institution.institution_name AS institution, inv.status
      FROM ${this.schema}.investigator inv
      JOIN ${this.schema}.institution institution ON institution.institution_id = inv.institution_id
      WHERE inv.investigator_id = $1
    `, [current.investigatorId]);
    const approverResult = await this.query(`
      SELECT inv.investigator_id::text AS id, inv.display_name AS "displayName", inv.role_code AS role,
             inv.institution_id AS "institutionId", institution.institution_name AS institution, inv.status
      FROM ${this.schema}.investigator inv
      JOIN ${this.schema}.institution institution ON institution.institution_id = inv.institution_id
      WHERE inv.role_code IN ('SUPERVISOR', 'AUDITOR', 'ADMIN') AND inv.status = 'ACTIVE'
      ORDER BY inv.role_code, inv.display_name
    `);
    return {
      investigator: rows[0] || { id: String(current.investigatorId), displayName: 'Protected investigator', role: 'INVESTIGATOR', institutionId: current.institutionId, institution: 'Protected institution', status: 'ACTIVE' },
      approvers: approverResult.rows,
      capabilities: { canTrace: true, canRequestReveal: true, canApproveReveal: ['SUPERVISOR', 'AUDITOR', 'ADMIN'].includes(rows[0]?.role), canManageCase: rows[0]?.role !== 'AUDITOR', canExportReport: true }
    };
  }

  async createTokenContextInTransaction(client, caseId, actor) {
    const run = (text, values = []) => client.query(text, values);
    const actorId = Number(actor.investigatorId);
    const caseResult = await run(`
      SELECT case_id::text AS id, purpose_code AS purpose, status, expires_at AS "caseExpiresAt"
      FROM ${this.schema}.fraud_case
      WHERE case_id = $1::uuid
      FOR UPDATE
    `, [caseId]);
    const caseRow = caseResult.rows[0];
    if (!caseRow || ['CLOSED', 'REVOKED'].includes(caseRow.status) || new Date(caseRow.caseExpiresAt).getTime() <= Date.now()) {
      const error = new Error('The investigator has no active access to this case, or the case has expired.');
      error.status = 403;
      throw error;
    }
    const access = await run(`
      SELECT access_level
      FROM ${this.schema}.case_access
      WHERE case_id = $1::uuid
        AND investigator_id = $2
        AND revoked_at IS NULL
        AND expires_at > now()
      LIMIT 1
    `, [caseId, actorId]);
    if (!access.rows[0]) {
      const error = new Error('The investigator has no active access to this case, or the case has expired.');
      error.status = 403;
      throw error;
    }
    await run(`
      UPDATE ${this.schema}.token_context
      SET status = 'EXPIRED', expires_at = LEAST(expires_at, now())
      WHERE case_id = $1::uuid AND status = 'ACTIVE'
    `, [caseId]);
    const latest = await run(`SELECT coalesce(max(epoch_no), -1)::int AS "epochNo" FROM ${this.schema}.token_context WHERE case_id = $1::uuid`, [caseId]);
    const epochNo = Number(latest.rows[0]?.epochNo ?? -1) + 1;
    const inserted = await run(`
      INSERT INTO ${this.schema}.token_context
        (case_id, epoch_no, token_version, purpose_code, context_fingerprint, created_by, expires_at)
      VALUES ($1::uuid, $2, 1, $3, encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'), $4, LEAST($5::timestamptz, now() + interval '14 days'))
      RETURNING context_id::text AS id, case_id::text AS "caseId", epoch_no AS "epochNo", token_version AS "tokenVersion", purpose_code AS purpose, status, created_at AS "createdAt", expires_at AS "expiresAt"
    `, [caseId, epochNo, caseRow.purpose, actorId, caseRow.caseExpiresAt]);
    const context = inserted.rows[0];
    if (context) {
      await run(`
        INSERT INTO ${this.schema}.audit_event (case_id, actor_investigator_id, event_type, target_type, target_id, event_payload)
        VALUES ($1::uuid, $2, 'TOKEN_CONTEXT_CREATED', 'TOKEN_CONTEXT', $3, $4::jsonb)
      `, [caseId, actorId, context.id, JSON.stringify({ epochNo: context.epochNo, tokenVersion: context.tokenVersion, expiresAt: context.expiresAt })]);
    }
    return context;
  }

  async createTokenContext(caseId) {
    return this.withTransaction((client, actor) => this.createTokenContextInTransaction(client, caseId, actor));
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

  async createCase(input = {}) {
    return this.withTransaction(async (client, actor) => {
      const run = (text, values = []) => client.query(text, values);
      const actorId = Number(actor.investigatorId);
      const inserted = await run(`
        INSERT INTO ${this.schema}.fraud_case
          (case_reference, opened_by, severity, purpose_code, description, case_nonce_commitment, expires_at)
        VALUES ($1, $2, $3, $4, $5, encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'), now() + interval '14 days')
        RETURNING case_id::text AS id, case_reference AS "caseReference", description, severity, status, purpose_code AS purpose, opened_at AS "openedAt", expires_at AS "expiresAt"
      `, [input.caseReference, actorId, input.severity || 'MEDIUM', input.purpose || 'FRAUD_INVESTIGATION', input.description || 'New investigation case']);
      const created = inserted.rows[0];
      if (!created) return null;
      await run(`
        INSERT INTO ${this.schema}.case_access (case_id, investigator_id, access_level, granted_by, expires_at)
        VALUES ($1::uuid, $2, 'INVESTIGATOR', $2, $3::timestamptz)
        ON CONFLICT (case_id, investigator_id) DO NOTHING
      `, [created.id, actorId, created.expiresAt]);
      await run(`
        INSERT INTO ${this.schema}.audit_event (case_id, actor_investigator_id, event_type, target_type, target_id, event_payload)
        VALUES ($1::uuid, $2, 'CASE_CREATED', 'FRAUD_CASE', $3, $4::jsonb)
      `, [created.id, actorId, created.caseReference, JSON.stringify({ purpose: created.purpose, severity: created.severity })]);
      await this.createTokenContextInTransaction(client, created.id, actor);
      return created;
    });
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
    const actorId = this.currentActor().investigatorId;
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
      `, [caseId, actorId, caseId, JSON.stringify({ status: input.status })]);
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
    const actorId = this.currentActor().investigatorId;
    const { rows } = await this.query(`
      INSERT INTO ${this.schema}.case_note (case_id, author_investigator_id, note_body)
      VALUES ($1::uuid, $2, $3)
      RETURNING note_id::text AS id, case_id::text AS "caseId", author_investigator_id::text AS "authorId", note_body AS body, created_at AS "createdAt"
    `, [caseId, actorId, input.body]);
    const note = rows[0] || null;
    if (note) {
      const session = await this.session();
      note.authorName = session.investigator?.displayName || 'Protected investigator';
      await this.query(`
        INSERT INTO ${this.schema}.audit_event (case_id, actor_investigator_id, event_type, target_type, target_id, event_payload)
        VALUES ($1::uuid, $2, 'NOTE_ADDED', 'CASE_NOTE', $3, $4::jsonb)
      `, [caseId, actorId, note.id, JSON.stringify({ characterCount: String(input.body || '').length })]);
    }
    return note;
  }

  async traceCase(caseId, input = {}) {
    const actorId = this.currentActor().investigatorId;
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
    `, [pathId, caseId, start, endAccount, enrichedRows.length, riskScore, certificateHash, actorId]);
    for (const hop of enrichedRows) {
      await this.query(`
        INSERT INTO ${this.schema}.path_hop (path_id, hop_no, transaction_id, from_account_id, to_account_id, amount_bucket, temporal_gap_seconds, hop_risk_score, provenance_hash)
        VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9)
      `, [pathId, hop.hopNo, hop.transactionId, hop.fromAccountId, hop.toAccountId, hop.amountBucket, hop.temporalGapSeconds, hop.riskScore, crypto.createHash('sha256').update(`${pathId}|${hop.hopNo}|${hop.transactionId}`).digest('hex')]);
    }
    await this.query(`
      INSERT INTO ${this.schema}.audit_event (case_id, actor_investigator_id, event_type, target_type, target_id, event_payload)
      VALUES ($1::uuid, $2, 'TRACE_EXECUTED', 'FUND_PATH', $3, $4::jsonb)
      `, [caseId, actorId, pathId, JSON.stringify({ startAccountId: start, hopCount: enrichedRows.length, certificateHash })]);
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
    const actorId = this.currentActor().investigatorId;
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
    `, [input.caseId, input.requestedBy || actorId, targetAccountId, JSON.stringify(input.requestedFields || ['account holder name']), input.reason]);
    const created = rows[0];
    if (created) {
      await this.query(`
        INSERT INTO ${this.schema}.audit_event (case_id, actor_investigator_id, event_type, target_type, target_id, event_payload)
        VALUES ($1::uuid, $2, 'REVEAL_REQUESTED', 'REVEAL_REQUEST', $3, $4::jsonb)
      `, [created.caseId, input.requestedBy || actorId, created.id, JSON.stringify({ requestedFields: input.requestedFields || ['account holder name'], reason: input.reason })]);
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
  const config = assertRuntimeConfig(getRuntimeConfig());
  if (config.dataMode === 'postgres') return new PostgresRepository();
  return new MockRepository();
}
