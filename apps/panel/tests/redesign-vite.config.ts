import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react-swc';
import {known,analytics} from './redesign-api.fixture.mjs';
// Test-only HTTP API. No proxies, provider adapters, real cookies, DB or credentials.
export default defineConfig({plugins:[react(),{name:'synthetic-preview-label',transformIndexHtml(html){return html.replace('<body>','<body><div role="note" style="padding:8px 16px;background:#403620;color:#E7C27C;font:14px monospace">SYNTHETIC QA PREVIEW · read-only fixture API · no live providers</div>');}},{name:'fixture-api-fence',configureServer(server){
 server.middlewares.use((req,res,next)=>{
 const url=new URL(req.url??'/', 'http://127.0.0.1:5198');
 if(!/^\/(api|v1)(\/|$)/.test(url.pathname))return next();
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('X-Styx-Fixture','synthetic-not-production');
 if(req.method!=='GET'){res.statusCode=501;res.end(JSON.stringify({error:'Synthetic preview is read-only. Mutation tests must explicitly intercept each action.'}));return;}
 const fixture=url.pathname==='/api/usage/analytics'?{...analytics,range:url.searchParams.get('range')??'7d',provider:url.searchParams.get('provider')??null}:known[url.pathname];
 if(fixture===undefined){res.statusCode=501;res.end(JSON.stringify({error:'Synthetic fixture API: unsupported path'}));return;}
 res.end(JSON.stringify(fixture));
 });
 }}],base:'/panel/',server:{host:'127.0.0.1',port:5198,strictPort:true}});
