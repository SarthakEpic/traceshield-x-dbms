import crypto from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function header(headers, name) {
  const target = name.toLowerCase();
  const key = Object.keys(headers || {}).find((candidate) => candidate.toLowerCase() === target);
  return String(key ? headers[key] : '').trim();
}

export function signAdapterRequest(body, secret, options = {}) {
  const timestamp = String(options.timestamp || Math.floor(Date.now() / 1000));
  const nonce = String(options.nonce || crypto.randomBytes(16).toString('hex'));
  const payload = `${timestamp}.${nonce}.${canonicalize(body)}`;
  const signature = crypto.createHmac('sha256', String(secret || '')).update(payload).digest('hex');
  return {
    'X-TraceShield-Adapter-Timestamp': timestamp,
    'X-TraceShield-Adapter-Nonce': nonce,
    'X-TraceShield-Adapter-Signature': `sha256=${signature}`
  };
}

export function verifyAdapterRequest(body, headers, secret, options = {}) {
  const timestampText = header(headers, 'x-traceshield-adapter-timestamp');
  const nonce = header(headers, 'x-traceshield-adapter-nonce');
  const supplied = header(headers, 'x-traceshield-adapter-signature');
  const timestamp = Number(timestampText);
  const nowSeconds = Number(options.nowSeconds || Math.floor(Date.now() / 1000));
  const maxAgeSeconds = Number(options.maxAgeSeconds || 300);
  if (!secret || !Number.isInteger(timestamp) || !nonce || !/^sha256=[0-9a-f]{64}$/i.test(supplied)) {
    return { ok: false, reason: 'missing or malformed adapter signature' };
  }
  if (Math.abs(nowSeconds - timestamp) > maxAgeSeconds) return { ok: false, reason: 'adapter signature expired' };
  const nonceCache = options.nonceCache;
  if (nonceCache?.has(nonce)) return { ok: false, reason: 'adapter nonce replayed' };
  const payload = `${timestamp}.${nonce}.${canonicalize(body)}`;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return { ok: false, reason: 'adapter signature mismatch' };
  }
  if (nonceCache) {
    nonceCache.set(nonce, (nowSeconds + maxAgeSeconds) * 1000);
    for (const [key, expiresAt] of nonceCache) {
      if (expiresAt <= nowSeconds * 1000) nonceCache.delete(key);
    }
  }
  return { ok: true };
}

export { canonicalize };
