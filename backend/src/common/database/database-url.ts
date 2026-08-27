export type DatabaseConnectionPair = {
  runtimeUrl: string;
  directUrl: string;
  isNeon: boolean;
};

const parseDatabaseUrl = (rawUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error('Database URL is invalid');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) {
    throw new Error('Database URL must identify a PostgreSQL database');
  }
  // pg accepts query-string host/role overrides. They bypass target and ownership checks.
  if (['host', 'hostaddr', 'port', 'user', 'password', 'database', 'dbname', 'db', 'options', 'sslcert', 'sslkey', 'sslrootcert'].some(key => parsed.searchParams.has(key))) {
    throw new Error('Database URL must identify its host, port, database and credentials directly, without query overrides or local certificate paths');
  }
  return parsed;
};

export const isNeonDatabaseUrl = (rawUrl: string) => {
  try {
    return parseDatabaseUrl(rawUrl).hostname.toLowerCase().endsWith('.neon.tech');
  } catch {
    return false;
  }
};

const setNeonPooler = (parsed: URL, pooled: boolean) => {
  const labels = parsed.hostname.split('.');
  labels[0] = pooled
    ? labels[0].endsWith('-pooler') ? labels[0] : `${labels[0]}-pooler`
    : labels[0].replace(/-pooler$/, '');
  parsed.hostname = labels.join('.');
  if (!parsed.searchParams.has('sslmode')) parsed.searchParams.set('sslmode', 'require');
  return parsed;
};

export const getDatabaseConnectionPair = (
  runtimeOrDirectUrl: string,
  explicitDirectUrl?: string,
): DatabaseConnectionPair => {
  const primary = parseDatabaseUrl(runtimeOrDirectUrl);
  const neon = primary.hostname.toLowerCase().endsWith('.neon.tech');
  if (String(process.env.DATABASE_PROVIDER || '').toLowerCase() === 'neon' && !neon) {
    throw new Error('DATABASE_PROVIDER=neon requires a neon.tech PostgreSQL URL');
  }
  if (!neon) {
    const direct = explicitDirectUrl ? parseDatabaseUrl(explicitDirectUrl) : primary;
    return { runtimeUrl: primary.toString(), directUrl: direct.toString(), isNeon: false };
  }

  const runtime = setNeonPooler(new URL(primary.toString()), true);
  const direct = setNeonPooler(
    explicitDirectUrl ? parseDatabaseUrl(explicitDirectUrl) : new URL(primary.toString()),
    false,
  );
  return { runtimeUrl: runtime.toString(), directUrl: direct.toString(), isNeon: true };
};

export const getCentralDatabaseUrls = () => {
  const runtimeUrl = process.env.CENTRAL_DATABASE_URL;
  if (!runtimeUrl) throw new Error('CENTRAL_DATABASE_URL is required');
  return getDatabaseConnectionPair(runtimeUrl, process.env.CENTRAL_DATABASE_DIRECT_URL);
};

export const withDatabaseName = (rawUrl: string, databaseName: string) => {
  const parsed = parseDatabaseUrl(rawUrl);
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) {
    throw new Error('Generated Neon database name is invalid');
  }
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
};

export const databaseEndpointLabel = (rawUrl: string) => {
  const parsed = parseDatabaseUrl(rawUrl);
  return `${parsed.hostname}/${decodeURIComponent(parsed.pathname.slice(1))}`;
};

// Credentials, pooler mode and connection options do not identify a database.
export const databaseIdentity = (rawUrl: string) => {
  const parsed = new URL(getDatabaseConnectionPair(rawUrl).directUrl);
  return `${parsed.hostname.toLowerCase()}:${parsed.port || '5432'}/${decodeURIComponent(parsed.pathname.slice(1))}`;
};

export const poolSetting = (name: string, fallback: number, maximum = 20) => {
  const value = Number(process.env[name] || fallback);
  return Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
};

export const connectionTimeoutMillis = () => {
  const value = Number(process.env.NEON_CONNECT_TIMEOUT_MS || 20000);
  return Number.isFinite(value) && value >= 1000 ? Math.min(value, 120000) : 20000;
};
