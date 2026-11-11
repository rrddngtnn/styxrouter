import {test,expect} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {QuotaWindowInspector} from '../src/components/QuotaWindowInspector';
import {QuotaBrowser} from '../src/pages/Quota';
const win={key:'opaque-window',label:'Provider window',used:0,total:null,remaining:0,percentRemaining:null,resetAt:null,unlimited:false};
test('quota zero remains zero, unknown has no invented unit or reset',()=>{
 const html=renderToStaticMarkup(<QuotaWindowInspector windows={[win]} renderWindow={w=><p>{w.remaining}</p>}/>);
 expect(html).toContain('Quota window');expect(html).not.toContain('requests');expect(html).not.toContain('100%');
});
test('invalid quota percent is flagged, raw value retained, meter bounded',()=>{
 const row={connectionId:'fixture',provider:'codex',name:'Synthetic',quotaUsed:0,quotaTotal:null,percentRemaining:null,resetAt:null,tokenStatus:'unknown',windows:[{...win,percentRemaining:150}]};
 const html=renderToStaticMarkup(<QuotaBrowser rows={[row]} names={new Map()} live={{}} syncingAll={false} onRefresh={()=>{}} onCheckGroup={()=>{}}/>);
 expect(html).toContain('Invalid upstream percentage');expect(html).toContain('aria-valuenow="100"');expect(html).toContain('150%');expect(html).not.toContain('1,000 pts');
});
