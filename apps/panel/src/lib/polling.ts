export function pollEligible({enabled,visible,active,pending}:{enabled:boolean;visible:boolean;active:boolean;pending:boolean}):boolean {
 return enabled && visible && active && !pending;
}
