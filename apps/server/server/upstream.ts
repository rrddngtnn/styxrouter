// Dashboard data (usage, analytics, quota) comes from upstream's route modules. Only the prefixes listed here are
// served; everything else in the upstream tree (compression, RTK, admin tooling...) stays unmounted on purpose.
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import { mountNextTree } from "./nextRoutes.ts";

export const UPSTREAM_PREFIXES = ["usage", "quota", "providers/quota-windows"] as const;

export function createUpstreamApi() {
  const api = new Hono();
  mountNextTree(api, fileURLToPath(new URL("../src/app/api", import.meta.url)), UPSTREAM_PREFIXES);
  return api;
}
