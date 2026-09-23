import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Test server exited with code ${child.exitCode}`);
    try {
      const result = await request(baseUrl, '/api/health');
      if (result.response.ok) return result;
    } catch {
      // The server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the test server');
}

test('mock HTTP workflow enforces privacy, dual control, notes, and report safety', async () => {
  const port = 46000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: appDir,
    env: { ...process.env, DATA_MODE: 'mock', DATABASE_URL: '', PORT: String(port) },
    stdio: 'ignore'
  });

  try {
    const health = await waitForHealth(baseUrl, child);
    assert.equal(health.body.mode, 'mock');
    assert.equal(health.response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(health.response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);

    const session = await request(baseUrl, '/api/session');
    assert.equal(session.body.investigator.role, 'INVESTIGATOR');
    assert.equal(session.body.approvers.length, 2);

    const cases = await request(baseUrl, '/api/cases?sort=risk');
    assert.equal(cases.response.status, 200);
    const caseId = cases.body[0].id;

    const analysis = await request(baseUrl, `/api/cases/${caseId}/analysis`);
    assert.equal(analysis.body.privacy.policy, 'MINIMUM_NECESSARY_DISCLOSURE');
    assert.ok(analysis.body.graph.nodes.length >= 2);

    const malformedApprover = await request(baseUrl, '/api/reveal-requests/70000000-0000-4000-8000-000000000001/approve', {
      method: 'POST',
      body: JSON.stringify({ approverId: 'browser-supplied-name', decision: 'APPROVE' })
    });
    assert.equal(malformedApprover.response.status, 400);

    const unsupportedField = await request(baseUrl, '/api/reveal-requests', {
      method: 'POST',
      body: JSON.stringify({
        caseId,
        target: 'Receiving account',
        reason: 'Need a documented protected field for the next action.',
        requestedFields: ['raw account number']
      })
    });
    assert.equal(unsupportedField.response.status, 400);

    const outOfScopeTarget = await request(baseUrl, '/api/reveal-requests', {
      method: 'POST',
      body: JSON.stringify({
        caseId,
        targetAccountId: '99999999-9999-4999-8999-999999999999',
        target: 'Unscoped account',
        reason: 'Need a documented protected field for the next action.',
        requestedFields: ['account holder name']
      })
    });
    assert.equal(outOfScopeTarget.response.status, 400);

    const overbroad = await request(baseUrl, '/api/reveal-requests', {
      method: 'POST',
      body: JSON.stringify({
        caseId,
        target: 'Receiving account',
        reason: 'Identify the receiving account for recovery coordination.',
        requestedFields: ['account holder name', 'registered mobile']
      })
    });
    assert.equal(overbroad.response.status, 400);
    assert.match(overbroad.body.error, /registered mobile/);

    const created = await request(baseUrl, '/api/reveal-requests', {
      method: 'POST',
      body: JSON.stringify({
        caseId,
        target: 'Receiving account',
        reason: 'Identify the receiving account for recovery coordination.',
        requestedFields: ['account holder name']
      })
    });
    assert.equal(created.response.status, 201);
    const requestId = created.body.id;

    const supervisorApproval = await request(baseUrl, `/api/reveal-requests/${requestId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approverId: '2', decision: 'APPROVE' })
    });
    assert.equal(supervisorApproval.response.status, 200);
    assert.equal(supervisorApproval.body.status, 'PENDING');

    const auditorApproval = await request(baseUrl, `/api/reveal-requests/${requestId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approverId: '3', decision: 'APPROVE' })
    });
    assert.equal(auditorApproval.response.status, 200);
    assert.equal(auditorApproval.body.status, 'APPROVED');

    const note = await request(baseUrl, `/api/cases/${caseId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Follow-up requested from the receiving institution.' })
    });
    assert.equal(note.response.status, 201);
    assert.equal(note.body.authorName, 'A. Singh');

    const updated = await request(baseUrl, `/api/cases/${caseId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'PAUSED' })
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.status, 'PAUSED');

    const report = await request(baseUrl, `/api/cases/${caseId}/report`);
    assert.equal(report.response.status, 200);
    assert.equal(report.body.privacy.rawIdentityIncluded, false);
    assert.equal('fromAccountId' in report.body.transactions[0], false);
    assert.ok(report.body.timeline.some((item) => item.eventType === 'NOTE_ADDED'));
  } finally {
    child.kill();
  }
});
