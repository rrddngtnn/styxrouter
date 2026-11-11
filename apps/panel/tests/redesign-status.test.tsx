import {test,expect} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {DashboardView} from '../src/pages/Dashboard';
test('process reachability and credential checks never promise inference health',()=>{
 const html=renderToStaticMarkup(<MemoryRouter><DashboardView range="7d" onRange={()=>{}} now={0} health={{status:'ok',data:{ok:true}}} stats={{status:'error',error:new Error('Synthetic unavailable')}} conns={{status:'ok',data:{connections:[{id:'test',provider:'demo',name:'Synthetic',isActive:true,testStatus:null,lastError:null,backoffLevel:0,rateLimitedUntil:null,tokenExpiresAt:null}]}}} provs={{status:'ok',data:{providers:[]}}} logs={{status:'ok',data:[]}} /></MemoryRouter>);
 expect(html).toContain('Process reachable');
 expect(html).toContain('Credential checks');
 expect(html).not.toContain('checked healthy');
 expect(html).not.toContain('width:100%');
 expect(html).not.toContain('live model dispatch');
});
