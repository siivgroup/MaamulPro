export class SetupError extends Error {
  constructor(public code: string, message: string, public retryable = false, public nextAction = 'Contact the platform administrator.') {
    super(message);
  }
}

export function setupFailure(error: any, stage: string) {
  if (error instanceof SetupError) return { code: error.code, message: error.message, retryable: error.retryable, nextAction: error.nextAction, stage };
  const code = error?.meta?.code || error?.code || error?.cause?.code;
  const temporary = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', '57P01', '57P03', '53300', 'P1001', 'P1002', 'P1017', '40001', '40P01'].includes(code) || String(code).startsWith('08') || error?.name === 'TimeoutError';
  const reason = ['28P01', '28000'].includes(code) ? 'The database credentials were rejected.'
    : code === '42501' ? 'The database account does not have the required permissions.'
    : code === '3D000' ? 'The saved database is not available yet.'
    : code === 'P2002' || code === '23505' ? 'A setup record conflicts with existing data.'
    : code === '42703' ? 'The company schema is missing a required column.'
    : code === '42P01' ? 'The company schema is missing a required table.'
    : code === '42704' ? 'A required database type or object is missing.'
    : code === '42601' ? 'The company schema contains an invalid SQL definition.'
    : code === '23503' ? 'A setup record refers to data that does not exist.'
    : temporary ? 'The database connection was interrupted or timed out.'
    : stage === 'SCHEMA' ? 'The company schema could not be installed.'
    : 'This setup step could not be completed.';
  const retryable = temporary || code === '3D000';
  return { code: code ? `SETUP_${code}` : 'SETUP_FAILED', stage, message: `${reason} Your setup is saved.`, retryable, nextAction: retryable ? 'Retry the saved setup.' : 'Ask the platform administrator to review this reference before retrying.' };
}

// Log identifiers/codes only: driver messages and stacks may contain URLs or SQL.
export function setupDiagnostic(error: any) {
  return { type: error?.name || 'Error', code: error?.meta?.code || error?.code || error?.cause?.code || 'UNKNOWN',
    ...Object.fromEntries(['table', 'column', 'constraint', 'position'].filter(key => /^[a-zA-Z0-9_]{1,100}$/.test(String(error?.[key] || ''))).map(key => [key, error[key]])) };
}
