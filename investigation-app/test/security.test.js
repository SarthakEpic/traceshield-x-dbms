import test from 'node:test';
import assert from 'node:assert/strict';
import { signAdapterRequest, verifyAdapterRequest } from '../adapter-security.js';
import { getRuntimeConfig, validateRuntimeConfig } from '../runtime-config.js';
import { createFixedWindowRateLimiter } from '../security.js';

test('adapter signatures verify, expire, and reject nonce replay', () => {
  const body = { b: 2, a: ['protected', 4] };
  const secret = 'adapter-secret-that-is-at-least-32-characters';
  const nonceCache = new Map();
  const headers = signAdapterRequest(body, secret, { timestamp: 1_700_000_000, nonce: 'nonce-001' });
  const first = verifyAdapterRequest(body, headers, secret, { nowSeconds: 1_700_000_100, nonceCache });
  assert.equal(first.ok, true);
  const replay = verifyAdapterRequest(body, headers, secret, { nowSeconds: 1_700_000_100, nonceCache });
  assert.equal(replay.ok, false);
  const expired = verifyAdapterRequest(body, signAdapterRequest(body, secret, { timestamp: 1_699_999_000, nonce: 'nonce-002' }), secret, { nowSeconds: 1_700_000_000, nonceCache: new Map() });
  assert.equal(expired.ok, false);
});

test('runtime configuration fails closed for production and PostgreSQL auth bypass', () => {
  const production = getRuntimeConfig({ NODE_ENV: 'production', DATA_MODE: 'postgres', AUTH_MODE: 'session', DATABASE_URL: 'postgresql://app@localhost/db', TRACESHIELD_TOKEN_SECRET: 'a'.repeat(32), TRACESHIELD_ADAPTER_SIGNING_SECRET: 'b'.repeat(32), ALLOW_ORIGIN: 'https://console.example' });
  assert.deepEqual(validateRuntimeConfig(production).errors, []);

  const unsafe = getRuntimeConfig({ NODE_ENV: 'production', DATA_MODE: 'postgres', AUTH_MODE: 'env', DATABASE_URL: 'postgresql://postgres@localhost/db', TRACESHIELD_TOKEN_SECRET: 'short' });
  const errors = validateRuntimeConfig(unsafe).errors.join(' ');
  assert.match(errors, /AUTH_MODE=env/);
  assert.match(errors, /ADAPTER_SIGNING_SECRET/);
  assert.match(errors, /ALLOW_ORIGIN/);
  assert.match(errors, /superuser/);
});

test('console ingestion is a development-only helper and production rejects it', () => {
  const development = getRuntimeConfig({ NODE_ENV: 'development', DATA_MODE: 'postgres', AUTH_MODE: 'session', DATABASE_URL: 'postgresql://app@localhost/db', TRACESHIELD_TOKEN_SECRET: 'a'.repeat(32), TRACESHIELD_ADAPTER_SIGNING_SECRET: 'b'.repeat(32) });
  assert.equal(development.enableConsoleIngestion, true);
  const production = getRuntimeConfig({ NODE_ENV: 'production', DATA_MODE: 'postgres', AUTH_MODE: 'session', DATABASE_URL: 'postgresql://app@localhost/db', TRACESHIELD_TOKEN_SECRET: 'a'.repeat(32), TRACESHIELD_ADAPTER_SIGNING_SECRET: 'b'.repeat(32), ALLOW_ORIGIN: 'https://console.example', ENABLE_CONSOLE_INGESTION: 'true' });
  assert.match(validateRuntimeConfig(production).errors.join(' '), /ENABLE_CONSOLE_INGESTION/);
});

test('fixed-window limiter returns retry metadata after the configured ceiling', () => {
  const limiter = createFixedWindowRateLimiter({ windowMs: 60_000, max: 2, keyFn: () => 'security-test' });
  const makeResponse = () => ({
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  });
  const first = makeResponse();
  const second = makeResponse();
  const third = makeResponse();
  let nextCalls = 0;
  limiter({ ip: '127.0.0.1' }, first, () => { nextCalls += 1; });
  limiter({ ip: '127.0.0.1' }, second, () => { nextCalls += 1; });
  limiter({ ip: '127.0.0.1' }, third, () => { nextCalls += 1; });
  assert.equal(nextCalls, 2);
  assert.equal(third.statusCode, 429);
  assert.equal(third.headers['Retry-After'] > 0, true);
  assert.equal(third.body.error.includes('Too many requests'), true);
});
