import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import provisioning from '../dist/common/database/tenant-schema-sql.js';

const urlA = process.env.TEST_TENANT_A_DATABASE_URL;
const urlB = process.env.TEST_TENANT_B_DATABASE_URL;
const enabled = Boolean(urlA && urlB);
const pools = enabled ? [new pg.Pool({ connectionString: urlA }), new pg.Pool({ connectionString: urlB })] : [];
const marker = randomUUID();

before(async () => {
  if (!enabled) return;
  await Promise.all([provisioning.applyCompanySchema(urlA), provisioning.applyCompanySchema(urlB)]);
});

after(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
});

test('tenant provisioning installs the current schema version in both databases', { skip: !enabled }, async () => {
  const versions = await Promise.all(pools.map((pool) => pool.query(
    `SELECT "value" FROM "system_config" WHERE "key" = 'schema_version'`,
  )));
  for (const result of versions) {
    assert.equal(result.rows[0]?.value, String(provisioning.CURRENT_TENANT_SCHEMA_VERSION));
  }
});

test('tenant records remain isolated even when identifiers are identical', { skip: !enabled }, async () => {
  const userId = `e2e_user_${marker}`;
  const transactionId = `e2e_tx_${marker}`;
  await pools[0].query(
    `INSERT INTO "users" ("id","email","password_hash","name","role","updated_at")
     VALUES ($1,$2,'hash','E2E Owner','COMPANY_OWNER',CURRENT_TIMESTAMP)`,
    [userId, `owner-${marker}@example.test`],
  );
  await pools[0].query(
    `INSERT INTO "transactions" ("id","reference_id","type","status","description","amount","date","updated_at")
     VALUES ($1,$2,'INCOME','CLEARED','Isolation marker',42,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [transactionId, `ref_${marker}`],
  );

  const [tenantA, tenantB] = await Promise.all(pools.map((pool) => pool.query(
    `SELECT COUNT(*)::int AS count FROM "transactions" WHERE "id" = $1`,
    [transactionId],
  )));
  assert.equal(tenantA.rows[0].count, 1);
  assert.equal(tenantB.rows[0].count, 0);
});

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const centralTestUrl = process.env.TEST_CENTRAL_DATABASE_URL;
const onboardingEnabled = Boolean(centralTestUrl && process.env.E2E_DATABASES_ARE_DISPOSABLE === 'true');

test('saved onboarding survives two worker processes and creates exactly one owner and invoice', { skip: !onboardingEnabled }, async () => {
  process.env.DATABASE_PROVIDER = 'postgres';
  process.env.CENTRAL_DATABASE_URL = centralTestUrl;
  process.env.CENTRAL_DATABASE_DIRECT_URL = centralTestUrl;
  process.env.TENANT_DATABASE_ENCRYPTION_KEY = 'c'.repeat(64);
  const { CentralPrismaService } = require('../dist/common/database/central-prisma.service.js');
  const { TenantConnectionManager } = require('../dist/common/database/tenant-connection.manager.js');
  const { NeonManagementService } = require('../dist/common/database/neon-management.service.js');
  const { CompanyOnboardingService } = require('../dist/modules/superadmin/company-onboarding.service.js');
  const { withOnboardingLock } = require('../dist/common/database/onboarding-database.js');
  const central = new CentralPrismaService();
  const manager = new TenantConnectionManager();
  const service = new CompanyOnboardingService(central, manager, new NeonManagementService());
  const databaseName = 'onboarding_' + randomUUID().replaceAll('-', '');
  const target = new URL(centralTestUrl); target.pathname = '/' + databaseName;
  const connection = new pg.Client({ connectionString: centralTestUrl });
  const child = code => new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, ['-e', code], { cwd: new URL('..', import.meta.url), env: process.env });
    let output = '';
    processChild.stdout.on('data', chunk => { output += chunk; }); processChild.stderr.on('data', chunk => { output += chunk; });
    processChild.on('error', reject);
    const timeout = setTimeout(() => { processChild.kill(); reject(new Error('worker test timed out')); }, 120000);
    processChild.on('exit', code => { clearTimeout(timeout); code === 0 ? resolve(output) : reject(new Error(output)); });
  });
  const worker = `const { CentralPrismaService }=require('./dist/common/database/central-prisma.service.js');
    const { TenantConnectionManager }=require('./dist/common/database/tenant-connection.manager.js');
    const { NeonManagementService }=require('./dist/common/database/neon-management.service.js');
    const { CompanyOnboardingService }=require('./dist/modules/superadmin/company-onboarding.service.js');
    const db=new CentralPrismaService(), tenants=new TenantConnectionManager();
    (async()=>{try { await new CompanyOnboardingService(db,tenants,new NeonManagementService()).processPending(); } finally {await tenants.onModuleDestroy();await db.onModuleDestroy();}})().catch(e=>{console.error(e);process.exitCode=1;});`;
  try {
    await connection.connect();
    await connection.query('CREATE DATABASE "' + databaseName + '"');
    const email = randomUUID() + '@example.test';
    await central.emailVerification.create({ data: { email, context: 'COMPANY_ONBOARDING', hashedCode: 'unused-test-code', status: 'VERIFIED', verifiedAt: new Date(), expiresAt: new Date(Date.now() + 600000) } });
    const data = { onboardingRequestId: randomUUID(), name: 'Database Test', subdomain: 'test-' + randomUUID().slice(0, 8), adminName: 'Test Owner', adminEmail: email, adminPassword: 'test-password', constructionEnabled: true, dbUrl: target.toString(), subscriptionAmount: 25, subscriptionTermMonths: 1 };
    const [one, two] = await Promise.all([service.start(data, 'test-admin'), service.start(data, 'test-admin')]);
    assert.equal(one.companyId, two.companyId);
    await withOnboardingLock(async () => {
      const output = await child(`const {withOnboardingLock}=require('./dist/common/database/onboarding-database.js');withOnboardingLock(async()=>{throw Error('second process acquired the lock');}).then(result=>{if(result!==undefined)process.exitCode=1;}).catch(e=>{console.error(e);process.exitCode=1;});`);
      assert.equal(output, '');
    });
    await Promise.all([child(worker), child(worker)]);
    const status = await service.status(data.onboardingRequestId);
    assert.equal(status.status, 'SUCCEEDED', JSON.stringify(status.error));
    await child(worker);
    assert.equal(await central.company.count({ where: { id: one.companyId } }), 1);
    assert.equal(await central.companyUser.count({ where: { companyId: one.companyId } }), 1);
    assert.equal(await central.invoice.count({ where: { companyId: one.companyId } }), 1);
    const tenant = manager.getTenantDb(target.toString());
    assert.equal(await tenant.user.count(), 1);
    assert.equal((await tenant.systemConfig.findUnique({ where: { key: 'onboarding_attempt_id' } })).value, data.onboardingRequestId);
    await assert.rejects(service.start({ ...data, onboardingRequestId: randomUUID(), subdomain: 'different-' + randomUUID().slice(0,8), adminEmail: 'different@example.test' }, 'admin'), /already assigned/);
  } finally {
    await manager.onModuleDestroy(); await central.onModuleDestroy();
    await connection.query('DROP DATABASE IF EXISTS "' + databaseName + '" WITH (FORCE)').catch(() => {});
    await connection.end();
  }
});

test('real PostgreSQL cashbook writes are atomic, replay-safe and protected by period locks', {skip:!onboardingEnabled}, async()=>{
  const {TenantConnectionManager}=require('../dist/common/database/tenant-connection.manager.js');
  const {FinancialsService}=require('../dist/modules/financials/financials.service.js');
  const {AccountingService}=require('../dist/modules/accounting/accounting.service.js');
  const {AccountMappingsService}=require('../dist/modules/accounting/account-mappings.service.js');
  const manager=new TenantConnectionManager(),db=manager.getTenantDb(urlA);
  const mappings=new AccountMappingsService(),accounting=new AccountingService(mappings),service=new FinancialsService(accounting,mappings);
  const tag=randomUUID(),codes=['CASH_'+tag,'INCOME_'+tag];let period;
  try {
    await db.account.createMany({data:[{code:codes[0],name:'Test cash',type:'ASSET',tenantId:tag},{code:codes[1],name:'Test income',type:'INCOME',normalBalance:'CREDIT',tenantId:tag}]});
    const data={idempotencyKey:randomUUID(),tenantId:tag,type:'INCOME',status:'CLEARED',amount:35,description:'Atomic test',date:new Date('2040-01-31T12:00:00Z'),debitAccountCode:codes[0],creditAccountCode:codes[1]};
    period=await db.accountingPeriod.create({data:{name:'E2E locked '+tag,status:'LOCKED',startDate:new Date('2040-01-01Z'),endDate:new Date('2040-02-01Z')}});
    await assert.rejects(service.createTransaction(db,data),error=>error.getStatus()===409);
    assert.equal(await db.transaction.count({where:{referenceId:data.idempotencyKey}}),0);
    assert.equal(await db.journalBatch.count({where:{sourceRef:data.idempotencyKey}}),0);
    await db.accountingPeriod.update({where:{id:period.id},data:{status:'OPEN'}});
    const results=await Promise.all(Array.from({length:3},()=>service.createTransaction(db,data)));
    assert.equal(new Set(results.map(row=>row.id)).size,1);
    assert.equal(await db.journalBatch.count({where:{sourceRef:data.idempotencyKey}}),1);
    await assert.rejects(service.createTransaction(db,{...data,amount:90}),error=>error.getStatus()===409);
    await db.accountingPeriod.update({where:{id:period.id},data:{status:'LOCKED'}});
    await assert.rejects(service.deleteTransaction(db,results[0].id),/locked/);
    const untouched=await db.transaction.findUnique({where:{id:results[0].id}});assert.equal(untouched.deletedAt,null);assert.equal(untouched.postingStatus,'POSTED');
    await db.accountingPeriod.update({where:{id:period.id},data:{status:'OPEN'}});
    // A failure AFTER reversal must roll both the reversal and source edit back.
    const failedService=new FinancialsService({reverseBatchWithinTx:accounting.reverseBatchWithinTx.bind(accounting),postFinancialEvent:async()=>{throw Error('injected repost failure');}},mappings);
    await assert.rejects(failedService.updateTransaction(db,untouched.id,{version:0,amount:40}),/injected repost/);
    assert.equal((await db.journalBatch.findUnique({where:{id:untouched.journalBatchId}})).status,'POSTED');
    assert.equal((await db.transaction.findUnique({where:{id:untouched.id}})).version,0);
    await Promise.all([service.deleteTransaction(db,untouched.id),service.deleteTransaction(db,untouched.id)]);
    assert.equal(await db.journalBatch.count({where:{reversesBatchId:untouched.journalBatchId}}),1);
    const balance=await db.journalEntry.aggregate({where:{tenantId:tag},_sum:{debit:true,credit:true}});
    assert.equal(Number(balance._sum.debit),Number(balance._sum.credit));
    assert.equal((await service.createTransaction(db,data)).id,untouched.id); // deleted intents are never recreated
  } finally {
    if(period)await db.accountingPeriod.delete({where:{id:period.id}});
    await manager.onModuleDestroy();
  }
});

test('two PostgreSQL approval processes create one invoice and direct renewal history is atomic', {skip:!onboardingEnabled},async()=>{
  const {CentralPrismaService}=require('../dist/common/database/central-prisma.service.js');
  const {SubscriptionLifecycleService}=require('../dist/common/subscriptions/subscription-lifecycle.service.js');
  const central=new CentralPrismaService();
  try {
    const company=await central.company.create({data:{name:'Approval test',subdomain:'approval-'+randomUUID(),adminEmail:randomUUID()+'@example.test',adminName:'Test',dbUrl:urlA}});
    const data={requestId:randomUUID(),amount:42,termDurationMonths:1};
    const code=`const {CentralPrismaService}=require('./dist/common/database/central-prisma.service.js');const {SuperAdminService}=require('./dist/modules/superadmin/superadmin.service.js');const c=new CentralPrismaService();const s=new SuperAdminService(c,null,null,null,null,null,{assertComplete:async()=>{}});s.getCompanyById=async()=>null;s.configureCompanySubscription(${JSON.stringify(company.id)},${JSON.stringify(data)}).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>c.onModuleDestroy());`;
    const child=()=>new Promise((resolve,reject)=>{const proc=spawn(process.execPath,['-e',code],{cwd:new URL('..',import.meta.url),env:process.env});let output='';proc.stdout.on('data',c=>output+=c);proc.stderr.on('data',c=>output+=c);proc.on('error',reject);proc.on('exit',status=>status===0?resolve():reject(Error(output)));});
    await Promise.all([child(),child()]);await child();
    assert.equal(await central.invoice.count({where:{companyId:company.id}}),1);
    assert.equal(await central.subscriptionTransaction.count({where:{companyId:company.id}}),1);
    const lifecycle=new SubscriptionLifecycleService(central,null);
    const [a,b]=await Promise.all([lifecycle.createDirectRenewalInvoice(company.id),lifecycle.createDirectRenewalInvoice(company.id)]);
    assert.equal(a.id,b.id);
    assert.equal(await central.subscriptionTransaction.count({where:{companyId:company.id,transactionType:'RENEWAL_INVOICE_CREATED'}}),1);
  } finally {await central.onModuleDestroy();}
});

test('persisted identity changes recover with a fresh worker and old tenant writes cannot overwrite newer credentials', {skip:!onboardingEnabled},async()=>{
  const {CentralPrismaService}=require('../dist/common/database/central-prisma.service.js');
  const {TenantConnectionManager}=require('../dist/common/database/tenant-connection.manager.js');
  const {IdentitySyncService,identityChange}=require('../dist/common/database/identity-sync.service.js');
  const {StaffService}=require('../dist/modules/staff/staff.service.js');
  const central=new CentralPrismaService(),manager=new TenantConnectionManager(),tenant=manager.getTenantDb(urlA);
  try {
    const email=randomUUID()+'@example.test';
    const company=await central.company.create({data:{name:'Identity test',subdomain:'identity-'+randomUUID(),adminEmail:email,adminName:'Test',dbUrl:urlA}});
    const user=await tenant.user.create({data:{email,name:'Identity test',passwordHash:'old',role:'STAFF'}});
    const staff=await tenant.staff.create({data:{firstName:'Test',lastName:'User',userId:user.id}});
    await central.companyUser.create({data:{id:user.id,companyId:company.id,email,passwordHash:'old',role:'STAFF'}});
    const unavailable=new IdentitySyncService(central,{getTenantDb:()=>{throw Error('injected tenant outage');}});
    const staffService=new StaffService(central,null,unavailable);
    assert.equal((await staffService.resetPassword(tenant,staff.id,'NewPass123!')).syncPending,true);
    const saved=await central.companyUser.findUnique({where:{id:user.id}});
    assert.equal(saved.sessionVersion,1);assert.equal(saved.identitySyncPending,true);
    assert.equal((await tenant.user.findUnique({where:{id:user.id}})).passwordHash,'old');
    const restarted=new IdentitySyncService(central,manager);
    assert.equal(await restarted.sync(user.id),false);
    assert.equal((await tenant.user.findUnique({where:{id:user.id}})).passwordHash,saved.passwordHash);
    await central.companyUser.update({where:{id:user.id},data:{passwordHash:'newer',...identityChange()}});
    assert.equal(await restarted.sync(user.id),false);
    const lateWrite=await tenant.user.updateMany({where:{id:user.id,identityVersion:{lte:1}},data:{passwordHash:'old delayed write',identityVersion:1}});
    assert.equal(lateWrite.count,0);
    assert.equal((await tenant.user.findUnique({where:{id:user.id}})).passwordHash,'newer');
  } finally {await manager.onModuleDestroy();await central.onModuleDestroy();}
});
