import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ZcodeExecutor, buildZcodePrompt } from "../open-sse/executors/zcode.ts";
import { applyNativeZcodeInstructions, renderNativeZcodePrompt, loadNativeZcodeInstructions } from "../open-sse/services/nativeZcodeInstructions.ts";

// Exact reapplication uses a structural slot, never drops matching user literals.
test("pure transform clones typed history and is idempotent even with identical caller prefix", () => {
  const input = { conversation: "[Instructions]\nSYNTHETIC\n\n[User]\nSYNTHETIC", messages: [{ content: [{ type: "text", text: "history", cache_control: { type: "ephemeral" } }, { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] }], tools: [{ function: { name: "fixture" } }] };
  const before = structuredClone(input);
  const once = applyNativeZcodeInstructions(input, "SYNTHETIC");
  expect(applyNativeZcodeInstructions(once, "SYNTHETIC")).toEqual(once);
  expect(renderNativeZcodePrompt(once)).toBe("[Instructions]\nSYNTHETIC\n\n" + input.conversation);
  once.messages[0].content[0].cache_control!.type = "changed";
  expect(input).toEqual(before);
  expect(renderNativeZcodePrompt(applyNativeZcodeInstructions(input, ""))).toBe(input.conversation);
});

const dir = mkdtempSync(join(process.env.TMPDIR!, "native-zcode-test-"));
const old = process.env.RATMAN_SOUL_PATH;
afterEach(() => { if (old === undefined) delete process.env.RATMAN_SOUL_PATH; else process.env.RATMAN_SOUL_PATH = old; });
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

for (const [name, value] of Object.entries({ disabled: "", relative: "relative.txt", remote: "https://example.invalid/file", missing: "/not-present-native-fixture", wrongType: 42, nullType: null })) {
  test(`loader falls back safely: ${name}`, () => {
    const result = loadNativeZcodeInstructions(value);
    expect(result.text).toBe("");
    expect(result.status).toBe(name === "disabled" ? "disabled" : "unavailable");
    if (value !== "") expect(JSON.stringify(result)).not.toContain(String(value));
  });
}
for (const [name, bytes] of Object.entries({ empty: Buffer.from(" \n"), invalidUtf8: Buffer.from([0xff]), nul: Buffer.from("a\0b"), oversized: Buffer.alloc(256 * 1024 + 1, 65) })) {
  test(`loader rejects ${name}`, () => {
    const file = join(dir, name); writeFileSync(file, bytes);
    expect(loadNativeZcodeInstructions(file)).toEqual({ text: "", status: "unavailable" });
  });
}
test("loader rejects directory", () => expect(loadNativeZcodeInstructions(dir)).toEqual({ text: "", status: "unavailable" }));
test("loader reloads changed file without retaining stale persona", () => {
  const file = join(dir, "reload"); writeFileSync(file, "SYNTHETIC α");
  expect(loadNativeZcodeInstructions(file).text).toBe("SYNTHETIC α");
  writeFileSync(file, "SYNTHETIC β");
  expect(loadNativeZcodeInstructions(file).text).toBe("SYNTHETIC β");
  rmSync(file); expect(loadNativeZcodeInstructions(file).status).toBe("unavailable");
});

for (const mode of ["enabled", "disabled", "missing"] as const) {
  test(`real native executor binary stdio: ${mode}, two turns, typed multimodal/history/tools`, async () => {
    const file = join(dir, "child-instructions"); writeFileSync(file, "SYNTHETIC native instructions");
    if (mode === "disabled") delete process.env.RATMAN_SOUL_PATH;
    else process.env.RATMAN_SOUL_PATH = mode === "missing" ? file + ".missing" : file;
    const executor = new ZcodeExecutor({ command: process.execPath, args: [join(import.meta.dir, "fixtures/native-zcode-app-server.ts")], startupTimeoutMs: 2000, requestTimeoutMs: 2000 });
    const body = { system: "unchanged unused system", messages: [
      { role: "system", content: [{ type: "text", text: "caller system", cache_control: { type: "ephemeral" } }] },
      { role: "assistant", content: "prior reply" },
      { role: "tool", content: "tool result" },
      { role: "user", content: [{ type: "text", text: "normal query" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] },
    ], tools: [{ type: "function", function: { name: "fixture" } }] };
    const before = structuredClone(body);
    for (let turn = 0; turn < 2; turn++) {
      const result: any = await executor.execute({ model: "glm-5.2", body, stream: false, credentials: {} });
      expect(result.response.status).toBe(200);
      const response = await result.response.json();
      const expected = (mode === "enabled" ? "[Instructions]\nSYNTHETIC native instructions\n\n" : "") + buildZcodePrompt(body.messages);
      expect(response.choices[0].message.content).toBe(expected);
      expect(result.transformedBody.instructionsStatus).toBe(mode === "enabled" ? "loaded" : mode === "missing" ? "unavailable" : "disabled");
      expect(JSON.stringify(result.transformedBody)).not.toContain("SYNTHETIC");
      expect(body).toEqual(before);
    }
  });
}

test("native factory aliases select ZCode, never a custom model-prefix executor", async () => {
  const { getExecutor } = await import("../open-sse/executors/index.ts");
  expect(getExecutor("zcode")).toBeInstanceOf(ZcodeExecutor);
  expect(getExecutor("zc")).toBeInstanceOf(ZcodeExecutor);
  expect(getExecutor("openai")).not.toBeInstanceOf(ZcodeExecutor);
});

test("caller-supplied path cannot activate file loading; streaming keeps the native content contract", async () => {
  delete process.env.RATMAN_SOUL_PATH;
  const file = join(dir, "caller-selected.txt");
  writeFileSync(file, "SYNTHETIC must not load");
  const executor = new ZcodeExecutor({ command: process.execPath, args: [join(import.meta.dir, "fixtures/native-zcode-app-server.ts")], startupTimeoutMs: 2000, requestTimeoutMs: 2000 });
  const body = { RATMAN_SOUL_PATH: file, instructionsPath: file, messages: [{ role: "user", content: "ordinary caller" }] };
  const result = await executor.execute({ model: "glm-5.2", body, stream: true, credentials: { providerSpecificData: { RATMAN_SOUL_PATH: file } } });
  if (result instanceof Response) throw new Error("expected native result");
  expect(result.transformedBody.instructionsStatus).toBe("disabled");
  const sse = await result.response.text();
  expect(sse).toContain("ordinary caller");
  expect(sse).not.toContain("SYNTHETIC must not load");
  expect(sse).toContain("[DONE]");
});

test("native executor applies opt-in file to actual sendPrompt without changing caller messages", async () => {
  const file = join(dir, "instructions.txt");
  writeFileSync(file, "SYNTHETIC native persona");
  process.env.RATMAN_SOUL_PATH = file;
  let received = "";
  const executor = new ZcodeExecutor({ clientFactory: () => ({
    start: async () => {}, close: async () => {},
    call: async (_channel, method, args) => {
      if (method === "initialize") return { available: true };
      if (method === "createSession") return { sessionId: "fixture" };
      if (method === "sendPrompt") { received = (args[0] as any).content; return { text: "fixture response", status: "completed" }; }
      return {};
    },
  }) });
  const body = { messages: [{ role: "user", content: [{ type: "text", text: "hello", cache_control: { type: "ephemeral" } }] }] };
  const before = structuredClone(body);
  const result = await executor.execute({ model: "glm-5.2", body, stream: false, credentials: {} });
  expect((result as any).response.status).toBe(200);
  expect(received).toContain("SYNTHETIC native persona");
  expect(received).toContain("[User]\nhello");
  expect(body).toEqual(before);
});
