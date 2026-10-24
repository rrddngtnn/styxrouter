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
    throw new ApiError(
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error: unknown }).error)
        : res.statusText,
      res.status,
      payload,
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal),
  post: <T>(path: string, body?: JsonValue, signal?: AbortSignal) =>
    request<T>("POST", path, body, signal),
  patch: <T>(path: string, body?: JsonValue, signal?: AbortSignal) =>
    request<T>("PATCH", path, body, signal),
  delete: <T>(path: string, signal?: AbortSignal) =>
    request<T>("DELETE", path, undefined, signal),
};
