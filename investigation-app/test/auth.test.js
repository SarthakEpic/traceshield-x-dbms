import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from '../auth.js';

test('password verification supports the stored scrypt format without exposing the password', () => {
  const password = 'TraceShield-test-password-2026!';
  const encoded = hashPassword(password);
  assert.match(encoded, /^scrypt\$16384\$8\$1\$/);
  assert.equal(verifyPassword(password, encoded), true);
  assert.equal(verifyPassword('wrong-password', encoded), false);
  assert.notEqual(encoded, password);
});

test('session tokens are high entropy and only their digest is persisted', () => {
  const token = createSessionToken();
  assert.match(token, /^[A-Za-z0-9_-]{40,}$/);
  assert.match(hashSessionToken(token), /^[0-9a-f]{64}$/);
  assert.notEqual(hashSessionToken(token), token);
});
