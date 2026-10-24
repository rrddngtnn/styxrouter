import {afterEach, expect, test} from "bun:test";
import {clearCompletedDetails,getCompletedDetails,storeCompletedDetail} from "../src/lib/usage/completedRequestDetails";
afterEach(clearCompletedDetails);
test("completed details do not retain original response and chunk payload references",()=>{
 const detail:any={id:"large",providerResponse:{text:"x".repeat(2000000)},streamChunks:{provider:["x".repeat(2000000)]}};
 storeCompletedDetail(detail);
 const saved=getCompletedDetails().get("large");
 expect(saved).not.toBe(detail);
 expect(JSON.stringify(saved).length).toBeLessThan(200000);
 expect(detail.providerResponse.text.length).toBe(2000000);
});
test("completed detail aggregate budget evicts oldest previews",()=>{
 for(let i=0;i<256;i++) storeCompletedDetail({id:`d-${i}`,clientRequest:{items:Array.from({length:12},()=>"x".repeat(1200))},providerRequest:{items:Array.from({length:12},()=>"y".repeat(1200))},clientResponse:{items:Array.from({length:12},()=>"z".repeat(1200))}} as any);
 expect(getCompletedDetails().has("d-0")).toBe(false);
 expect(getCompletedDetails().has("d-255")).toBe(true);
});
