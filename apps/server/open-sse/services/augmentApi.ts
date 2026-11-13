import {augmentPinnedPost} from './augmentApiTransport';
/** Native protocol researched against @augmentcode/auggie-sdk 0.2.0; no SDK runtime dependency. */
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_upstream_contract');
  return value as Record<string, unknown>;
}
export class AugmentError extends Error {
  constructor(public code: string, public status = 502) { super(code); }
}
export function augmentTenantUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512 || !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.api\.augmentcode\.com(?::443)?\/?$/i.test(value)) throw new AugmentError('invalid_tenant_url',400);
  let url: URL;
  try { url = new URL(value); } catch { throw new AugmentError('invalid_tenant_url',400); }
  if (url.protocol !== 'https:' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.api\.augmentcode\.com$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new AugmentError('invalid_tenant_url',400);
  return url.origin;
}
export const AUGMENT_UNSUPPORTED = ['max_tokens','max_completion_tokens','max_output_tokens','maxOutputTokens','temperature','top_p','top_k','stop','seed','frequency_penalty','presence_penalty','logprobs','top_logprobs','n','tool_choice','parallel_tool_calls','response_format','reasoning_effort','thinking','generationConfig','min_tokens','min_p','logit_bias'] as const;
export function assertAugmentParameters(body: Record<string, unknown>): void {
  for (const key of AUGMENT_UNSUPPORTED) if (Object.hasOwn(body,key)) throw new AugmentError(`unsupported_parameter:${key}`,400);
}
export function parseAugmentCatalog(value: unknown): {id:string;name:string}[] {
  const flags = record(record(value).feature_flags);
  if (typeof flags.model_info_registry !== 'string' || flags.model_info_registry.length > 2_000_000) throw new AugmentError('invalid_model_catalog');
  const registry = record(JSON.parse(flags.model_info_registry));
  return Object.entries(registry).flatMap(([id, raw]) => {
    const entry = record(raw);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id)) throw new AugmentError('invalid_model_catalog');
    return entry.disabled ? [] : [{id,name:typeof entry.displayName === 'string' ? entry.displayName.slice(0,200) : id}];
  });
}
export async function augmentPost(apiUrl: unknown, apiKey: unknown, path: '/get-models'|'/chat-stream', body: unknown, signal?: AbortSignal | null): Promise<Response> {
  const base = augmentTenantUrl(apiUrl);
  if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 16384 || /[\s\x00-\x1f\x7f]/.test(apiKey)) throw new AugmentError('invalid_api_key',400);
  let response: Response;
  try { response = await augmentPinnedPost(`${base}${path}`, {method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','User-Agent':'StyxRouter native Augment adapter (contract 0.2.0)','X-Mode':'sdk',...(path === '/chat-stream' ? {'X-Request-Session-Id':String(record(body).conversation_id),'conversation-id':String(record(body).conversation_id),'X-Request-Id':crypto.randomUUID()} : {})},body:JSON.stringify(body),redirect:'error',signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000)}); }
  catch(error) { if(signal?.aborted) throw new AugmentError('request_cancelled',499); const code=error instanceof Error && ['unsupported_augment_proxy','upstream_destination_blocked'].includes(error.message) ? error.message : 'upstream_transport_error'; throw new AugmentError(code); }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new AugmentError('upstream_redirect_blocked');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AugmentError(response.status === 401 ? 'upstream_authentication' : response.status === 403 ? 'upstream_entitlement' : response.status === 429 ? 'upstream_quota' : response.status === 404 ? 'upstream_model_not_found' : 'upstream_transient', response.status >= 400 && response.status < 500 ? response.status : 502);
  }
  return response;
}
export async function* augmentFrames(body: ReadableStream<Uint8Array>, signal?: AbortSignal | null): AsyncGenerator<Record<string,unknown>> {
  const reader=body.getReader(); const decoder=new TextDecoder('utf-8',{fatal:true});
  let buffer='', total=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  const parse=(line:string)=>{try{return record(JSON.parse(line));}catch{throw new AugmentError('invalid_ndjson_frame');}};
  try {
    while(true){
      if(signal?.aborted)throw new AugmentError('request_cancelled',499);
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.length;if(total>16_000_000)throw new AugmentError('stream_size_limit');
      buffer+=decoder.decode(value,{stream:true});
      let at:number;
      while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);if(line.length>1_000_000)throw new AugmentError('frame_size_limit');if(line)yield parse(line);}
      if(buffer.length>1_000_000)throw new AugmentError('frame_size_limit');
    }
    if(signal?.aborted)throw new AugmentError('request_cancelled',499);
    buffer+=decoder.decode();if(buffer.trim())yield parse(buffer.trim());
  } finally {signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function discoverAugment(apiUrl: unknown, apiKey: unknown, signal?: AbortSignal | null) {
  const response = await augmentPost(apiUrl,apiKey,'/get-models',{},signal);
  const chunks: Uint8Array[]=[]; let total=0;
  if(!response.body) throw new AugmentError('invalid_model_catalog');
  const reader=response.body.getReader();
  try { while(true) {const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>2_000_000)throw new AugmentError('catalog_too_large');chunks.push(value);} }
  finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return parseAugmentCatalog(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
}
