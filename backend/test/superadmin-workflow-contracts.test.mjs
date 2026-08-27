import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const superadmin = await readFile(new URL('../src/modules/superadmin/superadmin.service.ts', import.meta.url), 'utf8');
const onboarding = await readFile(new URL('../src/modules/superadmin/company-onboarding.service.ts', import.meta.url), 'utf8');
const auth = await readFile(new URL('../src/modules/auth/auth.service.ts', import.meta.url), 'utf8');
const permissionsGuard = await readFile(new URL('../src/common/guards/permissions.guard.ts', import.meta.url), 'utf8');
const tenantGuard = await readFile(new URL('../src/common/guards/tenant-access.guard.ts', import.meta.url), 'utf8');
const apiClient = await readFile(new URL('../../frontend/src/lib/api.ts', import.meta.url), 'utf8');
const impersonationPage = await readFile(new URL('../../frontend/src/pages/auth/ImpersonationPage.tsx', import.meta.url), 'utf8');
const superadminSeed = await readFile(new URL('../scripts/seed-superadmin.ts', import.meta.url), 'utf8');
const legacySuperadminSeed = await readFile(new URL('../scripts/seed-superadmin.js', import.meta.url), 'utf8');

test('superadmin seeding accepts the established environment variables without a default password', () => {
  assert.match(superadminSeed, /E2E_SUPER_ADMIN_EMAIL/);
  assert.match(superadminSeed, /E2E_SUPER_ADMIN_PASSWORD/);
  assert.match(superadminSeed, /assertStrongPassword\(adminPassword\)/);
  assert.doesNotMatch(superadminSeed, /StrongPass@123|admin@maamulpro\.com|console\.log\([^\n]*adminPassword/);
  assert.match(legacySuperadminSeed, /require\('\.\/seed-superadmin\.ts'\)/);
});

test('onboarding cannot grant access before a dated subscription is configured', () => {
  assert.match(onboarding, /status: 'PENDING_SETUP',[\s\S]*subscriptionStatus: 'PENDING',[\s\S]*accessGranted: false/);
  assert.match(superadmin, /const active = hasSubscriptionAccess\(company\)/);
});

test('onboarding retains the journal instead of deleting failed resources', () => {
  assert.doesNotMatch(onboarding, /company.delete|deleteCreatedDatabase/);
  assert.match(onboarding, /companyOnboarding.updateMany/);
  assert.match(onboarding, /withOnboardingLock/);
});

test('impersonation grants are atomically consumed and do not revoke owner sessions on logout', () => {
  assert.match(auth, /impersonationGrant\.updateMany\([\s\S]*usedAt: null[\s\S]*usedAt: now/);
  assert.match(auth, /if \(user\?\.isImpersonating\) \{[\s\S]*return \{ loggedOut: true \}/);
});

test('impersonation bypasses tenant RBAC but remains bound to the granted company', () => {
  assert.match(permissionsGuard, /user\.isSuperAdmin === true \|\| user\.isImpersonating/);
  assert.match(tenantGuard, /if \(!user\.isSuperAdmin && \(!user\.companyId \|\| user\.companyId !== tenant\.companyId\)\)/);
  assert.match(tenantGuard, /if \(!user\.isSuperAdmin && !user\.isImpersonating\)/);
});

test('impersonation access is memory-only and cannot survive reload or tab closure', () => {
  assert.match(apiClient, /if \(session\.user\.isImpersonating\) \{[\s\S]*volatileSession = session[\s\S]*sessionStorage\.removeItem[\s\S]*localStorage\.removeItem/);
  assert.match(apiClient, /if \(stored\?\.user\.isImpersonating\) \{[\s\S]*return null/);
  assert.match(impersonationPage, /navigate\('\/app\/dashboard', \{ replace: true \}\)/);
  assert.match(auth, /accessToken: this\.jwtService\.sign\(payload, \{ expiresIn: 10 \* 60 \}\)/);
});

// Behavioral tests exercise saved state rather than only looking for source strings.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
const { CompanyOnboardingService } = require('../src/modules/superadmin/company-onboarding.service.ts');
const { NeonManagementService } = require('../src/common/database/neon-management.service.ts');
const { assertEmptyOrOwned } = require('../src/common/database/onboarding-database.ts');
const { setupFailure } = require('../src/common/database/onboarding-errors.ts');
const schemaModule = require('../src/common/database/tenant-schema-sql.ts');
const rbacModule = require('../src/common/database/rbac-sync.ts');

function onboardingFixture(t, overrides = {}) {
  const keys = ['DATABASE_PROVIDER','CENTRAL_DATABASE_URL','CENTRAL_DATABASE_DIRECT_URL','NEON_API_KEY','NEON_PROJECT_ID','NEON_BRANCH_ID','NEON_DB_ROLE','NEON_TENANT_BASE_URL','NEON_TENANT_DATABASE_PREFIX','TENANT_DATABASE_ENCRYPTION_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  Object.assign(process.env, { DATABASE_PROVIDER: 'neon', CENTRAL_DATABASE_URL: 'postgresql://owner:secret@ep-test-pooler.us-east-2.aws.neon.tech/central', CENTRAL_DATABASE_DIRECT_URL: 'postgresql://owner:secret@ep-test.us-east-2.aws.neon.tech/central', NEON_API_KEY: 'fake', NEON_PROJECT_ID: 'project', NEON_BRANCH_ID: 'branch', NEON_DB_ROLE: 'owner', NEON_TENANT_BASE_URL: 'postgresql://owner:secret@ep-test.us-east-2.aws.neon.tech/central', NEON_TENANT_DATABASE_PREFIX: 'tenant_', TENANT_DATABASE_ENCRYPTION_KEY: 'a'.repeat(64) });
  const state = { companies: [], owners: [], jobs: [], invoices: [], ledgers: [], tenantUsers: [], verification: { id: 'verification', status: 'VERIFIED', verifiedAt: new Date(), expiresAt: new Date(Date.now() + 600000) } };
  const calls = [];
  let failureStage, lostCommit = false;
  const fail = stage => { calls.push(stage); if (failureStage === stage) throw Object.assign(new Error('postgresql://user:secret@host/db SQL sensitive'), { code: 'ECONNRESET' }); };
  const find = (rows, where) => rows.find(row => Object.entries(where).every(([key,value]) => row[key] === value));
  const update = (rows, where, data) => { const row=find(rows,where); assert.ok(row); Object.assign(row,data); return structuredClone(row); };
  const unique = () => Object.assign(new Error('unique'), { code: 'P2002' });
  const db = {
    company: {
      findMany: async () => structuredClone(state.companies),
      findUnique: async ({where}) => structuredClone(find(state.companies,where) || null),
      create: async ({data}) => { if(state.companies.some(row=>row.subdomain===data.subdomain || row.adminEmail===data.adminEmail)) throw unique(); const row={id:randomUUID(),...data};state.companies.push(row);return structuredClone(row); },
      update: async ({where,data}) => update(state.companies,where,data),
    },
    companyUser: {
      findUnique: async ({where}) => structuredClone(find(state.owners,where) || null),
      create: async ({data}) => { if(state.owners.some(row=>row.email===data.email)) throw unique();state.owners.push(data);return data; },
      update: async ({where,data}) => update(state.owners,where,data),
    },
    companyOnboarding: {
      findUnique: async ({where,include}) => { const row=find(state.jobs,where); return row ? {...structuredClone(row), ...(include?.company ? {company:structuredClone(find(state.companies,{id:row.companyId}))} : {})} : null; },
      create: async ({data}) => { if(state.jobs.some(row=>row.id===data.id || row.databaseIdentity===data.databaseIdentity)) throw unique();const row={status:'QUEUED',stage:'DATABASE',retryCount:0,databaseConfirmed:false,createRequestedAt:null,...data};state.jobs.push(row);return row; },
      update: async ({where,data}) => update(state.jobs,where,data),
      updateMany: async ({where,data}) => { const row=state.jobs.find(row=>row.id===where.id && (!where.status || where.status.in.includes(row.status)));if(!row)return {count:0};Object.assign(row,data);return {count:1}; },
    },
    emailVerification: {findUnique:async()=>structuredClone(state.verification),updateMany:async()=>{state.verification.status='EXPIRED';return {count:1};}},
    centralAdmin: {findFirst:async()=>null},
    invoice: {create:async({data})=>{fail('FINALIZATION');state.invoices.push(data);return data;}},
    subscriptionTransaction: {create:async({data})=>{state.ledgers.push(data);return data;}},
    $executeRawUnsafe:async()=>0,
    $queryRawUnsafe:async()=>[],
  };
  let queue=Promise.resolve();
  db.$transaction = fn => {
    const operation=queue.then(async()=>{
      const snapshot=structuredClone(state);
      let result;
      try {result=await fn(db);} catch(error) {Object.assign(state,snapshot);throw error;}
      if(lostCommit && state.jobs.some(row=>row.status==='SUCCEEDED')) {lostCommit=false;throw Object.assign(new Error('commit acknowledgment lost'),{code:'ECONNRESET'});}
      return result;
    });
    queue=operation.catch(()=>{});return operation;
  };
  const tenant = {
    $queryRaw:async()=>{fail('READINESS');return [];},
    user:{upsert:async({where,create})=>{fail('OWNER_DEFAULTS');let row=find(state.tenantUsers,where);if(!row){row=create;state.tenantUsers.push(row);}return row;}},
    systemConfig:{upsert:async()=>({})},staff:{upsert:async()=>({})},category:{upsert:async()=>({})},activityLog:{findFirst:async()=>({})},
  };
  tenant.$transaction = async fn => {const before=structuredClone(state.tenantUsers);try{return await fn(tenant);}catch(e){state.tenantUsers=before;throw e;}};
  const neon = new NeonManagementService();
  t.mock.method(neon,'ensureDatabase',async(_target,_at,intent)=>{fail('DATABASE');await intent();});
  t.mock.method(schemaModule,'applyCompanySchema',async(_url,id)=>{assert.ok(id);fail('SCHEMA');});
  t.mock.method(rbacModule,'syncPermissionsToDb',async()=>{fail('PERMISSIONS');});
  const service=new CompanyOnboardingService(db,{getTenantDb:()=>tenant},neon);
  const data={onboardingRequestId:randomUUID(),name:'Audit Company',subdomain:'audit',adminName:'Audit Owner',adminEmail:'owner@example.test',adminPassword:'secret-password',constructionEnabled:true,...overrides};
  const run=async(guard=async()=>{},signal=new AbortController().signal)=>{
    const job=await db.companyOnboarding.findUnique({where:{id:data.onboardingRequestId},include:{company:true}});
    await service.run(job,guard,signal);
  };
  return {service,db,state,data,calls,run,setFailure:stage=>{failureStage=stage;},loseCommit:()=>{lostCommit=true;}};
}

test('reservation is durable and replay is checked before expired verification', async t => {
  const f=onboardingFixture(t);
  const [first,second]=await Promise.all([f.service.start(f.data,'admin'),f.service.start(f.data,'admin')]);
  assert.equal(first.companyId,second.companyId);
  assert.equal(f.state.companies.length,1);assert.equal(f.state.owners.length,1);assert.equal(f.state.jobs.length,1);
  assert.equal(f.state.owners[0].isActive,false);assert.equal(f.calls.length,0);
  assert.match(f.state.companies[0].dbUrl,/^enc:v1:/);
  assert.equal(JSON.stringify(f.state.jobs).includes(f.data.adminPassword),false);
  f.state.verification.status='EXPIRED';
  assert.equal((await f.service.start(f.data,'admin')).companyId,first.companyId);
  await assert.rejects(f.service.start({...f.data,name:'Different'},'admin'),error=>error.getStatus()===409);
  await assert.rejects(f.service.start({...f.data,adminPassword:'different-password'},'admin'),error=>error.getStatus()===409);
});

for (const stage of ['DATABASE','READINESS','SCHEMA','PERMISSIONS','OWNER_DEFAULTS','FINALIZATION']) {
  test(`failure at ${stage} retains resources and resumes without duplicate identities or billing`, async t => {
    const f=onboardingFixture(t,{subscriptionAmount:25,subscriptionTermMonths:1});
    await f.service.start(f.data,'admin');f.setFailure(stage);await f.run();
    assert.equal(f.state.jobs[0].stage,stage);assert.equal(f.state.jobs[0].status,'QUEUED');
    assert.equal(f.state.jobs[0].error.stage,stage);assert.equal(JSON.stringify(f.state.jobs[0].error).includes('secret'),false);
    assert.equal(f.state.companies.length,1);assert.equal(f.state.owners[0].isActive,false);
    f.setFailure(null);await f.run();await f.run();
    assert.equal(f.state.jobs[0].status,'SUCCEEDED');assert.equal(f.state.companies.length,1);assert.equal(f.state.owners.length,1);
    assert.equal(f.state.tenantUsers.length,1);assert.equal(f.state.invoices.length,1);assert.equal(f.state.ledgers.length,1);
    assert.equal(f.state.companies[0].accessGranted,true);
  });
}

test('final commit response loss cannot change succeeded state or duplicate the invoice', async t => {
  const f=onboardingFixture(t,{subscriptionAmount:25,subscriptionTermMonths:1});
  await f.service.start(f.data,'admin');f.loseCommit();await f.run();await f.run();
  assert.equal(f.state.jobs[0].status,'SUCCEEDED');assert.equal(f.state.invoices.length,1);assert.equal(f.state.ledgers.length,1);
});

test('setup without billing succeeds without granting access and returns safe actual results',async t=>{
  const f=onboardingFixture(t);await f.service.start(f.data,'admin');await f.run();
  const status=await f.service.status(f.data.onboardingRequestId);
  assert.equal(status.status,'SUCCEEDED');assert.equal(status.result.accessGranted,false);
  assert.equal(status.result.dbName,f.state.jobs[0].databaseName);
  assert.equal(JSON.stringify(status).includes('password'),false);assert.equal(JSON.stringify(status).includes('enc:v1'),false);
});

test('lost ownership lock stops before further setup writes',async t=>{
  const f=onboardingFixture(t);await f.service.start(f.data,'admin');const abort=new AbortController();
  let checks=0;
  const guard=async()=>{if(++checks===3){abort.abort();throw new Error('lock lost');}};
  await assert.rejects(f.run(guard,abort.signal));assert.equal(f.state.jobs[0].stage,'DATABASE');
  assert.equal(f.calls.includes('READINESS'),false);await f.run();assert.equal(f.state.jobs[0].status,'SUCCEEDED');
});

test('unfinished company mutations are blocked and existing companies remain compatible',async t=>{
  const f=onboardingFixture(t);const accepted=await f.service.start(f.data,'admin');
  await assert.rejects(f.service.assertComplete(accepted.companyId),e=>e.getStatus()===409);
  await f.service.assertComplete('legacy-company');await f.run();await f.service.assertComplete(accepted.companyId);
});

test('manual databases require emptiness or the same durable ownership marker',async()=>{
  await assertEmptyOrOwned({query:async()=>({rows:[]})},'attempt');
  const query=async sql=>sql.includes('pg_class')?{rows:[{nspname:'public',relname:'system_config'}]}:{rows:[{value:'another-attempt'}]};
  await assert.rejects(assertEmptyOrOwned({query},'attempt'),/not linked/);
  await assertEmptyOrOwned({query:async sql=>sql.includes('pg_class')?{rows:[{nspname:'public',relname:'system_config'}]}:{rows:[{value:'attempt'}]}},'attempt');
  const error=setupFailure(Object.assign(new Error('raw password=secret'),{code:'42501'}),'SCHEMA');
  assert.match(error.message,/permissions/);assert.equal(JSON.stringify(error).includes('secret'),false);
});

import vm from 'node:vm';
test('API client preserves structured failures, avoids duplicate alerts, and rejects unreadable success', async () => {
  const ts=require('typescript');
  const compiled=ts.transpileModule(apiClient.replaceAll('import.meta.env', "({VITE_API_URL:'http://127.0.0.1:9999',DEV:true})"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
  const exported={},toasts=[];
  const storage={getItem:()=>null,removeItem:()=>{},setItem:()=>{}};
  let response=new Response(JSON.stringify({message:'Setup paused',code:'PROVIDER_503',stage:'DATABASE',retryable:true,nextAction:'Retry saved setup',onboardingId:'attempt',requestId:'request'}),{status:503});
  const context=vm.createContext({exports:exported,require:()=>({toast:{error:message=>toasts.push(message)}}),Headers,FormData,CustomEvent:class {},sessionStorage:storage,localStorage:storage,window:{dispatchEvent:()=>{},location:{pathname:'/',assign:()=>{}}},fetch:async()=>response});
  new vm.Script(compiled).runInContext(context);
  await assert.rejects(exported.api('/api/superadmin/companies',{silent:true}),error=>error.code==='PROVIDER_503'&&error.stage==='DATABASE'&&error.retryable&&error.onboardingId==='attempt'&&error.requestId==='request');
  assert.deepEqual(toasts,[]);
  response=new Response('not-json',{status:200});
  await assert.rejects(exported.api('/api/superadmin/companies',{silent:true}),error=>error.code==='INVALID_RESPONSE');
});

test('API activity tracks concurrent writes through body parsing and releases failures without blocking background reads', async () => {
  const ts=require('typescript'), exported={}, requests=[];
  const compiled=ts.transpileModule(apiClient.replaceAll('import.meta.env', "({VITE_API_URL:'http://127.0.0.1:9999',DEV:true})"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
  const storage={getItem:()=>null,removeItem:()=>{},setItem:()=>{}};
  const window=new EventTarget();
  window.location={pathname:'/',assign:()=>{}};
  new vm.Script(compiled).runInContext(vm.createContext({exports:exported,require:()=>({toast:{error:()=>{}}}),Headers,FormData,CustomEvent,sessionStorage:storage,localStorage:storage,window,
    fetch:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))}));
  const activity=()=>JSON.parse(JSON.stringify(exported.getRequestActivity()));
  const create=exported.api('/api/records',{method:'POST',silent:true});
  let updates=0;
  const unsubscribe=exported.subscribeRequestActivity(()=>updates++);
  assert.deepEqual(activity(),{pendingRequests:1,pendingMutations:1}); // Late subscribers see current work.
  let completeBody, bodyStarted;
  const parsing=new Promise(resolve=>{bodyStarted=resolve;});
  requests[0].resolve({ok:true,json:()=>new Promise(resolve=>{completeBody=resolve;bodyStarted();})});
  await parsing;
  assert.equal(activity().pendingMutations,1); // Headers arriving are not completion.
  const read=exported.api('/api/records');
  const remove=exported.api('/api/records/1',{method:'DELETE',silent:true});
  assert.deepEqual(activity(),{pendingRequests:3,pendingMutations:2});
  completeBody({success:true,data:{id:'one'}});await create;
  requests[2].resolve(new Response(JSON.stringify({message:'Delete refused'}),{status:409}));
  await assert.rejects(remove,/Delete refused/);
  assert.deepEqual(activity(),{pendingRequests:1,pendingMutations:0});
  requests[1].resolve(Response.json({success:true,data:[]}));await read;
  for(const failure of ['network','malformed','abort']) {
    const operation=exported.api('/api/records/1',{method:'PATCH',silent:true});
    const request=requests.at(-1);
    if(failure==='malformed') request.resolve(new Response('invalid',{status:200}));
    else request.reject(new Error(failure));
    await assert.rejects(operation);
    assert.deepEqual(activity(),{pendingRequests:0,pendingMutations:0});
  }
  const notifications=updates;
  unsubscribe();
  const download=exported.apiBlob('/api/files/example');
  requests.at(-1).resolve(new Response('file'));await download;
  assert.equal(updates,notifications);
  assert.deepEqual(activity(),{pendingRequests:0,pendingMutations:0});
});

test('schema connection failure closes the pool and preserves the original cause',async t=>{
  const {Pool}=require('pg');
  const failure=Object.assign(new Error('connection failed'),{code:'ECONNRESET'});
  let closed=false;
  t.mock.method(Pool.prototype,'connect',async()=>{throw failure;});
  t.mock.method(Pool.prototype,'end',async()=>{closed=true;});
  await assert.rejects(schemaModule.applyCompanySchema('postgresql://owner:secret@ep-test.us-east-2.aws.neon.tech/test'),error=>error===failure);
  assert.equal(closed,true);
});

test('shared manual database identities cannot reserve a second company despite different credentials or pooling',async t=>{
  const f=onboardingFixture(t,{dbUrl:'postgresql://owner:secret@ep-test.us-east-2.aws.neon.tech/dedicated',subdomain:'a'.repeat(63)});
  await f.service.start(f.data,'admin');
  await assert.rejects(f.service.start({...f.data,onboardingRequestId:randomUUID(),subdomain:'b'.repeat(63),adminEmail:'other@example.test',dbUrl:'postgresql://other:password@ep-test-pooler.us-east-2.aws.neon.tech/dedicated'},'admin'),error=>error.getStatus()===409);
  assert.equal(f.state.companies.length,1);assert.equal(f.state.jobs.length,1);
  await assert.rejects(f.service.start({...f.data,onboardingRequestId:randomUUID(),dbUrl:'postgresql://owner:secret@ep-test.us-east-2.aws.neon.tech/central'},'admin'),error=>error.getResponse().code==='DATABASE_IS_CENTRAL');
});

test('failed provider deletion retains the company and deletion journal for retry',async t=>{
  const lockModule=require('../src/common/database/onboarding-database.ts');
  const {SuperAdminService}=require('../src/modules/superadmin/superadmin.service.ts');
  t.mock.method(lockModule,'withOnboardingLock',async fn=>fn(async()=>{},new AbortController().signal));
  const company={id:'company',name:'Example',dbUrl:'postgresql://owner:secret@ep-test.us-east-2.aws.neon.tech/tenant_test',dbCreatedByMaamulPro:true,onboarding:{id:'attempt',status:'SUCCEEDED',databaseName:'tenant_test',projectId:'project',branchId:'branch',databaseOwner:'owner'}};
  let deleted=false;
  const db={company:{findUnique:async()=>company,update:async({data})=>Object.assign(company,data),delete:async()=>{deleted=true;}},companyOnboarding:{update:async({data})=>Object.assign(company.onboarding,data)}};
  db.$transaction=async fn=>fn(db);
  const service=new SuperAdminService(db,{disconnectTenant:async()=>{}},{deleteCreatedDatabase:async()=>{throw new Error('provider unavailable');}},null,null,null,null);
  await assert.rejects(service.deleteCompany('company'),/provider unavailable/);
  assert.equal(deleted,false);assert.equal(company.onboarding.status,'DELETING');assert.equal(company.accessGranted,false);
});

test('the original request remains replayable after an owner password change',async t=>{
  const f=onboardingFixture(t);const accepted=await f.service.start(f.data,'admin');await f.run();
  f.state.owners[0].passwordHash=await require('argon2').hash('a-new-password');
  assert.equal((await f.service.start(f.data,'admin')).companyId,accepted.companyId);
});

test('status parsing rejects malformed results and reference recovery never stores setup secrets', async () => {
  const source=await readFile(new URL('../../frontend/src/lib/onboarding.ts',import.meta.url),'utf8');
  const ts=require('typescript'), exported={}, stored=new Map();
  const id=randomUUID();
  const location={search:`?onboarding=${id}`};
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new vm.Script(compiled).runInContext(vm.createContext({exports:exported,URLSearchParams,window:{location},sessionStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)}}));
  const row={onboardingId:id,companyId:'company',status:'RUNNING',stage:'READINESS',error:null,result:null};
  assert.equal(exported.parseOnboardingStatus(row,id),row);
  for(const invalid of [null,{...row,status:'UNKNOWN'},{...row,status:'SUCCEEDED'},{...row,error:{message:'missing fields'}},{...row,result:{modulesEnabled:null}}]) {
    assert.throws(()=>exported.parseOnboardingStatus(invalid,id),/unreadable/);
  }
  exported.saveOnboardingReference(id);
  assert.deepEqual([...stored.values()],[id]);
  exported.clearOnboardingReference(id);
  assert.equal(exported.loadOnboardingReference(),id); // Success survives refresh via the URL.
  location.search='';
  assert.equal(exported.loadOnboardingReference(),'');
});

const { PermissionsGuard } = require('../src/common/guards/permissions.guard.ts');
const { Reflector } = require('@nestjs/core');
const { SuperAdminController } = require('../src/modules/superadmin/superadmin.controller.ts');
const { SuperAdminService } = require('../src/modules/superadmin/superadmin.service.ts');
const { JwtAuthGuard } = require('../src/common/guards/jwt-auth.guard.ts');
const { IdentitySyncService, identityChange } = require('../src/common/database/identity-sync.service.ts');

test('every platform handler denies tenant owners, staff, role-name spoofing and impersonation', async () => {
  const guard = new PermissionsGuard(new Reflector(), {companyUser:{findUnique:async()=>({role:'COMPANY_OWNER',isActive:true})}});
  const handlers = Object.getOwnPropertyNames(SuperAdminController.prototype).filter(name => name !== 'constructor');
  assert.ok(handlers.length > 20);
  for (const name of handlers) {
    const context = user => ({getHandler:()=>SuperAdminController.prototype[name],getClass:()=>SuperAdminController,switchToHttp:()=>({getRequest:()=>({user})})});
    for (const user of [{role:'COMPANY_OWNER'},{role:'STAFF'},{role:'SUPER_ADMIN'},{role:'COMPANY_OWNER',isImpersonating:true},{isSuperAdmin:true,isImpersonating:true}]) {
      await assert.rejects(guard.canActivate(context({id:'tenant-user',...user})), error=>error.getStatus()===403, name);
    }
    assert.equal(await guard.canActivate(context({id:'platform',isSuperAdmin:true})),true,name);
  }
  const handler = () => {};
  Reflect.defineMetadata('permissions',['transactions.create'],handler);
  const tenant = {getHandler:()=>handler,getClass:()=>class {},switchToHttp:()=>({getRequest:()=>({user:{id:'tenant-user',role:'STAFF'}})})};
  assert.equal(await guard.canActivate(tenant),true);
});

function approvalFixture() {
  const company={id:'company',status:'PENDING_SETUP',subscriptionStatus:'PENDING',accessGranted:false};
  const invoices=[], ledgers=[];
  const central={
    company:{findUnique:async()=>({...company}),update:async({data})=>Object.assign(company,data)},
    invoice:{findFirst:async()=>null,create:async({data})=>{invoices.push(data);return data;}},
    subscriptionTransaction:{findUnique:async({where})=>ledgers.find(row=>row.requestId===where.requestId),create:async({data})=>{ledgers.push(data);return data;}},
    $queryRawUnsafe:async()=>[{id:company.id}],
  };
  let queue=Promise.resolve();
  central.$transaction=fn=>{const run=queue.then(()=>fn(central));queue=run.catch(()=>{});return run;};
  const service=new SuperAdminService(central,null,null,null,null,null,{assertComplete:async()=>{}});
  service.getCompanyById=async()=>({...company});
  return {service,company,invoices,ledgers};
}

test('concurrent approval replays create one paid invoice and one approval history entry',async()=>{
  const f=approvalFixture(), data={requestId:randomUUID(),amount:30,termDurationMonths:1};
  await Promise.all([f.service.configureCompanySubscription('company',data),f.service.configureCompanySubscription('company',data)]);
  assert.equal(f.invoices.length,1);assert.equal(f.ledgers.length,1);
  await f.service.configureCompanySubscription('company',data); // lost response retry
  assert.equal(f.invoices.length,1);assert.equal(f.ledgers.length,1);
  await assert.rejects(f.service.configureCompanySubscription('company',{...data,amount:99}),error=>error.getStatus()===409);
  await f.service.configureCompanySubscription('company',{...data,requestId:randomUUID()});
  assert.equal(f.invoices.length,1);assert.equal(f.ledgers.filter(row=>row.transactionType==='APPROVAL').length,1);
});

function identityFixture() {
  const user={id:'user',email:'owner@example.test',passwordHash:'hashed-secret',role:'STAFF',isActive:true,deletedAt:null,sessionVersion:3,identitySyncPending:true,company:{dbUrl:'postgresql://local/test'}};
  const copy={id:'user',identityVersion:2,passwordHash:'old'};
  let fail=true,loseAck=false;
  const tenant={user:{updateMany:async({where,data})=>{if(fail)throw Error('secret postgres error');if(copy.identityVersion>where.identityVersion.lte)return {count:0};Object.assign(copy,data);return {count:1};},findUnique:async()=>copy}};
  const central={companyUser:{findUnique:async()=>({...user}),update:async({data})=>Object.assign(user,data),updateMany:async({data})=>{Object.assign(user,data);return {count:1};}},$queryRawUnsafe:async()=>[{id:user.id}]};
  central.$transaction=async fn=>{const before={...user};try{const result=await fn(central);if(loseAck){loseAck=false;Object.assign(user,before);throw Error('central ack lost');}return result;}catch(error){Object.assign(user,before);throw error;}};
  const service=new IdentitySyncService(central,{getTenantDb:()=>tenant});
  return {service,user,copy,setFailure:value=>{fail=value;},loseAck:()=>{loseAck=true;}};
}

test('identity changes remain pending after tenant failure and recover after restart or lost acknowledgement',async()=>{
  const f=identityFixture();
  assert.equal(await f.service.sync('user'),true);assert.equal(f.user.identitySyncPending,true);assert.equal(f.copy.passwordHash,'old');
  f.setFailure(false);f.loseAck();assert.equal(await f.service.sync('user'),true);assert.equal(f.copy.passwordHash,'hashed-secret');
  assert.equal(await f.service.sync('user'),false);assert.equal(f.user.identitySyncPending,false);assert.equal(f.copy.identityVersion,3);
  f.user.identitySyncPending=true;f.copy.identityVersion=4;f.copy.passwordHash='newer';
  assert.equal(await f.service.sync('user'),true);assert.equal(f.copy.passwordHash,'newer');assert.equal(f.user.identitySyncPending,true); // delayed old worker is fenced
});

test('owner password generation revokes sessions in the same durable credential update',async()=>{
  let change;
  const owner={id:'owner',email:'owner@example.test',role:'COMPANY_OWNER'};
  const db={company:{findUnique:async()=>({id:'company',adminEmail:owner.email,users:[owner]})},companyUser:{update:async({data})=>{change=data;}}};
  const service=new SuperAdminService(db,null,null,null,null,null,{assertComplete:async()=>{}},{sync:async()=>true});
  const result=await service.generateCompanyOwnerTemporaryPassword('company');
  assert.deepEqual(change.sessionVersion,{increment:1});assert.equal(change.identitySyncPending,true);
  assert.equal(result.syncPending,true);assert.ok(await require('argon2').verify(change.passwordHash,result.password));
  assert.ok(!JSON.stringify(change).includes(result.password));
});

test('JWT authentication rejects revoked versions and pauses pending account synchronization',async()=>{
  let principal={isActive:true,sessionVersion:4,identitySyncPending:true};
  let payload={sub:'user',sessionVersion:3};
  const guard=new JwtAuthGuard(new Reflector(),{verifyAsync:async()=>payload},{companyUser:{findUnique:async()=>principal}});
  const context={getHandler:()=>()=>{},getClass:()=>class{},switchToHttp:()=>({getRequest:()=>({headers:{authorization:'Bearer test'}})})};
  await assert.rejects(guard.canActivate(context),error=>error.getStatus()===401);
  payload.sessionVersion=4;await assert.rejects(guard.canActivate(context),error=>error.getStatus()===503);
  principal.identitySyncPending=false;assert.equal(await guard.canActivate(context),true);
});

test('financial drafts keep the original submission across refresh and forbid changed retry inputs',async()=>{
  const source=await readFile(new URL('../../frontend/src/lib/billing-submission.ts',import.meta.url),'utf8');
  const ts=require('typescript'),stored=new Map();let user={id:'user',companyId:'company'};
  const boot=()=>{
    const exported={};
    const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new vm.Script(compiled).runInContext(vm.createContext({exports:exported,crypto:{randomUUID},require:()=>({sessionStore:{get:()=>({user})}}),sessionStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)}}));
    return exported;
  };
  const first=boot().reserveBillingSubmission('cashbook',{amount:23,description:'Saved intent'});
  const refreshed=boot();assert.equal(refreshed.reserveBillingSubmission('cashbook',{amount:23,description:'Saved intent'}).requestId,first.requestId);
  assert.throws(()=>refreshed.reserveBillingSubmission('cashbook',{amount:50}),/awaiting confirmation/);
  user={id:'another',companyId:'company'};assert.equal(refreshed.pendingBillingSubmission('cashbook'),null);
  user={id:'user',companyId:'company'};refreshed.completeBillingSubmission('cashbook');assert.equal(stored.size,0);
});

test('staff role changes save revocation before attempting tenant synchronization and detail reads omit credentials',async()=>{
  const {StaffService}=require('../src/modules/staff/staff.service.ts');
  const writes=[];let detailQuery;
  const central={companyUser:{update:async({data})=>writes.push(data)}};
  const tenant={staff:{findFirst:async query=>{detailQuery=query;return {id:'staff',userId:'user'};}},user:{update:async()=>{throw Error('must use durable synchronization');}}};
  const service=new StaffService(central,null,{sync:async id=>{assert.equal(id,'user');assert.equal(writes.length,1);return true;}});
  const result=await service.updateAccountRole(tenant,'staff','MANAGER');
  assert.equal(result.syncPending,true);assert.equal(writes[0].identitySyncPending,true);assert.deepEqual(writes[0].sessionVersion,{increment:1});
  assert.equal(writes[0].role,'MANAGER');assert.equal(detailQuery.include.user.select.passwordHash,undefined);
  assert.equal(detailQuery.include.user.select.resetTokenHash,undefined);
});
