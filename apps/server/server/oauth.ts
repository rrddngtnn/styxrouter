// OAuth account onboarding (authorize / exchange / device flow / paste credentials / token import). The route modules
// are upstream's; the session gate in ./auth.ts already covers everything under /api. Specific routes first.
import { Hono } from "hono";
import { mountNextRoute } from "./nextRoutes.ts";
import { getProviderLabel } from "../src/shared/constants/providers.ts";

export function createOAuthApi() {
  const api = new Hono();
  const r = "../src/app/api/oauth";
  const specific: [string, () => Promise<any>, string[]?][] = [
    ["/oauth/cursor/login/start", () => import(`${r}/cursor/login/start/route.ts`)],
    ["/oauth/cursor/login/poll", () => import(`${r}/cursor/login/poll/route.ts`)],
    ["/oauth/cursor/login/cancel", () => import(`${r}/cursor/login/cancel/route.ts`)],
    ["/oauth/cursor/import", () => import(`${r}/cursor/import/route.ts`)],
    ["/oauth/cursor/auto-import", () => import(`${r}/cursor/auto-import/route.ts`)],
    ["/oauth/raycast/import", () => import(`${r}/raycast/import/route.ts`)],
    ["/oauth/raycast/auto-import", () => import(`${r}/raycast/auto-import/route.ts`)],
    ["/oauth/trae/import", () => import(`${r}/trae/import/route.ts`)],
    ["/oauth/kiro/import", () => import(`${r}/kiro/import/route.ts`)],
    ["/oauth/kiro/auto-import", () => import(`${r}/kiro/auto-import/route.ts`)],
    ["/oauth/kiro/api-key", () => import(`${r}/kiro/api-key/route.ts`)],
    ["/oauth/kiro/social-authorize", () => import(`${r}/kiro/social-authorize/route.ts`)],
    ["/oauth/kiro/social-exchange", () => import(`${r}/kiro/social-exchange/route.ts`)],
    ["/oauth/codex/import", () => import(`${r}/codex/import/route.ts`)],
    ["/oauth/codex/import-token", () => import(`${r}/codex/import-token/route.ts`)],
    ["/oauth/cliproxy-import", () => import(`${r}/cliproxy-import/route.ts`)],
  ];
  // What the panel offers under "Connect account": every OAuth provider and the kind of flow it needs.
  api.get("/oauth/providers", async (c) => {
    const { PROVIDERS } = await import("../src/lib/oauth/providers/index.ts");
    const kebab = (id: string) => id.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    const providers = Object.entries(PROVIDERS as Record<string, any>)
      .map(([key, p]) => {
        const id = kebab(key);
        return {
          id,
          name: getProviderLabel(id, undefined),
          flowType: p.flowType as string,
          // Served by the device-flow routes in styx.ts (zai -> glm mapping, ZCode secrets kept server-side).
          legacyDevice: Boolean(p.requestDeviceCode && p.pollToken),
          // Some vendors register exactly one loopback address for their public client; the panel must send it.
          redirectUri: p.fixedPort ? `http://${p.callbackHost || "localhost"}:${p.fixedPort}${p.callbackPath || "/callback"}` : undefined,
        };
      })
      .sort((x, y) => x.name.localeCompare(y.name));
    return c.json({ providers });
  });

  for (const [path, load] of specific) mountNextRoute(api, path, load);
  mountNextRoute(api, "/oauth/:provider/paste-credentials", () => import(`${r}/[provider]/paste-credentials/route.ts`));
  mountNextRoute(api, "/oauth/:provider/:action", () => import(`${r}/[provider]/[action]/route.ts`));
  return api;
}
