// Local visual QA only: all APIs below are fake; no email provider or database is used.
import { createServer } from '../../frontend/node_modules/vite/dist/node/index.js';
import react from '../../frontend/node_modules/@vitejs/plugin-react/dist/index.mjs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { emailFixtures } from './email-fixtures.mjs';
const require=createRequire(import.meta.url);
const {renderEmail}=require('../dist/common/email/email-template.js');
Object.assign(process.env,{VITE_API_URL:'http://127.0.0.1:5179',EMAIL_PUBLIC_ORIGIN:'https://admin.maamulpro.site',TENANT_BASE_DOMAIN:'maamulpro.site',EMAIL_SUPPORT_ADDRESS:''});
process.chdir(fileURLToPath(new URL('../../frontend',import.meta.url)));
let requests=0;
async function preview(req,res,next) {
  const url=new URL(req.url,'http://127.0.0.1:5179');
  if(url.pathname==='/__emails') {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<h1>MaamulPro email previews</h1>'+emailFixtures().map((item,i)=>`<p><a href="/__email/${i}">${item.template}</a> · <a href="/__email/${i}?mobile">mobile</a> · <a href="/__email/${i}?text">plain text</a> · <a href="/__email/${i}?blocked">images blocked</a> · <a href="/__email/${i}?hostile">long/malicious text</a></p>`).join('')+'<a href="/__email_form">Email-change form</a>');return;
  }
  if(url.pathname.startsWith('/__email/')) {
    const item=emailFixtures()[Number(url.pathname.split('/').pop())];
    if(!item){res.statusCode=404;res.end();return;}
    if(url.searchParams.has('hostile')) {if(item.company)item.company.name='<script>not executable</script> '+ 'LongCompanyName'.repeat(20); else item.name='<img src=x onerror=alert(1)> '+ 'LongName'.repeat(20);}
    const result=renderEmail(item);
    let html=result.html.replaceAll('https://admin.maamulpro.site/assets/','/assets/');
    if(url.searchParams.has('blocked'))html=html.replace(/src="[^"]+"/g,'src="/missing-image"');
    if(url.searchParams.has('mobile')){res.setHeader('Content-Type','text/html');res.end(`<iframe title="Mobile email" style="width:320px;height:950px;border:1px solid #ccc" src="${url.pathname}"></iframe>`);return;}
    res.setHeader('Content-Type',url.searchParams.has('text')?'text/plain':'text/html');res.end(url.searchParams.has('text')?result.text:html);return;
  }
  if(url.pathname.startsWith('/api/')) {
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=raw?JSON.parse(raw):{};requests++;
    res.setHeader('Content-Type','application/json');
    // Slow synthetic response lets the reviewer inspect loading/disabled controls.
    setTimeout(()=>{
      if(url.pathname.endsWith('/verification'))res.end(JSON.stringify({success:true,data:{sent:true,expiresAt:new Date(Date.now()+600000).toISOString(),cooldownSeconds:60}}));
      else if(body.verificationCode!=='123456'){res.statusCode=400;res.end(JSON.stringify({message:'Verification code is incorrect.'}));}
      else res.end(JSON.stringify({success:true,data:{updated:true,syncPending:true,message:'Login email updated. Access is paused while the workspace synchronizes; sign in again shortly.'}}));
    },1200);return;
  }
  if(url.pathname==='/__email_form') {
    res.setHeader('Content-Type','text/html');
    res.end(await server.transformIndexHtml(req.url,`<!doctype html><html><head><title>Email change QA</title></head><body><div id="root"></div><script type="module">
      import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route,useLocation} from 'react-router-dom';import ChangeEmailForm from '/src/components/maamulpro/ChangeEmailForm.tsx';import '/src/tailwind.css';
      function Complete(){const location=useLocation();return React.createElement('p',{role:'status'},location.state?.message);}
      createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement('main',{style:{maxWidth:650,margin:'30px auto',padding:20}},React.createElement(Routes,null,React.createElement(Route,{path:'/__email_form',element:React.createElement(ChangeEmailForm,{currentEmail:'owner@example.test'})}),React.createElement(Route,{path:'/sign-in',element:React.createElement(Complete)})))));
    </script></body></html>`));return;
  }
  if(url.pathname==='/__requests'){res.setHeader('Content-Type','text/plain');res.end(String(requests));return;}
  next();
}
const server=await createServer({root:fileURLToPath(new URL('../../frontend',import.meta.url)),configFile:false,plugins:[react(),{name:'email-preview',configureServer(instance){instance.middlewares.use(preview);}}],server:{host:'127.0.0.1',port:5179,strictPort:true}});
await server.listen();console.log('Local email QA: http://127.0.0.1:5179/__emails');
