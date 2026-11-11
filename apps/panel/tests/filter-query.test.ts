import {test,expect} from 'bun:test';
import {readFilterQuery,writeFilterQuery} from '../src/lib/filter-query';
test('allowlisted filter writes preserve foreign context and reject arbitrary values',()=>{
 const schema={errors:['false','true'],limit:['100','250','500']};
 const p=writeFilterQuery(new URLSearchParams('keep=yes&inspect=42'),schema,{errors:'true',limit:'999',token:'secret'});
 expect(p.get('errors')).toBe('true');expect(p.has('limit')).toBe(false);expect(p.has('token')).toBe(false);expect(p.get('inspect')).toBe('42');expect(p.get('keep')).toBe('yes');
 expect(readFilterQuery(new URLSearchParams('errors=bad&limit=500'),schema,{errors:'false',limit:'250'})).toEqual({errors:'false',limit:'500'});
});
