/** Console reports USD per request, never an account balance. No arbitrary provider fields. */
export function pickOpencodeBilling(value: unknown): Record<string, unknown> {
 const result: Record<string, unknown> = {};
 if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
 const usage=value as Record<string, unknown>;
 const finite=(n:unknown):n is number=>typeof n==='number' && Number.isFinite(n) && n>=0;
 const raw=usage.opencode;
 if (!raw || typeof raw!=='object' || Array.isArray(raw)) return result;
 const source=raw as Record<string, unknown>;
 if (typeof source.billing_source !== 'string' || !['free','balance','go','go-plus','byok'].includes(source.billing_source)) return result;
 const clean: Record<string, unknown>={billing_source:source.billing_source};
 if(finite(usage.cost)) result.cost=usage.cost;
 for(const k of ['list_cost','allowance']) if(finite(source[k])) clean[k]=source[k];
 if(typeof source.estimated==='boolean') clean.estimated=source.estimated;
 if(source.tokens && typeof source.tokens==='object' && !Array.isArray(source.tokens)) {
  const tokens:Record<string,number>={};
  for(const k of ['input','output','reasoning','cache_read','cache_write_5m','cache_write_1h']) {
   const n=(source.tokens as Record<string,unknown>)[k];if(finite(n)&&Number.isSafeInteger(n)) tokens[k]=n;
  }
  if(Object.keys(tokens).length) clean.tokens=tokens;
 }
 result.opencode=clean;return result;
}
