import {expect,test} from 'bun:test';
import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
import {useNavDisclosure} from '../src/components/shell/useNavDisclosure';
test('navigation renders without window or storage during SSR',()=>{
 function Nav(){const nav=useNavDisclosure();return createElement('button',{'aria-expanded':nav.isExpanded},nav.label);}
 expect(typeof window).toBe('undefined');
 expect(renderToString(createElement(Nav))).toContain('Open navigation');
});
import {initialNavState,navIsExpanded,navLabel,navReducer} from '../src/components/shell/navMachine';
test('desktop persistent sidebar toggles independently from transient mobile drawer',()=>{
 let state=initialNavState(true);expect(navIsExpanded(state)).toBe(true);expect(state.open).toBe(false);
 state=navReducer(state,{type:'close'});expect(navIsExpanded(state)).toBe(true);
 state=navReducer(state,{type:'toggle'});expect(navIsExpanded(state)).toBe(false);expect(navLabel(state)).toBe('Expand navigation');
 state=navReducer(state,{type:'breakpoint',desktop:false});expect(state.open).toBe(false);
 state=navReducer(state,{type:'toggle'});expect(state.open).toBe(true);
 state=navReducer(state,{type:'breakpoint',desktop:true});expect(state.open).toBe(false);expect(navIsExpanded(state)).toBe(false);
});
test('mobile closes on route without changing desktop preference',()=>{
 let state=initialNavState(false);state=navReducer(state,{type:'toggle'});expect(navIsExpanded(state)).toBe(true);
 state=navReducer(state,{type:'close'});expect(navIsExpanded(state)).toBe(false);
 state=navReducer(state,{type:'breakpoint',desktop:true});expect(navIsExpanded(state)).toBe(true);
});
