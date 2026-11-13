import dns from 'node:dns';
import {createPinnedFetch, resolveAllowedAddresses} from '../../src/shared/network/remoteImageFetch';
import {resolveProxyForRequest} from '../utils/proxyFetch';

/** Augment credentials require public, pinned direct egress. Proxy/relay transports
 * cannot currently prove destination DNS/redirect policy, so reject, never bypass. */
export async function augmentPinnedPost(url: string, init: RequestInit): Promise<Response> {
 const target=new URL(url);
 const requireDirect=()=>{
  if(resolveProxyForRequest(url).source!=='direct')throw new Error('unsupported_augment_proxy');
 };
 requireDirect();
 const signal=init.signal ?? AbortSignal.timeout(60000);
 let addresses: Array<{address:string;family:number}>;
 try {
  addresses=await resolveAllowedAddresses(target,'public-only',host=>dns.promises.lookup(host,{all:true}),signal);
 }catch{throw new Error('upstream_destination_blocked');}
 // A fresh connection with an immutable lookup callback: no pool, second DNS
 // lookup, redirect following, or TLS verification override. Keep original SNI/Host.
 requireDirect();
 signal.throwIfAborted();
 return createPinnedFetch(addresses[0].address,addresses[0].family)(url,{...init,redirect:'manual',signal});
}
