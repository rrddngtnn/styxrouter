import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MiddlewareHandler } from "hono";
import { serveStatic } from "hono/bun";

// Only these retained legal documents are public text assets, not arbitrary .txt files.
const notices = new Map([
  ["/panel/brand/LICENSE-NOTICE.txt", "LICENSE-NOTICE.txt"],
  ["/panel/brand/PROVENANCE.txt", "PROVENANCE.txt"],
  ["/panel/brand/STYXROUTER-BRAND-KIT-NOTICE.txt", "STYXROUTER-BRAND-KIT-NOTICE.txt"],
]);

export function servePanel(panelRoot: string): MiddlewareHandler {
  const staticFiles = serveStatic({
    root: panelRoot,
    rewriteRequestPath: (p) => {
      const stripped = p.replace(/^\/panel/, "");
      const lastSegment = stripped.split("/").pop() ?? "";
      // Dotted provider IDs remain client-side routes, not filesystem paths.
      const isStaticAsset = stripped.startsWith("/assets/") ||
        /\.(?:js|mjs|css|map|html|json|svg|png|jpe?g|gif|webp|ico|woff2?|ttf)$/i.test(lastSegment);
      return isStaticAsset ? stripped : "/index.html";
    },
  });
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    // Reject ambiguous encodings, dotfiles and database paths before static resolution.
    // Never turn a URL-controlled path into a legal-document filesystem read.
    let decoded: string;
    try { decoded = decodeURIComponent(path); } catch { return c.notFound(); }
    if (/%(?:2e|2f|5c|00|25)/i.test(path) || /[\\\0]/.test(decoded) ||
        decoded.split("/").some(segment => segment.startsWith(".")) ||
        /\.(?:sqlite(?:3)?|db)(?:\/|$)/i.test(decoded)) return c.notFound();

    const notice = notices.get(path);
    if (notice) {
      if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.notFound();
      c.header("Cache-Control", "no-store");
      let bytes: Buffer;
      try { bytes = await readFile(join(panelRoot, "brand", notice)); }
      catch { return c.notFound(); }
      c.header("Content-Type", "text/plain; charset=utf-8");
      c.header("X-Content-Type-Options", "nosniff");
      if (c.req.method === "HEAD") return c.body(null);
      return c.body(new Uint8Array(bytes));
    }
    // Unknown/case-mismatched legal documents must not masquerade as the SPA.
    if (/\.txt(?:\/|$)/i.test(decoded)) return c.notFound();
    return staticFiles(c, next);
  };
}
