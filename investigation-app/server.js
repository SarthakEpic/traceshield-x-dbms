import express from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { actorContext, createRepository } from './repository.js';
import {
  buildCaseReport,
  buildInvestigationAnalysis,
  buildRevealRecommendation,
  buildTimeline,
  normalizeCaseUpdate,
  REVEAL_FIELD_KEYS
} from './investigation-engine.js';
import { signAdapterRequest, verifyAdapterRequest } from './adapter-security.js';
import { assertRuntimeConfig, getRuntimeConfig } from './runtime-config.js';
import { createFixedWindowRateLimiter } from './security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const runtimeConfig = assertRuntimeConfig(getRuntimeConfig());
const port = runtimeConfig.port;
const repository = createRepository();
const serviceVersion = '1.1.0';
const authMode = runtimeConfig.authMode;
const sessionCookieName = 'traceshield_session';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const adapterNonces = new Map();

app.disable('x-powered-by');
app.set('trust proxy', runtimeConfig.trustProxy);
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  req.requestId = String(req.headers['x-request-id'] || randomUUID());
  res.setHeader('X-Request-Id', req.requestId);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
  const origin = req.headers.origin;
  const allowedOrigin = process.env.ALLOW_ORIGIN || `http://localhost:${port}`;
  const allowedOrigins = new Set([allowedOrigin, `http://127.0.0.1:${port}`]);
  if (!origin || allowedOrigins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin || allowedOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id, X-TraceShield-Adapter-Timestamp, X-TraceShield-Adapter-Nonce, X-TraceShield-Adapter-Signature');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (authMode === 'session' && origin && !allowedOrigins.has(origin) && !['GET', 'HEAD'].includes(req.method)) {
    return res.status(403).json({ error: 'Origin is not allowed for this session request.', requestId: req.requestId });
  }
  next();
});

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { etag: false, maxAge: 0 }));

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  const pair = cookies.map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : '';
}

function requestSessionToken(req) {
  const authorization = String(req.headers.authorization || '');
  if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, '').trim();
  return cookieValue(req, sessionCookieName);
}

