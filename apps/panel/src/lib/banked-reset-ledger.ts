type StorageAccess = Pick<Storage,'getItem'|'setItem'>;
type Identity = {account:string;credit:string};
type Attempt = Identity & {attemptId:string;status:'unknown'|'committed'|'rejected'};
const namespace='styx:banked-reset:v1:';
const digestPattern=/^[a-f0-9]{64}$/;
const unavailable='Reset-credit safety storage unavailable. No credit was sent. Redemption is disabled; request diagnostics before proceeding.';
/** Hash identities only; never persist selectionToken, account names, credentials or raw responses. */
export async function creditIdentity(account:string,credit:string):Promise<Identity> {
 const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
 return {account:await hash(JSON.stringify(['codex',account])),credit:await hash(JSON.stringify(['codex',account,credit]))};
}
export function readCreditAttempts(storage:StorageAccess,account:string):Attempt[] {
 try {
  if(!digestPattern.test(account))throw Error();
  const raw=storage.getItem(namespace+account);
  if(raw===null)return [];
  const records:unknown=JSON.parse(raw);
  if(!Array.isArray(records)||records.some(a=>!a||a.account!==account||!digestPattern.test(a.credit)||!/^[a-f0-9-]{36}$/.test(a.attemptId)||!['unknown','committed','rejected'].includes(a.status)||Object.keys(a).sort().join(',')!=='account,attemptId,credit,status'))throw Error();
  return records;
 }catch{throw Error(unavailable);}
}
function save(storage:StorageAccess,account:string,records:Attempt[]) {
 try {const raw=JSON.stringify(records);storage.setItem(namespace+account,raw);if(storage.getItem(namespace+account)!==raw)throw Error();}catch{throw Error(unavailable);}
}
/** Synchronous write + read-back before POST. Unresolved account fence is intentionally conservative. */
export function beginCreditAttempt(storage:StorageAccess,id:Identity):Attempt {
 const records=readCreditAttempts(storage,id.account);
 if(records.some(a=>a.status==='unknown'))throw Error('Outcome unknown. Redemption locked for this account in this tab. Request diagnostics using the attempt ID; inventory alone cannot resolve it.');
 const existing=records.find(a=>a.credit===id.credit);
 if(existing?.status==='committed')throw Error('This credit was already confirmed redeemed. Refresh inventory; do not redeem it again.');
 const attempt:Attempt={...id,attemptId:existing?.attemptId??crypto.randomUUID(),status:'unknown'};
 save(storage,id.account,[...records.filter(a=>a.credit!==id.credit),attempt]);
 return attempt;
}
/** Call only for the original POST's authoritative response, never an inventory reread. */
export function settleCreditAttempt(storage:StorageAccess,id:Identity,attemptId:string,status:'committed'|'rejected') {
 const records=readCreditAttempts(storage,id.account);
 const attempt=records.find(a=>a.credit===id.credit&&a.attemptId===attemptId);
 if(!attempt)throw Error(unavailable);
 save(storage,id.account,records.map(a=>a===attempt?{...a,status}:a));
}
