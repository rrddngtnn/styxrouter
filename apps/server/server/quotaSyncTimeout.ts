export interface QuotaSyncServer {
  timeout?(request: Request, seconds: number): void;
}

export function extendQuotaSyncTimeout(request: Request, server?: QuotaSyncServer): void {
  // Sequential OAuth quota probes intentionally take longer than Bun's 10s idle default.
  if (request.method === "POST" && new URL(request.url).pathname === "/api/usage/provider-limits") {
    server?.timeout?.(request, 240);
  }
}
