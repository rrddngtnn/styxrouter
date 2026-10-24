export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The server answers errors as {error: "text"} or {error: {message, details: [{field, message}]}}.
function messageOf(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return fallback;
  const e = (payload as { error: unknown }).error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const { message, details } = e as { message?: unknown; details?: { field?: string; message?: string }[] };
    const first = Array.isArray(details) ? details[0] : undefined;
    const detail = first?.message ? `${first.field ? `${first.field}: ` : ""}${first.message}` : "";
    return [typeof message === "string" ? message : "", detail].filter(Boolean).join(" — ") || fallback;
  }
  return fallback;
}

async function request<T>(
  method: string,
  path: string,
  body?: JsonValue,
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = { method, headers, credentials: "include", signal };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const contentType = res.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text().catch(() => "");
  if (!res.ok) {
    // An expired session on any data call sends the user back to the login page.
    if (res.status === 401 && !path.startsWith("/api/auth/") && !location.pathname.endsWith("/login")) {
      location.assign("/panel/login");
    }
    throw new ApiError(messageOf(payload, res.statusText), res.status, payload);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal),
  post: <T>(path: string, body?: JsonValue, signal?: AbortSignal) =>
    request<T>("POST", path, body, signal),
  put: <T>(path: string, body?: JsonValue, signal?: AbortSignal) =>
    request<T>("PUT", path, body, signal),
  patch: <T>(path: string, body?: JsonValue, signal?: AbortSignal) =>
    request<T>("PATCH", path, body, signal),
  delete: <T>(path: string, signal?: AbortSignal) =>
    request<T>("DELETE", path, undefined, signal),
};
