import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { initTranslators } from "../open-sse/translator/index";
import { handleChat } from "../src/sse/handlers/chat";

// Regression: a syntactically-valid JSON body that is a primitive (number,
// string, boolean, null) — not an object — must be rejected with a clean 400,
// not crash the handler with an uncaught TypeError.
//
// Root cause (chat.ts): the body-parse try/catch only catches JSON *syntax*
// errors. A valid primitive parses fine, then `"messages" in msgBody` (the
// early messages-shape guard) throws `TypeError: msgBody is not an Object`
// because the `in` operator requires an object right-hand side. The throw is
// outside the parse try/catch, so it escapes the handler.

function makeReq(bodyText: string) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: bodyText,
  });
}

test("primitive JSON bodies return a clean 400, never throw", async () => {
  await initTranslators();
  for (const bodyText of ["42", '"hello"', "true", "null"]) {
    let res: Response;
    try {
      res = await handleChat(makeReq(bodyText) as any);
    } catch (e: any) {
      throw new Error(
        `handleChat threw for body=${bodyText}: ${e?.constructor?.name}: ${e?.message}`
      );
    }
    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { error?: { message?: string } };
    expect(typeof parsed?.error?.message).toBe("string");
  }
});
