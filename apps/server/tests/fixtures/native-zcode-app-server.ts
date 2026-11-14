// Offline binary protocol fixture: echoes only the synthetic request it receives.
import { decodeZcodeValue, encodeZcodeValue } from "../../open-sse/executors/zcodeProtocol.ts";
function send(header: unknown[], payload: unknown) {
  const body = Buffer.concat([encodeZcodeValue(header), encodeZcodeValue(payload)]);
  const frame = Buffer.alloc(13); frame[0] = 1; frame.writeUInt32BE(body.length, 9);
  process.stdout.write(Buffer.concat([frame, body]));
}
process.stdout.write(JSON.stringify({ type: "zcode-hello" }) + "\n");
let buffer = Buffer.alloc(0); let hello = false;
process.stdin.on("data", (chunk: string | Buffer) => {
  buffer = Buffer.concat([buffer, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
  if (!hello) {
    const newline = buffer.indexOf(10); if (newline < 0) return;
    buffer = buffer.subarray(newline + 1); hello = true; send([200], undefined);
  }
  while (buffer.length >= 13) {
    const size = buffer.readUInt32BE(9); if (buffer.length < 13 + size) return;
    const body = buffer.subarray(13, 13 + size); buffer = buffer.subarray(13 + size);
    const decoded = decodeZcodeValue(body); const header = decoded.value as any[];
    const args = decodeZcodeValue(body, decoded.offset).value as any[];
    let payload: unknown = {};
    if (header[3] === "initialize") payload = { available: true };
    if (header[3] === "createSession") payload = { sessionId: "offline" };
    if (header[3] === "sendPrompt") {
      const request = args[0];
      const allowed = new Set(["workspacePath", "workspaceIdentity", "sessionId", "inputId", "content"]);
      if (!request || typeof request.content !== "string" || Object.keys(request).some(key => !allowed.has(key))) {
        throw new Error("sendPrompt fixture requires the supported content field, not invented instruction parameters");
      }
      payload = { status: "completed", text: request.content };
    }
    send([201, header[1]], payload);
  }
});
