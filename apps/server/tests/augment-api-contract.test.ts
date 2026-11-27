import { expect, test } from 'bun:test';
import { augmentTenantUrl, parseAugmentCatalog, assertAugmentParameters, augmentFrames } from '../open-sse/services/augmentApi.ts';
test('incremental UTF8 NDJSON preserves final frame and rejects truncated JSON', async () => {
  const bytes=new TextEncoder().encode('{"text":"海"}\n{"stop_reason":1}');
  const stream=new ReadableStream<Uint8Array>({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}});
  const frames=[];for await(const frame of augmentFrames(stream))frames.push(frame);
  expect(frames).toEqual([{text:'海'},{stop_reason:1}]);
  const bad=new Response('{"text":').body!;
  await expect(async()=>{for await(const frame of augmentFrames(bad))void frame;}).toThrow();
});
test('parser rejects oversized frames and cancellation cancels upstream',async()=>{
 await expect(async()=>{for await(const f of augmentFrames(new Response('x'.repeat(1_000_001)).body!))void f;}).toThrow('frame_size_limit');
 let cancelled=false;const abort=new AbortController();const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});const frames=augmentFrames(body,abort.signal);const next=frames.next();abort.abort();await expect(next).rejects.toThrow('request_cancelled');expect(cancelled).toBe(true);
});
test('tenant contract rejects untrusted origins and credentials', () => {
  expect(augmentTenantUrl('https://example.api.augmentcode.com/')).toBe('https://example.api.augmentcode.com');
  for (const url of ['http://a.api.augmentcode.com','https://127.0.0.1','https://a.api.augmentcode.com.evil.test','https://a.api.augmentcode.com:444','https://u:p@a.api.augmentcode.com','https://a.api.augmentcode.com/x','https://a.api.augmentcode.com/?x=1']) expect(() => augmentTenantUrl(url)).toThrow();
});
test('canonical catalog is object-only and excludes disabled entries', () => {
  expect(parseAugmentCatalog({feature_flags:{model_info_registry:JSON.stringify({'claude-haiku-4-5':{displayName:'Haiku'},disabled:{disabled:true}})}})).toEqual([{id:'claude-haiku-4-5',name:'Haiku'}]);
  expect(() => parseAugmentCatalog({feature_flags:{model_info_registry:'[]'}})).toThrow();
});
test('explicit unsupported budgets fail before dispatch rather than being discarded', () => {
  for (const field of ['max_tokens','max_completion_tokens','max_output_tokens','temperature','tool_choice','top_p','response_format']) expect(() => assertAugmentParameters({[field]:1})).toThrow('unsupported_parameter');
  expect(() => assertAugmentParameters({messages:[],stream:true})).not.toThrow();
});
