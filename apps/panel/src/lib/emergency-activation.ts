import {api} from './api';

/** Freeze the confirmed plan; never retry uncertain writes or expand its scope. */
export async function applyEmergencyActivation(ids: readonly string[], isActive: boolean) {
 const plan=[...new Set(ids)];
 let succeeded=0, failed=0, unknown=0;
 for(let offset=0;offset<plan.length;offset+=100) {
  const batch=plan.slice(offset,offset+100);
  try {
   const data=await api.post<{results?: {id:string;success:boolean;isActive?:boolean}[]}>('/api/connections/bulk-activation',{ids:batch,isActive});
   const results=Array.isArray(data?.results)?data.results:[];
   for(const id of batch) {
    const matches=results.filter(result=>result?.id===id);
    if(matches.length!==1) unknown++;
    else if(matches[0].success===true && matches[0].isActive===isActive) succeeded++;
    else if(matches[0].success===false) failed++;
    else unknown++;
   }
   if(unknown) {unknown+=plan.length-offset-batch.length;break;}
  } catch {
   unknown+=plan.length-offset;
   break;
  }
 }
 return {succeeded,failed,unknown,total:plan.length};
}
