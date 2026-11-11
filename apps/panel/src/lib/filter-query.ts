import {useSearchParams} from 'react-router-dom';
export type FilterSchema = Record<string, readonly string[]>;
export function readFilterQuery(params:URLSearchParams,schema:FilterSchema,defaults:Record<string,string>) {
 return Object.fromEntries(Object.keys(schema).map(key=>{const value=params.get(key);return [key,value!==null&&schema[key].includes(value)?value:defaults[key]];}));
}
export function writeFilterQuery(params:URLSearchParams,schema:FilterSchema,values:Record<string,string>) {
 const next=new URLSearchParams(params);
 for(const [key,value] of Object.entries(values))if(Object.hasOwn(schema,key)){if(schema[key].includes(value))next.set(key,value);else next.delete(key);}
 return next;
}
/** Only enumerated, non-secret filters enter history. Free-text search stays in memory. */
export function useFilterQuery(schema:FilterSchema,defaults:Record<string,string>) {
 const [params,setParams]=useSearchParams();
 const values=readFilterQuery(params,schema,defaults);
 const commit=(patch:Record<string,string>,replace=false)=>setParams(previous=>writeFilterQuery(previous,schema,patch),{replace});
 return {values,commit};
}
export const pageValues=Array.from({length:10000},(_,i)=>String(i+1));
export const pageSizes=['15','20','50','100'];
