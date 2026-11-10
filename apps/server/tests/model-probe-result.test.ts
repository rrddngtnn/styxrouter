import { test, expect } from 'bun:test';
import { readBoundedProbeJson, sanitizeProbeOutput, isCompletedProbeChoice } from '../server/modelProbeResult';
test('probe accepts only successful text terminal reasons',()=>{
 for(const finish_reason of ['error','failed','content_filter',{},1,null]) expect(isCompletedProbeChoice({finish_reason,message:{role:'assistant',content:'partial'}})).toBe(false);
 for(const finish_reason of ['stop','length']) expect(isCompletedProbeChoice({finish_reason,message:{role:'assistant',content:'OK'}})).toBe(true);
});
test('probe output redacts exact secrets before truncation',()=>{
 const secret='private-fixture-secret';
 expect(sanitizeProbeOutput('x'.repeat(2040)+secret,[secret])).not.toContain('private-');
});
test('probe abort cancels an unfinished response body',async()=>{
 const controller=new AbortController(); let cancelled=false;
 const response=new Response(new ReadableStream({cancel(){cancelled=true;}}));
 const reading=readBoundedProbeJson(response,controller.signal);
 controller.abort();
 await expect(reading).rejects.toThrow('Probe aborted');
 expect(cancelled).toBe(true);
});
test('probe rejects oversized upstream bodies',async()=>{
 await expect(readBoundedProbeJson(new Response('x'.repeat(65537)))).rejects.toThrow('Probe response too large');
});
