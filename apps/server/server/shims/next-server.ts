// Minimal stand-in for `next/server`, wired in through tsconfig "paths". The upstream route modules this host reuses
// only need JSON/redirect responses and a request with `nextUrl`; Next itself is not installed.
export class NextResponse extends Response {
  static json(body?: unknown, init?: ResponseInit): Response {
    return Response.json(body, init);
  }
  static redirect(url: string | URL, init?: number | ResponseInit): Response {
    return Response.redirect(String(url), typeof init === "number" ? init : init?.status ?? 307);
  }
}

export class NextRequest extends Request {
  get nextUrl(): URL {
    return new URL(this.url);
  }
}
