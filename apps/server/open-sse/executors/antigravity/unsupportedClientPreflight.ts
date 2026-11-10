// Only this exact, observed upstream response is classified. All undecidable streams
// are replayed byte-for-byte; neither a quoted substring nor a late message is intercepted.
const CLIENT_UNSUPPORTED = "This version of Antigravity is no longer supported. Please download and install the latest version at https://antigravity.google/download to continue using the agent and unlock our latest models, including Gemini 4 Argon on eligible plans.";
const MAX_BYTES = 16 * 1024;
const MAX_WAIT_MS = 250;

export async function preflightUnsupportedClient(response: Response): Promise<Response> {
  if (!response.ok || !response.body ||
      !response.headers.get("content-type")?.includes("text/event-stream")) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let raw = "", text = "", size = 0, done = false;
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), MAX_WAIT_MS); });
  try {
    while (size < MAX_BYTES) {
      pending = reader.read();
      const next = await Promise.race([pending, deadline]);
      if (!next) break;
      pending = undefined;
      if (next.done) { done = true; break; }
      chunks.push(next.value);
      size += next.value.byteLength;
      if (size > MAX_BYTES) break;
      raw += decoder.decode(next.value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(raw)) !== null) {
        const frame = raw.slice(0, boundary.index); raw = raw.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!data || data === "[DONE]") continue;
        let obj: any;
        try { obj = JSON.parse(data); } catch { text = "\0"; break; }
        const candidates = obj?.response?.candidates;
        if (obj?.error || obj?.response?.error || (Array.isArray(candidates) && candidates.length > 1)) { text = "\0"; break; }
        const parts = candidates?.[0]?.content?.parts;
        if (parts !== undefined && !Array.isArray(parts)) { text = "\0"; break; }
        for (const part of parts ?? []) {
          if (!part || typeof part !== "object") { text = "\0"; break; }
          if (Array.isArray(part) || Object.keys(part).some(key => key !== "text") || typeof part.text !== "string") { text = "\0"; break; }
          if (part.text) text += part.text;
        }
      }
      if (!CLIENT_UNSUPPORTED.startsWith(text)) break;
    }
  } catch (error) {
    try { reader.releaseLock(); } catch {}
    throw error;
  } finally { if (timer) clearTimeout(timer); }
  if (done && !raw.trim() && text === CLIENT_UNSUPPORTED) {
    reader.releaseLock();
    return Response.json({ error: { message: "Upstream Antigravity client version is unsupported. Update the matching official client contract; account verification remains separate.", type: "upstream_error", code: "upstream_client_unsupported" } }, { status: 502 });
  }
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < chunks.length) { controller.enqueue(chunks[index++]); return; }
      if (done) { reader.releaseLock(); controller.close(); return; }
      try {
        const next = await (pending ?? reader.read()); pending = undefined;
        if (next.done) { done = true; reader.releaseLock(); controller.close(); }
        else controller.enqueue(next.value);
      } catch (error) { try { reader.releaseLock(); } catch {} controller.error(error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { try { reader.releaseLock(); } catch {} } },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
