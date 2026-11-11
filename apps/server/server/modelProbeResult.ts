import { redactSecrets } from '../src/shared/utils/logRedaction';

export function isCompletedProbeChoice(choice: any): boolean {
 return ['stop', 'length'].includes(choice?.finish_reason) && choice?.message?.role === 'assistant' && typeof choice.message.content === 'string' && !!choice.message.content.trim();
}

export function sanitizeProbeOutput(text: string, secrets: unknown[]): string {
 for (const secret of secrets) if (typeof secret === 'string' && secret.length) text = text.split(secret).join('[REDACTED]');
 return redactSecrets(text).slice(0,2048);
}

export function sanitizeProbeError(text: string, secrets: unknown[]): string {
 // Redact exact values and URL credentials before applying the output bound.
 for (const secret of secrets) if (typeof secret === 'string' && secret.length) text = text.split(secret).join('[REDACTED]');
 return redactSecrets(text).replace(/https?:\/\/[^\s<>"']+/gi, '[URL REDACTED]').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 512);
}

export async function readBoundedProbeJson(response: Response, signal?: AbortSignal): Promise<any> {
 const reader=response.body?.getReader();
 if (!reader) return null;
 const abort = () => { void reader.cancel().catch(() => {}); };
 signal?.addEventListener('abort', abort, { once: true });
 if (signal?.aborted) abort();
 const chunks:Uint8Array[]=[];
 let size=0;
 try {
  while (true) {
   const {done,value}=await reader.read();
   if(signal?.aborted) throw new Error('Probe aborted');
   if(done) break;
   size+=value.byteLength;
   if(size>65536) { await reader.cancel(); throw new Error('Probe response too large'); }
   chunks.push(value);
  }
 } finally {signal?.removeEventListener('abort', abort);reader.releaseLock();}
 const data=new Uint8Array(size);let offset=0;
 for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
 return JSON.parse(new TextDecoder().decode(data));
}
