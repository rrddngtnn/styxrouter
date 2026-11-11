import {test, expect} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {Tools, buildTunnelSnippets, ALL_TOOLS, buildSnippets} from '../src/pages/Tools';
import {ToolSnippet, API_PATHS} from '../src/components/ToolsWorkbench';

test('every existing recipe survives workbench selection and uses inert output',()=>{
 for(const client of ALL_TOOLS) {
  const recipes=buildSnippets(client.id,'https://router.example/v1','YOUR_STYX_KEY','provider/model');
  expect(recipes.length).toBeGreaterThan(0);
  for(const recipe of recipes)expect(recipe.body).not.toContain('/v1/v1');
 }
 expect(API_PATHS.map(p=>p.path)).toEqual(['chat/completions','messages','responses','models','embeddings']);
});

test('secret-bearing snippet payload is never rendered',()=>{
 const html=renderToStaticMarkup(<ToolSnippet title="Example" file="bash / zsh" body="YOUR_STYX_KEY" secretBody="synthetic-secret-sentinel"/>);
 expect(html).not.toContain('synthetic-secret-sentinel');
 expect(html).toContain('Copy with key');
});

test('client-first workbench provides grouped selection and placeholder-only preview',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'location');
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'http://127.0.0.1:5198',hostname:'localhost'}});
 const html=renderToStaticMarkup(<MemoryRouter><Tools/></MemoryRouter>);
 for(const label of ['Connect client','Network access','API reference','Choose client','Connection settings','Configuration preview','Search clients','Copy with key','Router request test']) expect(html).toContain(label);
 expect(html).toContain('optgroup');
 expect(html).toContain('YOUR_STYX_KEY');
 expect(html).not.toContain('antigravity/gemini-4-argon-high');
 expect(html).toContain('Not live verified');
 if(previous)Object.defineProperty(globalThis,'location',previous);else Reflect.deleteProperty(globalThis,'location');
});

test('SSH explicit ports match command and config without executable interpolation',()=>{
 const snippets=buildTunnelSnippets('ssh','30200','styx.example.com','alice@host.example',{sshPort:'2222',remotePort:'20128'});
 expect(snippets[0]!.body).toContain('-p 2222');
 expect(snippets[0]!.body).toContain('-L 127.0.0.1:30200:127.0.0.1:20128');
 expect(snippets[1]!.body).toContain('  Port 2222');
 expect(snippets[1]!.body).toContain('LocalForward 127.0.0.1:30200 127.0.0.1:20128');
 for(const bad of ['0','22;id','65536']) expect(()=>buildTunnelSnippets('ssh','30200','styx.example.com','alice@host',{sshPort:bad,remotePort:'20128'})).toThrow();
});
