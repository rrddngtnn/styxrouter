import { expect, test } from "bun:test";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderNode, createProviderConnection } from "../src/lib/db/providers";
import { createCombo } from "../src/lib/db/combos";
import { upsertHandoff, recordSessionModelUsage } from "../src/lib/db/contextHandoffs";
import { clearSessions, getActiveSessions } from "../open-sse/services/sessionManager";
import { initTranslators } from "../open-sse/translator/index";
import { handleChat } from "../src/sse/handlers/chat";

test("HTTP sessions isolate legacy handoffs, model history and metadata across API keys", async () => {
  clearSessions(); await initTranslators();
  const node: any = await createProviderNode({type:"openai-compatible", name:"sharedaudit", prefix:"sharedaudit", apiType:"chat", baseUrl:"https://sharedaudit.example/v1"});
  await createProviderConnection({provider:node.id,authType:"apikey",apiKey:"synthetic-upstream"} as any);
  await createCombo({name:"sharedaudit-combo", strategy:"context-relay", models:["sharedaudit/fixture"]} as any);
  const a = await createApiKey("sharedaudit-a", "test"); const b = await createApiKey("sharedaudit-b", "test");
  const now = new Date().toISOString();
  upsertHandoff({sessionId:"ext:shared-audit",comboName:"sharedaudit-combo",fromAccount:"other-account",summary:"LEGACY-PRIVATE-CONTENT",keyDecisions:[],taskProgress:"",activeEntities:[],messageCount:1,model:"old",warningThresholdPct:0.85,generatedAt:now,expiresAt:"2999-01-01T00:00:00.000Z"});
  recordSessionModelUsage("ext:shared-audit", "sharedaudit-combo", "old", "old-provider");
  const requests: string[] = []; const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url).startsWith("http://127.0.0.1:")) return original(url, options);
    requests.push(String(options.body));
    return Response.json({id:"fixture",object:"chat.completion",model:"fixture",choices:[{index:0,message:{role:"assistant",content:"ok"},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
  }) as typeof fetch;
  const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:handleChat});
  try {
    for (const key of [a.key,b.key,null,a.key]) {
      const response = await original(`http://127.0.0.1:${server.port}/v1/chat/completions`, {method:"POST",headers:{"content-type":"application/json",...(key ? {authorization:`Bearer ${key}`} : {}),"x-session-id":"shared-audit"},body:JSON.stringify({model:"sharedaudit-combo",stream:false,messages:[{role:"user",content:"hello"}]})});
      expect(response.status).toBe(200); await response.text();
      if (key === a.key && getActiveSessions().length === 1) {
        upsertHandoff({sessionId:getActiveSessions()[0].sessionId,comboName:"sharedaudit-combo",fromAccount:"other-account",summary:"KEY-A-PRIVATE-CONTENT",keyDecisions:[],taskProgress:"",activeEntities:[],messageCount:1,model:"fixture",warningThresholdPct:0.85,generatedAt:now,expiresAt:"2999-01-01T00:00:00.000Z"});
      }
      if (key === b.key || key === null) expect(requests.join(" ")).not.toContain("KEY-A-PRIVATE-CONTENT");
    }
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(requests.join(" ")).not.toContain("LEGACY-PRIVATE-CONTENT");
    expect(requests.join(" ")).toContain("KEY-A-PRIVATE-CONTENT");
    expect(getActiveSessions()).toHaveLength(3);
    expect(JSON.stringify(getActiveSessions())).not.toContain(a.key);
    expect(JSON.stringify(getActiveSessions())).not.toContain(b.key);
  } finally {server.stop(true); globalThis.fetch = original; clearSessions();}
}, 60000);
