import {test,expect} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {Card,StatusBadge} from '../src/components/OperationalUI';
test('five card families keep static sections distinct from navigable cards',()=>{
 for(const kind of ['provider','metric','quota','attention','section'] as const){
 const html=renderToStaticMarkup(<Card kind={kind} title="Synthetic card" description="Fixture only">Content</Card>);
 expect(html).toContain(`data-card-family="${kind}"`);expect(html).toContain('Synthetic card');expect(html).not.toContain('role="button"');
 }
});
test('status retains explicit text and separates unknown stale and error semantics',()=>{
 for(const state of ['unknown','stale','error','success','warning','disabled'] as const){
 const html=renderToStaticMarkup(<StatusBadge state={state}>{state}</StatusBadge>);expect(html).toContain(`data-status="${state}"`);expect(html).toContain(state);
 }
});
