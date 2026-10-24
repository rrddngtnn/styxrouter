// Authentication for the Hono host (replaces the upstream Next middleware that was dropped).
//   /api/*  -> dashboard session cookie (JWT signed with JWT_SECRET); health + auth routes are public
//   /v1/*   -> API key (a session may additionally read /v1/models for the panel)
// Fails closed: without JWT_SECRET no session can exist, so management stays locked.
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SignJWT, jwtVerify } from "jose";
import { getSettings } from "../src/lib/db/settings.ts";
import { validateApiKey } from "../src/lib/db/apiKeys.ts";
import {
  ensurePersistentManagementPasswordHash,
  getStoredManagementPassword,
  verifyManagementPassword,
} from "../src/lib/auth/managementPassword.ts";
import { checkLoginGuard, clearLoginAttempts, recordLoginFailure } from "../src/server/auth/loginGuard.ts";

const COOKIE = "auth_token";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const PUBLIC_API = new Set(["/api/health", "/api/health/ping", "/api/auth/status", "/api/auth/login", "/api/auth/logout"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const secretKey = () => {
  const s = process.env.JWT_SECRET?.trim();
  return s ? new TextEncoder().encode(s) : null;
};

export async function hasSession(c: Context): Promise<boolean> {
  const key = secretKey();
  const token = getCookie(c, COOKIE);
  if (!key || !token) return false;
  try {
    await jwtVerify(token, key);
    return true;
  } catch {
    return false;
  }
}

// Bearer only: that is the one scheme the /v1 handlers behind this gate honour.
function apiKeyOf(c: Context): string | null {
  const bearer = c.req.header("authorization")?.trim();
  return bearer && /^bearer\s+/i.test(bearer) ? bearer.replace(/^bearer\s+/i, "").trim() || null : null;
}

// A cookie is attached by the browser on any request, so a write made with one must come from our own origin.
function foreignOrigin(c: Context): boolean {
  const origin = c.req.header("origin");
  if (!origin) return false;
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

// Behind Caddy every peer is loopback; the last X-Forwarded-For entry is the one Caddy appended.
export function clientIp(c: Context): string | null {
  const peer = (c.env as { peerAddress?: string } | undefined)?.peerAddress ?? null;
  const loopback = !peer || ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer);
  const forwarded = c.req.header("x-forwarded-for")?.split(",").pop()?.trim();
  return loopback && forwarded ? forwarded : peer;
}

const denied = (c: Context, status: 401 | 403, message: string) =>
  c.json({ error: { message, type: status === 401 ? "authentication_error" : "forbidden" } }, status);

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const path = new URL(c.req.url).pathname.replace(/\/+$/, "") || "/";

  if (path === "/api" || path.startsWith("/api/")) {
    if (PUBLIC_API.has(path)) return next();
    if (!(await hasSession(c))) return denied(c, 401, "Authentication required");
    if (!SAFE_METHODS.has(c.req.method) && foreignOrigin(c)) return denied(c, 403, "Cross-origin request refused");
    return next();
  }

  if (path === "/v1" || path.startsWith("/v1/")) {
    const key = apiKeyOf(c);
    if (key && (await validateApiKey(key))) return next();
    if (!key && c.req.method === "GET" && path === "/v1/models" && (await hasSession(c))) return next();
    return denied(c, 401, key ? "Invalid API key" : "Authentication required");
  }

  return next(); // panel assets and the root redirect
};

export const authStatus = async (c: Context) => c.json({ authenticated: await hasSession(c) });

export const authLogout = (c: Context) => {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true, success: true });
};

export const authLogin = async (c: Context) => {
  const key = secretKey();
  if (!key) return c.json({ error: "Server misconfigured: JWT_SECRET is not set" }, 503);

  const body = await c.req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || password.length > 200) return c.json({ error: "Invalid request" }, 400);

  const ip = clientIp(c);
  const guard = checkLoginGuard(ip, { enabled: true });
  if (!guard.allowed) {
    c.header("Retry-After", String(guard.retryAfterSeconds ?? 60));
    return c.json({ error: "Too many failed attempts. Try again later." }, 429);
  }

  const state = await ensurePersistentManagementPasswordHash({ settings: (await getSettings()) as any, source: "auth.login" });
  const hash = getStoredManagementPassword(state.settings);
  if (!hash) return c.json({ error: "No password configured", needsSetup: true }, 403);

  if (!(await verifyManagementPassword(password, hash))) {
    const failure = recordLoginFailure(ip, { enabled: true });
    if (!failure.allowed) {
      c.header("Retry-After", String(failure.retryAfterSeconds ?? 60));
      return c.json({ error: "Too many failed attempts. Try again later." }, 429);
    }
    return c.json({ error: "Invalid password" }, 401);
  }

  clearLoginAttempts(ip);
  const token = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(key);
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: process.env.AUTH_COOKIE_SECURE === "true" || c.req.header("x-forwarded-proto")?.split(",")[0].trim() === "https",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return c.json({ success: true, authenticated: true });
};
