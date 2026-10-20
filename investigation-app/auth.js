import crypto from 'node:crypto';

const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const KEY_LENGTH = 64;

function safeString(value) {
  return typeof value === 'string' ? value : '';
}

export function validatePassword(password) {
  const value = safeString(password);
  if (value.length < 12 || value.length > 256) {
    throw new Error('Password must contain between 12 and 256 characters.');
  }
  return value;
}

export function hashPassword(password) {
  const value = validatePassword(password);
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(value, salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024
  });
  return [
    'scrypt',
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString('base64url'),
    derivedKey.toString('base64url')
  ].join('$');
}

export function verifyPassword(password, encodedHash) {
  try {
    const [algorithm, cost, blockSize, parallelization, encodedSalt, encodedKey] = String(encodedHash || '').split('$');
    if (algorithm !== 'scrypt' || !encodedSalt || !encodedKey) return false;
    const salt = Buffer.from(encodedSalt, 'base64url');
    const expected = Buffer.from(encodedKey, 'base64url');
    const actual = crypto.scryptSync(safeString(password), salt, expected.length, {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallelization),
      maxmem: 64 * 1024 * 1024
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

export function hashUserAgent(userAgent) {
  return crypto.createHash('sha256').update(String(userAgent || '')).digest('hex');
}
