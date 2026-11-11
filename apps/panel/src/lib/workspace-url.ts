import {useSearchParams} from 'react-router-dom';
/** Additive workspace state: preserve unrelated query keys and legacy routes. */
export function useWorkspaceURL<T extends string>(values: readonly T[], fallback:T): [T,(next:T)=>void] {
 const [params,setParams]=useSearchParams();const raw=params.get('tab');
 const current=values.includes(raw as T)?raw as T:fallback;
 return [current,next=>{const updated=new URLSearchParams(params);updated.set('tab',next);setParams(updated);}];
}
