import { expect, test } from "bun:test";
import { CodeBuddyCnExecutor } from "../open-sse/executors/codebuddy-cn";

test("alternate CN identity wins case-insensitively over all registry variants on the wire", async () => {
  const executor: any = new CodeBuddyCnExecutor();
  executor.config = { ...executor.config, headers: { ...executor.config.headers, "uSeR-aGeNt": "registry-mixed", "x-iDe-tYpE": "registry-mixed" } };
  executor.resolveAlternate = () => ({ headers: { "User-Agent": "alternate", "X-IDE-Type": "alternate" } });
  const previous = globalThis.fetch;
  let captured: Headers | undefined;
  try {
    globalThis.fetch = (async (_url, init) => { captured = new Headers(init?.headers); return new Response('data: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }); }) as typeof fetch;
    await executor.execute({model:"fixture",body:{messages:[]},stream:true,credentials:{accessToken:"synthetic"}});
    expect(captured!.get("user-agent")).toBe("alternate");
    expect(captured!.get("x-ide-type")).toBe("alternate");
  } finally { globalThis.fetch = previous; }
});
