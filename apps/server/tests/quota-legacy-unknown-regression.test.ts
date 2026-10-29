import { expect, test } from "bun:test";
import { createApiKey, getApiKeyById } from "../src/lib/db/apiKeys";
import { createProviderConnection } from "../src/lib/db/providers";
import { createPool, updatePool, upsertAllocations } from "../src/lib/db/quotaPools";
import { getDbInstance } from "../src/lib/db/core";

test("unknown legacy exclusivity refuses allocation edits until explicitly resolved", async () => {
 const key = await createApiKey("legacy", "test");
 const conn = await createProviderConnection({ provider:"openai", authType:"apikey", apiKey:"test", name:"legacy" } as any);
 const pool = createPool({connectionId:conn.id,name:"legacy",allocations:[{apiKeyId:key.id,weight:100,policy:"hard"}]});
 const db = getDbInstance();
 db.prepare("UPDATE quota_pools SET exclusive = NULL WHERE id = ?").run(pool.id);
 expect(() => updatePool(pool.id, {allocations:[]})).toThrow(/exclusiv/i);
 expect(() => upsertAllocations(pool.id, [])).toThrow(/exclusiv/i);
 expect((await getApiKeyById(key.id))!.allowedQuotas).toEqual([]);
 expect(updatePool(pool.id, { exclusive:true, allocations:[] })?.exclusive).toBe(true);
});
