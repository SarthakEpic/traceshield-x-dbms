const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return TRUE_VALUES.has(String(value).trim().toLowerCase());
}

function asTrustProxy(value) {
  if (value === undefined || value === null || value === '') return false;
  if (String(value).trim().toLowerCase() === 'true') return true;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : false;
}

function databaseUsername(databaseUrl) {
  try {
    return decodeURIComponent(new URL(databaseUrl).username || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

export function getRuntimeConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || 'development').trim().toLowerCase();
  const configuredDataMode = String(env.DATA_MODE || '').trim().toLowerCase();
  const dataMode = configuredDataMode || (nodeEnv === 'production' ? 'postgres' : 'mock');
  const configuredAuthMode = String(env.AUTH_MODE || '').trim().toLowerCase();
  const authMode = configuredAuthMode || (dataMode === 'mock' && nodeEnv !== 'production' ? 'demo' : 'session');

  return {
    nodeEnv,
    dataMode,
    authMode,
    databaseUrl: String(env.DATABASE_URL || '').trim(),
    dbSchema: String(env.DB_SCHEMA || 'traceshield').trim(),
    tokenSecret: String(env.TRACESHIELD_TOKEN_SECRET || ''),
    adapterSigningSecret: String(env.TRACESHIELD_ADAPTER_SIGNING_SECRET || ''),
    requireAdapterSignature: asBoolean(env.REQUIRE_ADAPTER_SIGNATURE, nodeEnv === 'production'),
    enableConsoleIngestion: asBoolean(env.ENABLE_CONSOLE_INGESTION, nodeEnv !== 'production'),
    allowInsecureEnvAuth: asBoolean(env.ALLOW_INSECURE_ENV_AUTH),
    allowOrigin: String(env.ALLOW_ORIGIN || '').trim(),
    port: Number(env.PORT || 4170),
    trustProxy: asTrustProxy(env.TRUST_PROXY)
  };
}

export function validateRuntimeConfig(config) {
  const errors = [];
  const warnings = [];

  if (!['mock', 'postgres'].includes(config.dataMode)) {
    errors.push('DATA_MODE must be either mock or postgres.');
  }
  if (!['session', 'demo', 'env'].includes(config.authMode)) {
    errors.push('AUTH_MODE must be session, demo, or env.');
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    errors.push('PORT must be an integer between 1 and 65535.');
  }
  if (!/^[a-z_][a-z0-9_]*$/i.test(config.dbSchema)) {
    errors.push('DB_SCHEMA must be a simple PostgreSQL identifier.');
  }
  if (config.dataMode === 'postgres' && !config.databaseUrl) {
    errors.push('DATABASE_URL is required when DATA_MODE=postgres.');
  }
  if (config.dataMode === 'postgres' && config.tokenSecret.length < 32) {
    errors.push('TRACESHIELD_TOKEN_SECRET must contain at least 32 characters in PostgreSQL mode.');
  }
  if (config.dataMode === 'mock' && config.authMode === 'session') {
    errors.push('AUTH_MODE=session requires DATA_MODE=postgres; use AUTH_MODE=demo for the synthetic repository.');
  }
  if (config.authMode === 'demo' && config.dataMode !== 'mock') {
    errors.push('AUTH_MODE=demo is only allowed with DATA_MODE=mock.');
  }
  if (config.authMode === 'env' && (config.nodeEnv === 'production' || config.dataMode === 'postgres') && !config.allowInsecureEnvAuth) {
    errors.push('AUTH_MODE=env is an explicit development bypass. Set ALLOW_INSECURE_ENV_AUTH=true only for local troubleshooting.');
  }
  if (config.requireAdapterSignature && config.adapterSigningSecret.length < 32) {
    errors.push('TRACESHIELD_ADAPTER_SIGNING_SECRET must contain at least 32 characters when adapter signatures are required.');
  }
  if (config.nodeEnv === 'production') {
    if (config.dataMode !== 'postgres') errors.push('Production runtime must use DATA_MODE=postgres.');
    if (config.authMode !== 'session') errors.push('Production runtime must use AUTH_MODE=session.');
    if (!config.allowOrigin) errors.push('ALLOW_ORIGIN is required in production.');
    if (config.enableConsoleIngestion) errors.push('ENABLE_CONSOLE_INGESTION must be false in production.');
    const username = databaseUsername(config.databaseUrl);
    if (!username) errors.push('DATABASE_URL must include a dedicated non-superuser username in production.');
    if (['postgres', 'root', 'admin', 'superuser'].includes(username)) {
      errors.push('DATABASE_URL must not use a PostgreSQL superuser or administrative username in production.');
    }
  }
  if (config.dataMode === 'mock') {
    warnings.push('The application is using a non-persistent synthetic repository. Use PostgreSQL mode for the final demonstration.');
  }

  return { errors, warnings };
}

export function assertRuntimeConfig(config = getRuntimeConfig()) {
  const result = validateRuntimeConfig(config);
  if (result.errors.length) throw new Error(`Runtime configuration invalid: ${result.errors.join(' ')}`);
  return config;
}
