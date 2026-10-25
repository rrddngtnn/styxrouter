// OAuth account onboarding (authorize / exchange / device flow / paste credentials / token import). The route modules
// are upstream's; the session gate in ./auth.ts already covers everything under /api. Specific routes first.
import { Hono } from "hono";
import { mountRoute } from "./routeMount.ts";
import { getProviderLabel } from "../src/shared/constants/providers.ts";
import { REGISTRY } from "../open-sse/config/providers/index.ts";

export function createOAuthApi() {
  const api = new Hono();
  const r = "../src/app/api/oauth";
  const specific: [string, () => Promise<any>][] = [
    ["/oauth/kiro/import", () => import(`${r}/kiro/import/route.ts`)],
    ["/oauth/kiro/api-key", () => import(`${r}/kiro/api-key/route.ts`)],
    ["/oauth/kiro/social-authorize", () => import(`${r}/kiro/social-authorize/route.ts`)],
    ["/oauth/kiro/social-exchange", () => import(`${r}/kiro/social-exchange/route.ts`)],
    ["/oauth/codex/import", () => import(`${r}/codex/import/route.ts`)],
    ["/oauth/codex/import-token", () => import(`${r}/codex/import-token/route.ts`)],
  ];
  // What the panel offers under "Connect account": every registered OAuth provider and the kind of flow it needs.
  api.get("/oauth/providers", async (c) => {
    const { PROVIDERS } = await import("../src/lib/oauth/providers/index.ts");
    const kebab = (id: string) => id.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    const providers = Object.entries(PROVIDERS as Record<string, any>)
      .map(([key, p]) => {
        const id = kebab(key);
        return { key, id, p };
      })
      .filter(({ id }) => {
        const entry = (REGISTRY as Record<string, any>)[id];
        return Boolean(entry && entry.id === id);
      })
      .map(({ key, id, p }) => ({
        id,
        name: getProviderLabel(id, (REGISTRY as Record<string, any>)[id]?.displayName),
        flowType: p.flowType as string,
        // ZCode CLI device flow keeps per-session poll secrets server-side in styx.ts.
        legacyDevice: key === "glm" || key === "zai",
        // Some vendors register exactly one loopback address for their public client; the panel must send it.
        redirectUri: p.fixedPort ? `http://${p.callbackHost || "localhost"}:${p.fixedPort}${p.callbackPath || "/callback"}` : undefined,
      }))
      .sort((x, y) => x.name.localeCompare(y.name));
    return c.json({ providers });
  });

  for (const [path, load] of specific) mountRoute(api, path, load);
  mountRoute(api, "/oauth/:provider/paste-credentials", () => import(`${r}/[provider]/paste-credentials/route.ts`));
  mountRoute(api, "/oauth/:provider/:action", () => import(`${r}/[provider]/[action]/route.ts`));
  return api;
}