function setSessionCookie(res, token, maxAgeSeconds = 8 * 60 * 60) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${sessionCookieName}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; HttpOnly; Path=/; SameSite=Lax${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${sessionCookieName}=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax`);
}

app.use('/api', async (req, res, next) => {
  const publicRoute = req.path === '/health' || req.path === '/auth/login' || req.path === '/auth/session' || req.path === '/auth/logout';
  if (publicRoute || authMode !== 'session') return next();
  if (repository.mode !== 'postgres') return res.status(503).json({ error: 'Session authentication requires PostgreSQL mode.', requestId: req.requestId });
  try {
    const actor = await repository.sessionFromToken(requestSessionToken(req));
    if (!actor) return res.status(401).json({ error: 'Authentication required.', requestId: req.requestId });
    req.auth = actor;
    return actorContext.run(actor, next);
  } catch (error) {
    next(error);
  }
});

app.use('/api/auth/login', createFixedWindowRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  keyFn: (req) => req.ip || req.socket?.remoteAddress || 'unknown'
}));

app.use('/api', createFixedWindowRateLimiter({
  windowMs: 60 * 1000,
  max: 180,
  keyFn: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
  skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method)
}));

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function requireField(body, field) {
  if (!body || typeof body[field] !== 'string' || body[field].trim() === '') {
    throw badRequest(`${field} is required`);
  }
  return body[field].trim();
}

function validateCaseId(caseId) {
  const value = String(caseId || '').trim();
  if (repository.mode === 'postgres' && !UUID_PATTERN.test(value)) throw badRequest('caseId must be a valid UUID');
  return value;
}

function caseAccountIds(detail) {
  return new Set([
    ...(detail?.transactions || []).flatMap((transaction) => [transaction.fromAccountId, transaction.toAccountId, transaction.from?.id, transaction.to?.id]),
    ...(detail?.paths || []).flatMap((path) => (path.hops || []).flatMap((hop) => [hop.fromAccountId, hop.toAccountId, hop.from?.id, hop.to?.id]))
  ].filter(Boolean).map(String));
}

app.param('caseId', (req, res, next, value) => {
  if (repository.mode === 'postgres' && !UUID_PATTERN.test(String(value))) {
    return res.status(400).json({ error: 'caseId must be a valid UUID', requestId: req.requestId });
  }
  next();
});

app.get('/api/health', async (req, res, next) => {
  try {
    res.json({
      ...(await repository.health()),
      serviceVersion,
      authMode,
      adapterSignatureRequired: runtimeConfig.requireAdapterSignature,
      consoleIngestionEnabled: runtimeConfig.enableConsoleIngestion
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    if (authMode !== 'session') return res.status(400).json({ error: 'Session login is disabled. Set AUTH_MODE=session to enable it.' });
    if (repository.mode !== 'postgres') return res.status(503).json({ error: 'Session authentication requires PostgreSQL mode.' });
    const loginName = requireField(req.body, 'loginName');
    const password = requireField(req.body, 'password');
    if (password.length < 12 || password.length > 256) throw badRequest('Password must contain between 12 and 256 characters.');
    const result = await repository.authenticate(loginName, password, req.headers['user-agent'] || '');
    if (!result) return res.status(401).json({ error: 'Invalid credentials or locked account.', requestId: req.requestId });
    setSessionCookie(res, result.token);
    res.json({ authenticated: true, investigator: result.investigator, expiresAt: result.expiresAt });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/session', async (req, res, next) => {
  try {
    if (authMode !== 'session') return res.json({ authenticated: true, authMode, ...(await repository.session()) });
    const actor = repository.mode === 'postgres' ? await repository.sessionFromToken(requestSessionToken(req)) : null;
    if (!actor) return res.status(401).json({ authenticated: false, authMode, requestId: req.requestId });
    return actorContext.run(actor, async () => res.json({ authenticated: true, authMode, ...(await repository.session()) }));
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    if (repository.mode === 'postgres') await repository.revokeSession(requestSessionToken(req));
    clearSessionCookie(res);
    res.json({ authenticated: false });
  } catch (error) {
    next(error);
  }
});

app.get('/api/session', async (req, res, next) => {
  try {
    res.json(await repository.session());
  } catch (error) {
    next(error);
  }
});

app.get('/api/dashboard', async (req, res, next) => {
  try {
    res.json(await repository.dashboard());
  } catch (error) {
    next(error);
  }
});

app.get('/api/institutions', async (req, res, next) => {
  try {
    if (repository.mode === 'mock') {
      const { mockData } = await import('./mock-data.js');
      return res.json(mockData.institutions);
    }
    const { rows } = await repository.query(`SELECT institution_id AS id, institution_code AS code, institution_name AS name, institution_type AS type FROM ${repository.schema}.institution WHERE status = 'ACTIVE' ORDER BY institution_name`);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get('/api/ingestion/batches', async (req, res, next) => {
  try {
    const caseId = req.query.caseId ? validateCaseId(req.query.caseId) : null;
    res.json(await repository.listIngestionBatches(caseId));
  } catch (error) {
    next(error);
  }
});

async function ingestBatchPayload(body, headers = {}) {
  const hasAdapterSignature = Boolean(headers['x-traceshield-adapter-signature'] || headers['X-TraceShield-Adapter-Signature']);
  if (runtimeConfig.requireAdapterSignature || hasAdapterSignature) {
    const verification = verifyAdapterRequest(body, headers, runtimeConfig.adapterSigningSecret, { nonceCache: adapterNonces });
    if (!verification.ok) {
      const error = new Error('A valid, fresh institution-adapter signature is required.');
      error.status = 401;
      throw error;
    }
  }
  return repository.ingestBatch(body);
}

function sendIngestionResult(res, result) {
  return res.status(result.status === 'DUPLICATE' || result.status === 'MOCK_VALIDATED' ? 200 : 201).json(result);
}

app.post('/api/ingestion/batches', async (req, res, next) => {
  try {
    sendIngestionResult(res, await ingestBatchPayload(req.body || {}, req.headers));
  } catch (error) {
    next(error);
  }
});

app.post('/api/ingestion/console', async (req, res, next) => {
  try {
    if (!runtimeConfig.enableConsoleIngestion) {
      const error = new Error('Console ingestion is disabled. Use the signed institution adapter endpoint.');
      error.status = 404;
      throw error;
    }
    const body = req.body || {};
    const signedHeaders = runtimeConfig.adapterSigningSecret
      ? signAdapterRequest(body, runtimeConfig.adapterSigningSecret)
      : {};
    sendIngestionResult(res, await ingestBatchPayload(body, signedHeaders));
  } catch (error) {
    next(error);
  }
});

app.get('/api/cases', async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim().toUpperCase();
    const severity = String(req.query.severity || '').trim().toUpperCase();
    const sort = String(req.query.sort || 'opened').toLowerCase();
    const cases = await repository.listCases();
    let filtered = query
      ? cases.filter((item) => `${item.caseReference} ${item.description} ${item.severity} ${item.status}`.toLowerCase().includes(query))
      : cases;
    if (status) filtered = filtered.filter((item) => item.status === status);
    if (severity) filtered = filtered.filter((item) => item.severity === severity);
    const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    filtered.sort((left, right) => sort === 'risk'
      ? Number(right.riskScore || 0) - Number(left.riskScore || 0)
      : sort === 'severity'
        ? (severityOrder[left.severity] ?? 9) - (severityOrder[right.severity] ?? 9)
        : new Date(right.openedAt || 0).getTime() - new Date(left.openedAt || 0).getTime());
    res.setHeader('X-Total-Count', String(filtered.length));
    res.json(filtered);
  } catch (error) {
    next(error);
  }
});

app.post('/api/cases', async (req, res, next) => {
  try {
    const caseReference = requireField(req.body, 'caseReference');
    const description = requireField(req.body, 'description');
    const severity = String(req.body.severity || 'MEDIUM').toUpperCase();
    const purpose = String(req.body.purpose || 'FRAUD_INVESTIGATION').toUpperCase();
    if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(severity)) throw badRequest('Invalid severity');
    if (!['FRAUD_INVESTIGATION', 'AML_REVIEW', 'RECOVERY', 'AUDIT'].includes(purpose)) throw badRequest('Invalid case purpose');
    if (caseReference.length > 120 || description.length > 2000) throw badRequest('Case reference or description is too long');
    const session = await repository.session();
    const created = await repository.createCase({ caseReference, description, severity, purpose, assignedTo: session.investigator?.displayName, openedBy: session.investigator?.id });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

app.post('/api/cases/:caseId/token-context', async (req, res, next) => {
  try {
    res.status(201).json(await repository.createTokenContext(req.params.caseId));
  } catch (error) {
    next(error);
  }
});

app.get('/api/cases/:caseId', async (req, res, next) => {
  try {
    const result = await repository.getCase(req.params.caseId);
    if (!result) return res.status(404).json({ error: 'Case not found' });
    res.json({ ...result, analysis: buildInvestigationAnalysis(result) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/cases/:caseId/analysis', async (req, res, next) => {
  try {
    const detail = await repository.getCase(req.params.caseId);
    if (!detail) return res.status(404).json({ error: 'Case not found' });
    res.json(buildInvestigationAnalysis(detail));
  } catch (error) {
    next(error);
  }
});

app.get('/api/cases/:caseId/timeline', async (req, res, next) => {
  try {
    const detail = await repository.getCase(req.params.caseId);
    if (!detail) return res.status(404).json({ error: 'Case not found' });
    const auditEvents = await repository.audit(req.params.caseId);
    res.json(buildTimeline(detail, auditEvents));
  } catch (error) {
    next(error);
  }
});

app.get('/api/cases/:caseId/report', async (req, res, next) => {
  try {
    const detail = await repository.getCase(req.params.caseId);
    if (!detail) return res.status(404).json({ error: 'Case not found' });
    const auditEvents = await repository.audit(req.params.caseId);
    const auditVerification = await repository.verifyAudit(req.params.caseId);
    res.json(buildCaseReport(detail, auditEvents, auditVerification));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/cases/:caseId', async (req, res, next) => {
  try {
    let update;
    try {
      update = normalizeCaseUpdate(req.body || {});
    } catch (error) {
      throw badRequest(error.message);
    }
    if (!Object.keys(update).length) throw badRequest('At least one case field must be updated');
    const updated = await repository.updateCase(req.params.caseId, update);
    if (!updated) return res.status(404).json({ error: 'Case not found' });
    const detail = await repository.getCase(req.params.caseId);
    res.json({ ...detail, analysis: buildInvestigationAnalysis(detail) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/cases/:caseId/notes', async (req, res, next) => {
  try {
    const detail = await repository.getCase(req.params.caseId);
    if (!detail) return res.status(404).json({ error: 'Case not found' });
    res.json(await repository.listNotes(req.params.caseId));
  } catch (error) {
    next(error);
  }
});

app.post('/api/cases/:caseId/notes', async (req, res, next) => {
  try {
    const body = requireField(req.body, 'body');
    if (body.length > 4000) throw badRequest('Note must be 4000 characters or fewer');
    const detail = await repository.getCase(req.params.caseId);
    if (!detail) return res.status(404).json({ error: 'Case not found' });
    const session = await repository.session();
    const note = await repository.addNote(req.params.caseId, { body, authorId: session.investigator?.id });
    res.status(201).json(note);
  } catch (error) {
    next(error);
  }
});

app.post('/api/cases/:caseId/trace', async (req, res, next) => {
  try {
    if (repository.mode === 'postgres' && req.body?.startAccountId && !UUID_PATTERN.test(String(req.body.startAccountId))) {
      throw badRequest('startAccountId must be a valid UUID');
    }
    const session = await repository.session();
    const result = await repository.traceCase(req.params.caseId, {
      startAccountId: req.body?.startAccountId,
      maxHops: Math.min(Math.max(Number(req.body?.maxHops || 5), 1), 10),
      actorName: session.investigator?.displayName
    });
    if (!result) return res.status(404).json({ error: 'Case not found' });
    const detail = await repository.getCase(req.params.caseId);
    res.json({ ...result, analysis: buildInvestigationAnalysis({ ...detail, paths: result.paths }) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/reveal-requests', async (req, res, next) => {
  try {
    const caseId = req.query.caseId ? validateCaseId(req.query.caseId) : null;
    res.json(await repository.listRevealRequests(caseId));
  } catch (error) {
    next(error);
  }
});

app.post('/api/reveal-requests', async (req, res, next) => {
  try {
    const caseId = validateCaseId(requireField(req.body, 'caseId'));
    const target = requireField(req.body, 'target');
    const reason = requireField(req.body, 'reason');
    const requestedFields = Array.isArray(req.body.requestedFields) && req.body.requestedFields.length > 0
      ? req.body.requestedFields.map((field) => String(field).trim().toLowerCase()).filter(Boolean).slice(0, 6)
      : ['account holder name'];
    const invalidFields = requestedFields.map((field) => field.trim().toLowerCase()).filter((field) => !REVEAL_FIELD_KEYS.includes(field));
    if (invalidFields.length) throw badRequest(`Unsupported reveal field: ${invalidFields[0]}`);
    const detail = await repository.getCase(caseId);
    if (!detail) return res.status(404).json({ error: 'Case not found' });
    if (req.body.targetAccountId && !caseAccountIds(detail).has(String(req.body.targetAccountId))) {
      throw badRequest('targetAccountId must belong to the selected case scope');
    }
    const recommendation = buildRevealRecommendation(detail, { requestedFields, reason });
    if (recommendation.unnecessaryFields.length && req.body.overrideMinimumDisclosure !== true) {
      throw badRequest(`Remove unnecessary fields before submission: ${recommendation.unnecessaryFields.join(', ')}`);
    }
    const session = await repository.session();
    const created = await repository.createRevealRequest({
      caseId,
      target,
      targetAccountId: req.body.targetAccountId,
      reason,
      requestedFields,
      createdBy: session.investigator?.displayName,
      requestedBy: session.investigator?.id
    });
    res.status(201).json({ ...created, recommendation });
  } catch (error) {
    next(error);
  }
});

app.post('/api/reveal-requests/:requestId/approve', async (req, res, next) => {
  try {
    const decision = String(req.body?.decision || 'APPROVE').toUpperCase();
    if (!['APPROVE', 'REJECT'].includes(decision)) throw badRequest('Decision must be APPROVE or REJECT');
    if (req.body?.approverId === undefined || req.body?.approverId === null || String(req.body.approverId).trim() === '') {
      throw badRequest('approverId is required');
    }
    const approverId = String(req.body.approverId).trim();
    if (!/^\d+$/.test(approverId)) throw badRequest('approverId must be numeric');
    const approver = await repository.getApprover(approverId);
    if (!approver) return res.status(403).json({ error: 'The selected approver is not an active supervisor, auditor, or administrator.' });
    const result = await repository.approveReveal(req.params.requestId, {
      decision,
      approverId: approver.id,
      approverName: approver.displayName,
      role: approver.role,
      reason: req.body?.reason
    });
    if (!result) return res.status(404).json({ error: 'Reveal request not found' });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/audit/verify', async (req, res, next) => {
  try {
    const caseId = validateCaseId(requireField(req.query, 'caseId'));
    res.json(await repository.verifyAudit(caseId));
  } catch (error) {
    next(error);
  }
});

app.get('/api/audit', async (req, res, next) => {
  try {
    const caseId = validateCaseId(requireField(req.query, 'caseId'));
    res.json(await repository.audit(caseId));
  } catch (error) {
    next(error);
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

app.use((error, req, res, next) => {
  const status = error.status || (error.code === '23505' ? 409 : error.code === '23503' ? 400 : 500);
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : error.message, requestId: req.requestId });
});

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`TraceShield X investigation app listening on http://localhost:${port}`);
  console.log(`Repository mode: ${repository.mode}`);
});
