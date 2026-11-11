import {when} from './format';
/** No heuristic seconds/milliseconds conversion; API contract is a zoned timestamp. */
export function quotaResetLabel(value:unknown, now:number=Date.now()): {kind:'unknown'|'past'|'scheduled';label:string} {
 if(typeof value!=='string'||!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)||!Number.isFinite(Date.parse(value)))return {kind:'unknown',label:'Reset time not reported'};
 return {kind:Date.parse(value)<=now?'past':'scheduled',label:when(value)};
}
