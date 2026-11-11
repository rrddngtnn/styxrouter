import { expect, test } from 'bun:test';
import { initialNavState, navIsExpanded, navLabel, navReducer } from '../src/components/shell/navMachine';
import { navigation } from '../src/components/shell/navigation';
test('approved navigation groups preserve all eleven URLs', () => {
 expect(navigation.map(({group,label,to})=>({group,label,to}))).toEqual([
 {group:'',label:'Overview',to:'/'},
 {group:'Gateway',label:'Providers',to:'/providers'}, {group:'Gateway',label:'Models',to:'/models'}, {group:'Gateway',label:'Routing',to:'/routing'},
 {group:'Access',label:'Client API Keys',to:'/keys'}, {group:'Access',label:'Connect Tools',to:'/tools'},
 {group:'Monitoring',label:'Quota',to:'/quota'}, {group:'Monitoring',label:'Usage',to:'/usage'}, {group:'Monitoring',label:'Request Activity',to:'/activity'},
 {group:'System',label:'Audit Log',to:'/audit'}, {group:'System',label:'Settings',to:'/settings'}]);
});
test('desktop sidebar is persistent; mobile disclosure is initially closed',()=>{
 for(const desktop of [true,false]) {
 let state=initialNavState(desktop); expect(navIsExpanded(state)).toBe(desktop);
 state=navReducer(state,{type:'toggle'}); expect(navIsExpanded(state)).toBe(!desktop);
 expect(state.open).toBe(!desktop);
 state=navReducer(state,{type:'close'});expect(state.open).toBe(false);
 state=navReducer(state,{type:'breakpoint',desktop:!desktop});expect(state.open).toBe(false);
 }
});
