import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPinnedFetch } from "../src/shared/network/remoteImageFetch";

test("invalid HTTP status rejects and closes the response stream", async () => {
  let closed!: () => void;
  const streamClosed = new Promise<void>((resolve) => { closed = resolve; });
  const server = createServer((_req, res) => {
    res.on("close", closed);
    res.writeHead(600, { "content-encoding": "gzip" });
    res.write("unfinished body");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const timeout = (message: string) => new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), 1500);
    timer.unref();
  });
  try {
    await assert.rejects(Promise.race([
      createPinnedFetch("127.0.0.1", 4)(`http://example.invalid:${port}/`),
      timeout("fetch hung"),
    ]), RangeError);
    await Promise.race([streamClosed, timeout("response stream was not closed")]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
