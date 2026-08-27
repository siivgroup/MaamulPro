import { spawnSync } from 'node:child_process';
import process from 'node:process';

const compose = ['compose', '-f', 'docker-compose.e2e.yml'];
const external = Boolean(process.env.TEST_TENANT_A_DATABASE_URL && process.env.TEST_TENANT_B_DATABASE_URL);
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
};

try {
  if (external && process.env.E2E_DATABASES_ARE_DISPOSABLE !== 'true') {
    throw new Error('External database E2E requires E2E_DATABASES_ARE_DISPOSABLE=true');
  }
  if (!external) run('docker', [...compose, 'up', '-d', '--wait']);
  run(process.execPath, ['node_modules/@nestjs/cli/bin/nest.js', 'build']);
  const testEnv = external ? { ...process.env } : {
      ...process.env,
      TEST_CENTRAL_DATABASE_URL: 'postgresql://maamulpro:maamulpro_e2e@127.0.0.1:55432/maamulpro_central_e2e',
      TEST_TENANT_A_DATABASE_URL: 'postgresql://maamulpro:maamulpro_e2e@127.0.0.1:55432/maamulpro_tenant_a_e2e',
      TEST_TENANT_B_DATABASE_URL: 'postgresql://maamulpro:maamulpro_e2e@127.0.0.1:55432/maamulpro_tenant_b_e2e',
    };
  if (!testEnv.TEST_CENTRAL_DATABASE_URL) throw new Error('Full onboarding E2E requires TEST_CENTRAL_DATABASE_URL for a disposable central database');
  Object.assign(testEnv, { DATABASE_PROVIDER: 'postgres', CENTRAL_DATABASE_URL: testEnv.TEST_CENTRAL_DATABASE_URL, CENTRAL_DATABASE_DIRECT_URL: testEnv.TEST_CENTRAL_DATABASE_URL, E2E_DATABASES_ARE_DISPOSABLE: 'true', TENANT_DATABASE_ENCRYPTION_KEY: 'c'.repeat(64) });
  run(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--config', 'prisma.config.ts'], { env: testEnv });
  run(process.execPath, ['--test', 'test/database-e2e.test.mjs'], { env: testEnv });
} finally {
  if (!external) spawnSync('docker', [...compose, 'down', '-v'], { stdio: 'inherit', shell: false });
}
