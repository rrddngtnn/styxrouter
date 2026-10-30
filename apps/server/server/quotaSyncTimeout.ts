export interface QuotaSyncServer {
  timeout?(request: Request, seconds: number): void;
}

export function extendQuotaSyncTimeout(request: Request, server?: QuotaSyncServer): void {
  if (request.method !== "POST") return;
  const path = new URL(request.url).pathname;
  // Inference has its own readiness/stall deadlines and cancellation. Bun's
  // short socket idle timer otherwise cuts off quiet thinking/tool streams.
  if (["/v1/chat/completions", "/chat/completions", "/v1/messages", "/messages", "/v1/responses", "/responses"].includes(path)) {
    server?.timeout?.(request, 0);
  } else if (path === "/api/usage/provider-limits") {
    server?.timeout?.(request, 240);
  }
}
