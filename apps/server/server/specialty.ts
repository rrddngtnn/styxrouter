// Reachable specialty implementations only; declarations without adapters stay out.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { EMBEDDING_PROVIDERS, parseEmbeddingModel, getEmbeddingProvider } from '../open-sse/config/embeddingRegistry.ts';
import { handleEmbedding } from '../open-sse/handlers/embeddings.ts';
import { SEARCH_PROVIDERS, resolveSearchProviderId, getSearchCredentialFallbacks } from '../open-sse/config/searchRegistry.ts';
import { handleSearch } from '../open-sse/handlers/search.ts';
import { v1EmbeddingsSchema, v1SearchSchema } from '../src/shared/validation/schemas/apiV1.ts';
import { enforceApiKeyPolicy, validateApiKeyRoutingTarget } from '../src/shared/utils/apiKeyPolicy.ts';
import { getProviderCredentials } from '../src/sse/services/auth.ts';

// Cohere /v2/embed is not OpenAI-compatible and has no native serializer here.
export const SPECIALTY_PROVIDERS: Record<string, { id: string; authType: string; displayName: string; category: string; vendor: string; models: Array<{id:string;name:string}>; authModes?: string[]; alias?: string }> = Object.fromEntries([
 ...Object.entries(EMBEDDING_PROVIDERS)
  .filter(([id,p]) => id !== 'cohere' && p.authType === 'apikey')
  .map(([id,p]) => [id,{...p,displayName:id,category:'embedding',vendor:id}]),
 ...Object.entries(SEARCH_PROVIDERS).filter(([,p])=>!p.disabled && p.authType==='apikey')
  .map(([id,p])=>[id,{...p,displayName:p.name,category:'search',vendor:id,models:[]}]),
]);

export function createSpecialtyApi() {
 const api = new Hono();
 api.use('/embeddings',bodyLimit({maxSize:1024*1024,onError:c=>c.json({error:'Request too large'},413)}));
 api.post('/embeddings',async c=>{
  const raw = await c.req.json().catch(()=>null);
  const parsed = v1EmbeddingsSchema.safeParse(raw);
  if(!parsed.success || raw.stream === true) return c.json({error:'Invalid embedding request; streaming is not supported'},400);
  const {provider,model}=parseEmbeddingModel(parsed.data.model);
  const config=provider && Object.hasOwn(EMBEDDING_PROVIDERS,provider) ? getEmbeddingProvider(provider) : null;
  if(!config || !model || provider==='cohere') return c.json({error:'Unsupported embedding provider'},400);
  const canonical=`${provider}/${model}`;
  const policy=await enforceApiKeyPolicy(c.req.raw,parsed.data.model);
  if(policy.rejection) return policy.rejection;
  const rejection=await validateApiKeyRoutingTarget(c.req.raw,policy.apiKey,policy.apiKeyInfo,canonical);
  if(rejection) return rejection;
  const pin=c.req.header('x-styx-connection') || null;
  const allowed=policy.apiKeyInfo?.allowedConnections ?? null;
  if(pin && allowed?.length && !allowed.includes(pin)) return c.json({error:'Connection is not allowed'},403);
  const credentials=await getProviderCredentials(provider!,null,allowed,model,{...(pin?{forcedConnectionId:pin}:{})});
  if(!credentials || 'allRateLimited' in credentials || !('connectionId' in credentials) || !('providerSpecificData' in credentials)) return c.json({error:'No eligible embedding connection'},503);
  if(pin && credentials.connectionId!==pin) return c.json({error:'Requested connection is unavailable'},503);
  const selected=credentials as Record<string,unknown>;
  const embeddingCredentials={
   apiKey:typeof selected.apiKey==='string'?selected.apiKey:null,
   accessToken:typeof selected.accessToken==='string'?selected.accessToken:null,
   providerSpecificData:selected.providerSpecificData && typeof selected.providerSpecificData==='object' ? selected.providerSpecificData as Record<string,unknown> : null,
  };
  const result=await handleEmbedding({body:{...parsed.data,model:canonical},credentials:embeddingCredentials,resolvedProvider:config,resolvedModel:model,apiKeyId:policy.apiKeyInfo?.id,apiKeyName:policy.apiKeyInfo?.name,connectionId:credentials.connectionId});
  return result.success ? c.json(result.data!) : c.json({error:{message:result.error}},(result.status || 502) as any);
 });
 api.use('/search',bodyLimit({maxSize:64*1024,onError:c=>c.json({error:'Request too large'},413)}));
 api.post('/search',async c=>{
  const raw=await c.req.json().catch(()=>null);
  const parsed=v1SearchSchema.safeParse(raw);
  if(!parsed.success || typeof raw.provider!=='string' || raw.stream===true) return c.json({error:'An explicit search provider is required; streaming is unsupported'},400);
  const provider=resolveSearchProviderId(raw.provider);
  const config=Object.hasOwn(SEARCH_PROVIDERS,provider) ? SEARCH_PROVIDERS[provider] : null;
  if(!config || config.disabled || !config.searchTypes.includes(parsed.data.search_type)) return c.json({error:'Unsupported search provider or search type'},400);
  const policy=await enforceApiKeyPolicy(c.req.raw,raw.provider);
  if(policy.rejection) return policy.rejection;
  const denial=await validateApiKeyRoutingTarget(c.req.raw,policy.apiKey,policy.apiKeyInfo,provider);
  if(denial) return denial;
  const pin=c.req.header('x-styx-connection') || null;
  const allowed=policy.apiKeyInfo?.allowedConnections ?? null;
  if(pin && allowed?.length && !allowed.includes(pin)) return c.json({error:'Connection is not allowed'},403);
  let credentials:any=null;
  for(const id of [provider,...getSearchCredentialFallbacks(provider)]) {
   credentials=await getProviderCredentials(id,null,allowed,null,{...(pin?{forcedConnectionId:pin}:{})});
   if(credentials && !('allRateLimited' in credentials) && (!pin || credentials.connectionId===pin)) break;
   credentials=null;
  }
  if(!credentials) return c.json({error:'No eligible search connection'},503);
  // Never accept caller transport overrides: only stored operator connection metadata.
  if(parsed.data.provider_options && Object.hasOwn(parsed.data.provider_options,'baseUrl')) return c.json({error:'Client baseUrl overrides are not supported'},400);
  const result=await handleSearch({query:parsed.data.query,provider,maxResults:Math.min(parsed.data.max_results,config.maxMaxResults),searchType:parsed.data.search_type,credentials,connectionId:credentials.connectionId,apiKeyId:policy.apiKeyInfo?.id,providerOptions:parsed.data.provider_options,country:parsed.data.country,language:parsed.data.language,timeRange:parsed.data.time_range,offset:parsed.data.offset,domainFilter:[...(parsed.data.filters?.include_domains ?? []),...(parsed.data.filters?.exclude_domains ?? []).map(d=>'-'+d)],contentOptions:parsed.data.content,strictFilters:parsed.data.strict_filters});
  return result.success ? c.json(result.data!) : c.json({error:{message:result.error}},(result.status || 502) as any);
 });
 return api;
}
