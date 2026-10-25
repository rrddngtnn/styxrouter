// Dashboard data (usage, analytics, quota) comes from the shared route modules. Only the prefixes listed here are
// served; everything else in the tree (compression, RTK, admin tooling...) stays unmounted on purpose.
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import { mountTree } from "./routeMount.ts";

export const UPSTREAM_PREFIXES = ["usage", "quota", "providers/quota-windows"] as const;

export async function createUpstreamApi() {
  const api = new Hono();
  await mountTree(api, fileURLToPath(new URL("../src/app/api", import.meta.url)), UPSTREAM_PREFIXES);
  return api;
}
