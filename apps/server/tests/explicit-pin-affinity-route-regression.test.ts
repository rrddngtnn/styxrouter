import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderConnection } from "../src/lib/db/providers";
import { replaceSyncedAvailableModelsForConnection } from "../src/lib/db/models";
import { upsertSessionAccountAffinity } from "../src/lib/db/sessionAccountAffinity";
import { extractSessionAffinityKey } from "../src/sse/services/auth";
import { initTranslators } from "../open-sse/translator/index";
import { handleChat } from "../src/sse/handlers/chat";

process.env.API_KEY_SECRET = "synthetic-api-key-secret-for-pin-regression";
const sse = 'data: {"type":"response.completed","response":{"id":"resp_test","object":"response","status":"completed","model":"fixture","output":[{"type":"message","id":"msg_test","role":"assistant","status":"completed","content":[{"type":"output_text","text":"ok","annotations":[]}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\ndata: [DONE]\n\n';
test("explicit account wins over old session affinity and 429 falls back", async () => {
  await initTranslators();
  const a = await createProviderConnection({ provider:"codex", authType:"oauth", accessToken:"synthetic-pin-a", isActive:true, priority:1 } as any);
  const b = await createProviderConnection({ provider:"codex", authType:"oauth", accessToken:"synthetic-pin-b", isActive:true, priority:2 } as any);
  for (const c of [a,b]) await replaceSyncedAvailableModelsForConnection("codex", c.id, [{id:"gpt-5.5",name:"fixture"}]);
  const key = await createApiKey("pin-regression", "test");
  const session = extractSessionAffinityKey({}, new Headers({"x-session-id":"explicit-pin-session"}))!;
  const scoped = `affinity-v1:${createHash("sha256").update(JSON.stringify([key.id,session])).digest("hex")}`;
  upsertSessionAccountAffinity(scoped,"codex",a.id,Date.now(),1_800_000);
  const seen:string[]=[]; const previous=globalThis.fetch;
  try {
    globalThis.fetch=(async (url, options) => {
      if (!String(url).startsWith("https://chatgpt.com/backend-api/codex/")) throw new Error("external network blocked");
      const auth=new Headers(options?.headers).get("authorization") ?? ""; seen.push(auth);
      return auth === "Bearer synthetic-pin-b" ? new Response('{"error":{"message":"rate limited"}}',{status:429,headers:{"content-type":"application/json","retry-after":"1"}}) : new Response(sse,{headers:{"content-type":"text/event-stream"}});
    }) as typeof fetch;
    const req=new Request("http://localhost/v1/responses",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`,"x-session-id":"explicit-pin-session","x-styx-connection":b.id},body:JSON.stringify({model:"codex/gpt-5.5",input:"hi",stream:true})});
    const result=await handleChat(req); await result.text();
    expect(seen[0]).toBe("Bearer synthetic-pin-b");
    expect(result.status).toBe(200);
    expect(seen.at(-1)).toBe("Bearer synthetic-pin-a");
  } finally {globalThis.fetch=previous;}
},60000);
