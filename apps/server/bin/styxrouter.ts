#!/usr/bin/env bun
/**
 * StyxRouter CLI entrypoint.
 *
 * Ensures working directory is the `@styxrouter/server` package root so
 * `tsconfig.json` path aliases (`@/*`, `@styxrouter/open-sse/*`) and `./panel`
 * static assets resolve identically whether started from a git checkout, Docker
 * container, or a global `bun add -g @styxrouter/server` / `bunx @styxrouter/server`
 * installation.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(pkgRoot);

const mod = await import("../server/styx.ts");
const srv = mod.default;
if (srv && typeof srv.fetch === "function" && typeof Bun !== "undefined" && typeof Bun.serve === "function") {
  Bun.serve(srv);
}
