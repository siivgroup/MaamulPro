import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('money and inventory workflows keep database-backed concurrency controls', async () => {
  const [payroll, materials, rentals, tenantSql] = await Promise.all([
    read('../src/modules/payroll/payroll.service.ts'),
    read('../src/modules/material-management/material-management.service.ts'),
    read('../src/modules/real-estate/real-estate.service.ts'),
    read('../src/common/database/tenant-schema-sql.ts'),
  ]);
  assert.match(tenantSql, /CREATE UNIQUE INDEX[^\n]+payrolls_year_month_active_key[^\n]+WHERE "deleted_at" IS NULL/);
  assert.match(payroll, /P2002|already exists/i);
  assert.match(materials, /quantity: \{ gte: quantity \}/);
  assert.match(materials, /quantity: \{ increment: direction \* quantity \}/);
  assert.match(materials, /Insufficient stock/i);
  assert.match(materials, /DRAFT: \['ORDERED', 'RECEIVED', 'CANCELLED'\]/);
  assert.match(materials, /PENDING: \['IN_TRANSIT', 'DELIVERED', 'CANCELLED'\]/);
  assert.match(rentals, /FOR UPDATE/);
  assert.match(rentals, /concurrent claims on the same property serialize/);
  assert.match(rentals, /property\.status !== 'AVAILABLE'/);
});

test('real-estate financial documents require positive amounts', async () => {
  const dto = await read('../src/modules/real-estate/real-estate.dto.ts');
  assert.match(dto, /@Min\(0\.01\) totalAmount: number/);
  assert.match(dto, /@Min\(0\.01\) monthlyRent: number/);
  assert.match(dto, /@Min\(0\.01\) amountDue: number/);
});

test('real-estate and payroll never swallow accounting failures', async () => {
  const [realEstate, payroll] = await Promise.all([
    read('../src/modules/real-estate/real-estate.service.ts'),
    read('../src/modules/payroll/payroll.service.ts'),
  ]);
  assert.doesNotMatch(realEstate, /safePost/);
  assert.doesNotMatch(payroll, /safePost/);
});

import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require=createRequire(import.meta.url);require('ts-node/register/transpile-only');
const { FinancialsService }=require('../src/modules/financials/financials.service.ts');
const { ConflictException }=require('@nestjs/common');

function cashbookFixture(){
  const state={rows:[],batches:[]};let failure=null,lost=false;
  const tx={
    $queryRawUnsafe:async()=>[], $executeRawUnsafe:async()=>0,
    transaction:{
      findUnique:async({where})=>state.rows.find(row=>Object.entries(where).every(([key,value])=>row[key]===value)),
      findFirst:async({where})=>state.rows.find(row=>row.id===where.id&&!row.deletedAt),
      create:async({data})=>{if(failure==='source')throw Error('source failure');const row={id:randomUUID(),version:0,...data};state.rows.push(row);return {...row};},
      update:async({where,data})=>{if(failure==='source')throw Error('source failure');const row=state.rows.find(row=>row.id===where.id);Object.assign(row,{...data,version:row.version+1});return {...row};},
    },
  };
  let queue=Promise.resolve();tx.$transaction=fn=>{const run=queue.then(async()=>{const before=structuredClone(state);let result;try{result=await fn(tx);}catch(error){Object.assign(state,before);throw error;}if(lost){lost=false;throw Error('response lost');}return result;});queue=run.catch(()=>{});return run;};
  const accounting={
    postFinancialEvent:async(_db,{tx:passed})=>{assert.equal(passed,tx);if(failure==='post')throw new ConflictException('Accounting period is locked');const batch={id:randomUUID(),reversed:false};state.batches.push(batch);return batch;},
    reverseBatchWithinTx:async(passed,{batchId})=>{assert.equal(passed,tx);if(failure==='reverse')throw new ConflictException('Reversal refused');state.batches.find(row=>row.id===batchId).reversed=true;},
  };
  return {state,tx,service:new FinancialsService(accounting,{}),fail:value=>{failure=value;},loseResponse:()=>{lost=true;}};
}

test('cashbook creation and journal posting roll back together, including locked periods',async()=>{
  const f=cashbookFixture(), data={type:'INCOME',amount:50,description:'Receipt',status:'CLEARED',idempotencyKey:randomUUID()};
  f.fail('post');await assert.rejects(f.service.createTransaction(f.tx,data),error=>error.getResponse().code==='TRANSACTION_REJECTED');
  assert.equal(f.state.rows.length,0);assert.equal(f.state.batches.length,0);
  f.fail('source');await assert.rejects(f.service.createTransaction(f.tx,data),/source failure/);assert.equal(f.state.batches.length,0);
  f.fail(null);const saved=await f.service.createTransaction(f.tx,data);assert.equal(saved.postingStatus,'POSTED');assert.equal(f.state.batches.length,1);
});

test('cashbook lost-response replay and concurrent duplicates retain one row and immutable input identity',async()=>{
  const f=cashbookFixture(),data={type:'INCOME',amount:50,description:'Receipt',status:'CLEARED',idempotencyKey:randomUUID()};
  f.loseResponse();await assert.rejects(f.service.createTransaction(f.tx,data),/response lost/);
  const [a,b]=await Promise.all([f.service.createTransaction(f.tx,data),f.service.createTransaction(f.tx,data)]);
  assert.equal(a.id,b.id);assert.equal(f.state.rows.length,1);assert.equal(f.state.batches.length,1);
  await assert.rejects(f.service.createTransaction(f.tx,{...data,amount:60}),error=>error.getResponse().code==='SUBMISSION_CONFLICT');
  await f.service.updateTransaction(f.tx,a.id,{description:'Edited later',version:0});
  assert.equal((await f.service.createTransaction(f.tx,data)).id,a.id);
  assert.equal(f.state.rows.length,1);
});

test('cashbook failed reversal or repost preserves the original row and journal',async()=>{
  const f=cashbookFixture(),data={type:'INCOME',amount:50,description:'Receipt',status:'CLEARED',idempotencyKey:randomUUID()};
  const saved=await f.service.createTransaction(f.tx,data), before=structuredClone(f.state);
  f.fail('reverse');await assert.rejects(f.service.deleteTransaction(f.tx,saved.id),/Reversal refused/);assert.deepEqual(f.state,before);
  await assert.rejects(f.service.updateTransaction(f.tx,saved.id,{amount:99,version:0}),/Reversal refused/);assert.deepEqual(f.state,before);
  f.fail('post');await assert.rejects(f.service.updateTransaction(f.tx,saved.id,{amount:99,version:0}),/locked/);assert.deepEqual(f.state,before);
  f.fail(null);await f.service.updateTransaction(f.tx,saved.id,{amount:99,version:0});
  await assert.rejects(f.service.updateTransaction(f.tx,saved.id,{amount:80,version:0}),error=>error.getStatus()===409);
  await f.service.deleteTransaction(f.tx,saved.id);await f.service.deleteTransaction(f.tx,saved.id);
  assert.equal(f.state.batches.filter(row=>!row.reversed).length,0);
});

test('source-managed cashbook rows can only be changed from their source module',async()=>{
  const f=cashbookFixture(), id=randomUUID();
  f.state.rows.push({id,referenceId:`expense:${id}`,version:0,deletedAt:null,journalBatchId:null});
  await assert.rejects(f.service.updateTransaction(f.tx,id,{amount:99,version:0}),error=>error.getStatus()===400);
  await assert.rejects(f.service.deleteTransaction(f.tx,id),error=>error.getStatus()===400);
});
