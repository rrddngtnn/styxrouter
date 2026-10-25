// Stand-in for `next/headers`. Only `headers` is provided, deliberately not `cookies`: apiAuth feature-detects
// `cookies` to decide whether it is running under Next and otherwise reads the request's own cookie header.
// Callers that fall back to `headers()` only do so when the request object carried no header; an empty set is the
// honest answer outside a Next request scope.
export async function headers(): Promise<Headers> {
  return new Headers();
}
