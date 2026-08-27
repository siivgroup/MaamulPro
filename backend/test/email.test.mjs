import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { emailFixtures } from './email-fixtures.mjs';
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
const { renderEmail, companyEmailLogo, emailOrigin } = require('../src/common/email/email-template.ts');
const { ResendEmailService } = require('../src/common/email/resend-email.service.ts');
const { AccountSecurityService, verifyPassword } = require('../src/common/security/account-security.service.ts');
const { Resend } = require('resend');

function environment(t) {
  const keys = ['TENANT_BASE_DOMAIN', 'EMAIL_PUBLIC_ORIGIN', 'EMAIL_SUPPORT_ADDRESS', 'RESEND_API_KEY', 'RESEND_FROM', 'BLOB_READ_WRITE_TOKEN'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  Object.assign(process.env, { TENANT_BASE_DOMAIN: 'maamulpro.site', EMAIL_PUBLIC_ORIGIN: 'https://admin.maamulpro.site', EMAIL_SUPPORT_ADDRESS: '', RESEND_API_KEY: 'test-secret-not-real', RESEND_FROM: 'MaamulPro <test@example.test>', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_store_test' });
}

test('every email shares accessible branding, useful text, and escaped dynamic content', t => {
  environment(t);
  for (const fixture of emailFixtures()) {
    const rendered = renderEmail(fixture);
    assert.match(rendered.html, /max-width:600px/);
    assert.match(rendered.html, /#0E8B8B/);
    assert.match(rendered.html, /email-logo\.png/);
    assert.match(rendered.html, /alt="[^"]+ logo"/);
    assert.match(rendered.text, /MaamulPro/);
    assert.doesNotMatch(rendered.html, /<script|javascript:|data:image|tracking-pixel/i);
    if (fixture.code) { assert.match(rendered.text, /123456/); assert.ok(rendered.html.includes(fixture.expiresAt.toISOString().slice(0,10))); assert.ok(!rendered.subject.includes(fixture.code)); }
    if (fixture.company) {
      fixture.company.name = '<script>alert("x")</script> & ' + 'LongCompany'.repeat(30);
      fixture.company.logoUrl = 'https://evil.example/logo.png';
      const hostile = renderEmail(fixture);
      assert.match(hostile.html, /&lt;script&gt;/); assert.doesNotMatch(hostile.html, /<script|https:\/\/evil/);
      assert.match(hostile.html, /alt="MaamulPro logo"/);
      assert.ok(hostile.subject.length <= 200);
    }
  }
  const notice = renderEmail({ template: 'account-change', recipient:'person@example.test', change:'password', changedAt:new Date(), administrator:true, admin:true });
  assert.match(notice.text,/by an administrator/); assert.match(notice.text,/\/superadmin\/forgot-password/);
  const digest = renderEmail(emailFixtures().find(item => item.template === 'digest'));
  assert.match(digest.text, /CRITICAL: 1; WARNING: 1/);
});

test('company logos stay in the configured store and company branding folder; email links cannot be injected', t => {
  environment(t);
  const company = { id:'ours',name:'Company',logoUrl:'https://store.public.blob.vercel-storage.com/ours/branding/logo.png' };
  assert.equal(companyEmailLogo(company),company.logoUrl);
  for (const logoUrl of ['https://store.public.blob.vercel-storage.com/other/branding/logo.png','https://otherstore.public.blob.vercel-storage.com/ours/branding/logo.png','https://store.private.blob.vercel-storage.com/ours/branding/logo.png','https://store.public.blob.vercel-storage.com/ours/avatars/photo.png','http://store.public.blob.vercel-storage.com/ours/branding/logo.png','javascript:alert(1)','https://store.public.blob.vercel-storage.com/ours/branding/logo.svg','https://store.public.blob.vercel-storage.com/ours/branding/logo.png?token=private']) assert.equal(companyEmailLogo({...company,logoUrl}),null,logoUrl);
  for (const origin of ['http://admin.maamulpro.site','https://evil.example','https://user:secret@admin.maamulpro.site','https://admin.maamulpro.site/path']) { process.env.EMAIL_PUBLIC_ORIGIN=origin; assert.throws(()=>emailOrigin()); }
  process.env.EMAIL_PUBLIC_ORIGIN='https://admin.maamulpro.site';
  assert.throws(()=>emailOrigin('../evil'));
  assert.equal(emailOrigin('horseed'),'https://horseed.maamulpro.site');
});

test('Resend receives rendered HTML/text and attachments, while errors and logs never expose provider payloads', async t => {
  environment(t); const logs=[], bodies=[];
  const service=new ResendEmailService();
  for(const method of ['log','warn','error']) t.mock.method(service.logger,method,message=>logs.push(message));
  let response={data:{id:'provider-id'},error:null};
  t.mock.method(Resend.prototype,'post',async(path,body)=>{assert.equal(path,'/emails');bodies.push(body);if(response instanceof Error)throw response;return response;});
  const input={to:['recipient@example.test'],content:emailFixtures()[0],attachments:[{filename:'report.csv',content:Buffer.from('a,b')}]};
  assert.deepEqual(await service.send(input),{sent:true,id:'provider-id'});
  assert.ok(bodies[0].html && bodies[0].text && bodies[0].attachments.length===1);
  assert.equal(bodies[0].from,process.env.RESEND_FROM);
  for(const failure of [{data:null,error:{message:'raw-secret 123456 recipient@example.test'}},{data:{},error:null},new Error('raw-secret 123456 recipient@example.test')]) {response=failure; assert.equal((await service.send(input)).sent,false);}
  assert.ok(logs.some(line=>line.includes('email_provider_accepted')));
  assert.doesNotMatch(logs.join('\n'),/raw-secret|123456|recipient@example|test-secret/);
  const count=bodies.length; process.env.EMAIL_PUBLIC_ORIGIN='https://evil.example';
  assert.equal((await service.send(input)).sent,false); assert.equal(bodies.length,count);
  process.env.RESEND_API_KEY=''; assert.equal((await service.send(input)).sent,false);
});

test('current passwords support bcrypt and Argon2; failed notices never undo a committed change', async t => {
  environment(t);
  for (const hash of [await require('bcryptjs').hash('Correct123',4),await require('argon2').hash('Correct123')]) {
    assert.equal(await verifyPassword(hash,'Correct123'),true); assert.equal(await verifyPassword(hash,'incorrect'),false);
  }
  assert.equal(await verifyPassword('bad-hash','Correct123'),false);
  const sent=[];
  const security=new AccountSecurityService({}, {send:async input=>{sent.push(input);return {sent:false};}}, {});
  await security.notifyChange({email:'old@example.test'},'email',true,'new@example.test');
  assert.deepEqual(sent.map(input=>input.to[0]),['old@example.test','new@example.test']);
  assert.ok(sent.every(input=>input.content.administrator && !('password' in input.content)));
  security.email.send=async()=>{throw new Error('provider outage');};
  await security.notifyChange({email:'old@example.test'},'password');
});

test('credential endpoints reject impersonation and redact internal failures', t => {
  const {SettingsController}=require('../src/modules/settings/settings.controller.ts');
  const {StaffController}=require('../src/modules/staff/staff.controller.ts');
  const {GlobalExceptionFilter}=require('../src/common/filters/http-exception.filter.ts');
  const settings=new SettingsController({}),staff=new StaffController({});
  const impersonated={id:'someone',isImpersonating:true};
  assert.throws(()=>settings.changePassword({},impersonated,{}),error=>error.getStatus()===403);
  assert.throws(()=>settings.sendEmailVerification(impersonated,{}),error=>error.getStatus()===403);
  assert.throws(()=>settings.changeEmail(impersonated,{}),error=>error.getStatus()===403);
  assert.throws(()=>staff.resetPassword({},'id',{},impersonated),error=>error.getStatus()===403);
  assert.throws(()=>staff.updateEmail({},'id',{},impersonated),error=>error.getStatus()===403);
  const filter=new GlobalExceptionFilter(),logs=[];let response;
  t.mock.method(filter.logger,'error',(...args)=>logs.push(args));
  filter.catch(new Error('raw password=very-secret postgresql://secret@db'),{switchToHttp:()=>({getRequest:()=>({method:'POST',url:'/api/auth/password/reset?password=very-secret',path:'/api/auth/password/reset',requestId:'test-reference'}),getResponse:()=>({status:()=>({json:value=>{response=value;}})})})});
  assert.doesNotMatch(JSON.stringify({logs,response}),/very-secret|postgresql:\/\//);
  assert.equal(response.requestId,'test-reference');
});
