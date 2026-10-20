import pg from 'pg';
import { hashPassword, validatePassword } from '../auth.js';

const {
  DATABASE_URL,
  DB_SCHEMA = 'traceshield',
  TRACESHIELD_CREDENTIAL_INVESTIGATOR_ID,
  TRACESHIELD_LOGIN_NAME,
  TRACESHIELD_LOGIN_PASSWORD
} = process.env;

function required(name, value) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name} is required.`);
  return text;
}

const databaseUrl = required('DATABASE_URL', DATABASE_URL);
const schema = required('DB_SCHEMA', DB_SCHEMA);
if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error('DB_SCHEMA must be a simple PostgreSQL identifier.');
const investigatorId = Number(required('TRACESHIELD_CREDENTIAL_INVESTIGATOR_ID', TRACESHIELD_CREDENTIAL_INVESTIGATOR_ID));
if (!Number.isInteger(investigatorId) || investigatorId <= 0) throw new Error('TRACESHIELD_CREDENTIAL_INVESTIGATOR_ID must be a positive integer.');
const loginName = required('TRACESHIELD_LOGIN_NAME', TRACESHIELD_LOGIN_NAME).toLowerCase();
const password = required('TRACESHIELD_LOGIN_PASSWORD', TRACESHIELD_LOGIN_PASSWORD);
if (!validatePassword(password)) throw new Error('TRACESHIELD_LOGIN_PASSWORD must be between 12 and 256 characters.');

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const result = await pool.query(`
    INSERT INTO ${schema}.investigator_credential (investigator_id, login_name, password_hash)
    VALUES ($1, $2, $3)
    ON CONFLICT (investigator_id) DO UPDATE
      SET login_name = EXCLUDED.login_name,
          password_hash = EXCLUDED.password_hash,
          failed_attempts = 0,
          locked_until = NULL
    RETURNING investigator_id, login_name
  `, [investigatorId, loginName, hashPassword(password)]);
  console.log(`Credential ready for investigator ${result.rows[0].investigator_id} (${result.rows[0].login_name}).`);
} finally {
  await pool.end();
}
