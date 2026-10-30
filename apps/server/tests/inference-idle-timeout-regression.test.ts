import { expect, test } from "bun:test";
import { extendQuotaSyncTimeout } from "../server/quotaSyncTimeout.ts";

test("inference survives an idle interval beyond Bun's default socket timeout", async () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request, server) {
      extendQuotaSyncTimeout(request, server);
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(": initial\n\n"));
          timer = setTimeout(() => {
            controller.enqueue(new TextEncoder().encode("data: completed\n\n"));
            controller.close();
          }, 13_000);
        },
        cancel() { clearTimeout(timer); },
      }), { headers: { "content-type": "text/event-stream" } });
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, { method: "POST" });
    expect(await response.text()).toContain("data: completed");
  } finally {
    clearTimeout(timer);
    await server.stop(true);
  }
}, 25_000);
