import { expect, test } from "bun:test";
import { createProviderConnection } from "../src/lib/db/providers";
import { recordSessionModelUsage } from "../src/lib/db/contextHandoffs";
import { handleComboChat } from "../open-sse/services/combo";

const log = { info() {}, warn() {}, debug() {}, error() {} };
const body = (tags?: string[]) => ({ model: "fixture", messages: [{ role: "user", content: "hi" }], stream: false, ...(tags ? { metadata: { tags } } : {}) });
const response = () => Response.json({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] });

for (const mode of ["chaos", "pin", "nested"] as const) {
  test(`${mode}: real combo dispatch never sends an unmatched tag`, async () => {
    const conn = await createProviderConnection({ provider: "openai", authType: "apikey", name: `red-${mode}`, apiKey: "fixture", providerSpecificData: { tags: ["red"] } } as any);
    const model = "openai/gpt-4o-mini";
    const child = { name: `child-${mode}`, strategy: "priority", models: [model], config: { maxRetries: 0 } };
    const combo: any = { name: `parent-${mode}`, strategy: "priority", models: mode === "nested" ? [model, { kind: "combo-ref", comboName: child.name }] : [model], config: { maxRetries: 0, ...(mode === "chaos" ? { chaos: { enabled: true } } : {}), ...(mode === "nested" ? { nestedComboMode: "execute" } : {}) }, ...(mode === "pin" ? { context_cache_protection: true } : {}) };
    if (mode === "pin") recordSessionModelUsage(`session-${mode}`, combo.name, model, "openai", conn.id);
    const sent: any[] = [];
    const run = (tags?: string[]) => handleComboChat({ body: body(tags), combo, allCombos: [combo, child], relayOptions: { sessionId: `session-${mode}` }, log, handleSingleModel: async (_body: any, m: string, target: any) => { sent.push({ m, target }); return response(); } } as any);
    const denied = await run(["blue"]); await denied.text();
    expect(sent).toEqual([]);
    expect(denied.status).not.toBe(200);
    const allowed = await run(["red"]); await allowed.text();
    expect(allowed.status).toBe(200);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0].target?.connectionId === conn.id || sent[0].target?.allowedConnectionIds?.includes(conn.id)).toBe(true);
    sent.length = 0;
    const untagged = await run(); await untagged.text();
    expect(untagged.status).toBe(200);
    expect(sent.length).toBeGreaterThan(0);
  }, 30000);
}
