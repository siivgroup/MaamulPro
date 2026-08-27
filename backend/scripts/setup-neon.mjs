import { spawnSync } from 'node:child_process';

const steps = [
  ['neon:check', ['-r', 'ts-node/register', 'scripts/check-neon.ts']],
  ['neon:central:push', ['node_modules/prisma/build/index.js', 'db', 'push', '--config', 'prisma.config.ts']],
  ['neon:encrypt-tenants', ['-r', 'ts-node/register', 'scripts/encrypt-tenant-database-urls.ts']],
  ['seed', ['-r', 'ts-node/register', 'scripts/seed-superadmin.ts']],
];
for (const [name, args] of steps) {
  console.log(`Running ${name}...`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0 || result.error) {
    console.error(`neon:setup stopped at ${name}. Earlier steps may have completed; correct this step before retrying.`);
    process.exit(result.status || 1);
  }
}
