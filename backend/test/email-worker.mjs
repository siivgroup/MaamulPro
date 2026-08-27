// Failure-injection worker: disposable database only, no provider or production configuration.
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
require('@nestjs/common').Logger.overrideLogger(false);
if(process.env.E2E_DATABASES_ARE_DISPOSABLE!=='true' || !process.env.TEST_CENTRAL_DATABASE_URL) throw Error('Disposable central database required');
process.env.CENTRAL_DATABASE_URL=process.env.TEST_CENTRAL_DATABASE_URL;
process.env.CENTRAL_DATABASE_DIRECT_URL=process.env.TEST_CENTRAL_DATABASE_URL;
const {CentralPrismaService}=require('../dist/common/database/central-prisma.service.js');
const {AccountSecurityService}=require('../dist/common/security/account-security.service.js');
const central=new CentralPrismaService();
const security=new AccountSecurityService(central,{send:async()=>({sent:true,id:'test'})},{sync:async()=>false});
const [action,email,code]=process.argv.slice(2);
try {
  if(action==='issue') await security.issue(email,'COMPANY_ONBOARDING');
  else if(action==='reset') await security.resetPassword(email,code,'Recovered123');
  else throw Error('Unknown test action');
  process.stdout.write(JSON.stringify({ok:true}));
} catch(error) { process.stdout.write(JSON.stringify({ok:false,status:error.getStatus?.() || 500})); }
finally { await central.onModuleDestroy(); }
