// Transport abort is advisory; ownership still decides whether a response can commit.
export function applyReadResult<T>(generation:number,current:number,result:T):T|null {
 return generation===current ? result : null;
}
