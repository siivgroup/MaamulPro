// Local browser QA for the real progress component; never connects to an account.
import { createServer } from '../../frontend/node_modules/vite/dist/node/index.js';
import react from '../../frontend/node_modules/@vitejs/plugin-react/dist/index.mjs';
import { fileURLToPath } from 'node:url';

process.env.VITE_API_URL = 'http://127.0.0.1:5178';
process.chdir(fileURLToPath(new URL('../../frontend', import.meta.url)));
const id = '12345678-1234-4234-8234-123456789abc';
let retried = false;
const pendingActions = [];
let actionRequests = 0;
const financialRows = [];
const financialRequests = [];
const previewUser = { id: 'preview', email: 'preview@example.test', role: 'SUPER_ADMIN', isSuperAdmin: true, isImpersonating: true };
async function preview(req, res, next) {
  if (req.url?.startsWith('/api/financials/')) {
    res.setHeader('Content-Type','application/json');
    if (req.method === 'POST') {
      let raw=''; for await (const chunk of req) raw += chunk;
      const input=JSON.parse(raw), referenceId=req.headers['x-idempotency-key'];
      financialRequests.push(referenceId);
      let row=financialRows.find(row=>row.referenceId===referenceId);
      if(!row){row={...input,id:'saved-financial-row',referenceId,version:0,date:input.date||new Date().toISOString()};financialRows.push(row);}
      // The first write commits, but its acknowledgement is unreadable.
      res.end(financialRequests.length===1 ? '{lost response' : JSON.stringify({success:true,data:row})); return;
    }
    const data=req.url.includes('/summary') ? {totalIncome:35,totalExpense:0,netBalance:35,totalCount:financialRows.length} : req.url.includes('/transactions') ? {data:financialRows} : [];
    res.end(JSON.stringify({success:true,data})); return;
  }
  if(req.url==='/__financial_preview') {
    res.setHeader('Content-Type','text/html');
    res.end(await server.transformIndexHtml(req.url,`<!doctype html><html><head><title>Financial retry QA</title></head><body><div id="root"></div><script type="module">
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {BrowserRouter} from 'react-router-dom';
      import Financials from '/src/pages/FinancialsPage.tsx'; import {sessionStore} from '/src/lib/api.ts'; import '/src/tailwind.css';
      sessionStore.set({accessToken:'local-preview-only',user:${JSON.stringify(previewUser)}});
      createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(Financials)));
    </script></body></html>`));return;
  }
  if(req.url==='/__financial_results') {
    res.setHeader('Content-Type','text/html');res.end(`<h1>Financial retry results</h1><p>Rows: ${financialRows.length}</p><p>Requests: ${financialRequests.length}</p><p>Distinct references: ${new Set(financialRequests).size}</p>`);return;
  }
  if (req.url === '/api/auth/session' || (req.url === '/api/__modal_preview/crud' && req.method === 'GET')) {
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ success: true, data: req.url.includes('/auth/') ? previewUser : [] })); return;
  }
  if (req.url?.startsWith('/api/__modal_preview/')) {
    actionRequests++;
    pendingActions.push(res);
    return;
  }
  if (req.url?.startsWith('/__preview/finish')) {
    const failed = req.url.includes('fail');
    for (const action of pendingActions.splice(0)) {
      action.writeHead(failed ? 409 : 200, { 'Content-Type': 'application/json' });
      action.end(JSON.stringify(failed ? { message: 'Test save refused. Your form is still available.' } : { success: true, data: { requests: actionRequests } }));
    }
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ requests: actionRequests })); return;
  }
  if (req.url === '/__preview/count') {
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ requests: actionRequests })); return;
  }
  if (req.url?.startsWith('/__modal_preview')) {
    res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml(req.url, `<!doctype html><html><head><title>Modal QA</title></head><body><div id="root"></div><script type="module">
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {Modal,FormActions,Field} from '/src/components/maamulpro/PageKit.tsx';
      import {GlobalProgressBar} from '/src/components/maamulpro/GlobalProgressBar.tsx';
      import CrudPage from '/src/pages/CrudPage.tsx'; import {BrowserRouter} from 'react-router-dom';
      import {api,sessionStore} from '/src/lib/api.ts'; import '/src/tailwind.css';
      const h=React.createElement;
      const crud=location.search==='?crud';
      if(crud)sessionStore.set({accessToken:'local-preview-only',user:${JSON.stringify(previewUser)}});
      const fields=[{name:'name',label:'Record name',required:true}];
      function Preview() {
        const [open,setOpen]=useState(true), [name,setName]=useState('Example record'), [error,setError]=useState(''), [result,setResult]=useState(''), [count,setCount]=useState(0);
        const perform=async(method)=>{setError('');try{const value=await api('/api/__modal_preview/record',{method,silent:true,body:method==='GET'?undefined:JSON.stringify({name})});setResult('Completed '+method);if(method!=='GET')setOpen(false);}catch(reason){setError(reason.message);}};
        const control=async(path)=>{const value=await fetch(path).then(r=>r.json());setCount(value.requests);};
        return h('main',{style:{maxWidth:900,margin:'40px auto',padding:20}},
          h(GlobalProgressBar), h('h1',null,'Shared modal QA'), h('p',null,result), h('button',{onClick:()=>setOpen(true)},'Open form'),
          crud?h(BrowserRouter,null,h(CrudPage,{title:'Example records',description:'Local QA',endpoint:'/api/__modal_preview/crud',fields,initialMode:'create'})):h(Modal,{title:'Edit example record',open,onClose:()=>setOpen(false)},h('form',{onSubmit:e=>{e.preventDefault();void perform('POST');},className:'space-y-4'},
            error&&h('p',{role:'alert'},error),h(Field,{label:'Name',required:true},h('input',{className:'form-input',required:true,value:name,onChange:e=>setName(e.target.value)})),
            h('button',{type:'button',className:'btn btn-outline-danger',onClick:()=>perform('DELETE')},'Delete record'),
            h('button',{type:'button',className:'btn btn-outline-info',onClick:()=>perform('GET')},'Load background data'),
            h(FormActions,{onCancel:()=>setOpen(false),saveLabel:'Save record'}))),
          h('aside',{'aria-label':'QA server controls',style:{position:'fixed',bottom:10,right:10,zIndex:10001,background:'white',padding:16,border:'1px solid #ddd'}},
            h('p',null,'Requests received: '+count),
            ...[['Finish request','/__preview/finish'],['Fail request','/__preview/finish?fail'],['Check request count','/__preview/count']].map(([label,path])=>h('button',{key:label,className:'btn btn-sm btn-outline-primary mt-2',onClick:()=>control(path)},label))));
      }
      createRoot(document.getElementById('root')).render(h(Preview));
    </script></body></html>`)); return;
  }
  if (req.url?.startsWith('/api/superadmin/onboarding/')) {
    if (req.method === 'POST') retried = true;
    const data = { onboardingId: id, companyId: 'test-company', status: retried ? 'SUCCEEDED' : 'FAILED', stage: retried ? 'FINALIZATION' : 'READINESS',
      error: retried ? null : { code: 'SETUP_ECONNRESET', message: 'The database connection was interrupted or timed out. Your setup is saved.', retryable: true, nextAction: 'Retry the saved setup.' },
      result: retried ? { id: 'test-company', name: 'Example company', adminEmail: 'owner@example.test', dbName: 'tenant_test_reference', loginUrl: 'https://example.test/sign-in', modulesEnabled: ['Construction'], accessGranted: false } : null };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true, data })); return;
  }
  if (req.url === '/__onboarding_preview') {
    res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml(req.url, `<!doctype html><html><head><title>Onboarding QA</title></head><body><div id="root"></div><script type="module">
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {BrowserRouter} from 'react-router-dom';
      import Progress from '/src/components/maamulpro/OnboardingProgress.tsx'; import '/src/tailwind.css';
      createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement('main',{style:{maxWidth:900,margin:'40px auto',padding:20}},React.createElement(Progress,{id:'${id}'}))));
    </script></body></html>`)); return;
  }
  next();
}
const server = await createServer({ root: fileURLToPath(new URL('../../frontend', import.meta.url)), configFile: false, plugins: [react(), { name: 'onboarding-preview', configureServer(instance) { instance.middlewares.use(preview); } }], server: { host: '127.0.0.1', port: 5178, strictPort: true } });
await server.listen();
console.log('Onboarding UI fixture: http://127.0.0.1:5178/__onboarding_preview');
console.log('Modal UI fixture: http://127.0.0.1:5178/__modal_preview (use QA controls to finish/fail held requests)');
