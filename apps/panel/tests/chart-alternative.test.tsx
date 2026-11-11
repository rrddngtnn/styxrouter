import {test,expect} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {BarChart} from '../src/lib/charts';
import {TrafficGraph} from '../src/pages/dashboard-traffic';
test('charts retain readable native table alternative for exact values on small screens',()=>{
 const bar=renderToStaticMarkup(<BarChart data={[{label:'Synthetic day',value:24}]} interactive/>);
 expect(bar).toContain('<table');expect(bar).toContain('Synthetic day');expect(bar).toContain('24');
 const traffic=renderToStaticMarkup(<TrafficGraph days={[{date:'2026-11-11',requests:24,totalTokens:2000,promptTokens:1200,completionTokens:800,cost:.02}]}/>);
 expect(traffic).toContain('<table');expect(traffic).toContain('2026-11-11');expect(traffic).toContain('24');
});
