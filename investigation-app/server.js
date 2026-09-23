import express from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepository } from './repository.js';
import {
  buildCaseReport,
  buildInvestigationAnalysis,
  buildRevealRecommendation,
  buildTimeline,
  normalizeCaseUpdate,
  REVEAL_FIELD_KEYS
} from './investigation-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 4170);
const repository = createRepository();
const serviceVersion = '1.1.0';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

app.disable('x-powered-by');
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
  if (!origin || origin === allowedOrigin || origin === `http://127.0.0.1:${port}`) res.setHeader('Access-Control-Allow-Origin', origin || allowedOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { etag: false, maxAge: 0 }));

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
    res.json({ ...(await repository.health()), serviceVersion });
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
