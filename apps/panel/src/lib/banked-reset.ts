export type ResetCredit = {selectionToken:string;title?:string;resetType?:string;description?:string;expiresAt?:string|null};
export type ResetInventory = {provider:string;isActive?:boolean;loading:boolean;error:string|null;availableCount:number|null;credits:ResetCredit[]};
/** Cached counts and unknown counts never authorize a spend. */
export function canRedeemCredit(inventory:ResetInventory, token:string):boolean {
 return inventory.provider==='codex' && inventory.isActive!==false && !inventory.loading && !inventory.error && inventory.availableCount!==null && Number.isSafeInteger(inventory.availableCount) && inventory.availableCount>0 && !!token && inventory.credits.some(c=>c.selectionToken===token);
}
export function redemptionOutcome(value:{ok?:boolean;outcome?:string;quotaRefreshed?:boolean}):'confirmed'|'partial'|'unknown' {
 if(value.ok!==true || !['reset','alreadyRedeemed'].includes(value.outcome??''))return 'unknown';
 return value.quotaRefreshed===true?'confirmed':'partial';
}
