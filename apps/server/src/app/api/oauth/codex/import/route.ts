import { requireManagementAuth } from "@/lib/api/requireManagementAuth";

/**
 * Imported refresh tokens cannot be safely rotated across server processes.
 * Reject this legacy bulk-import path before reading credentials or contacting
 * the upstream token endpoint. Interactive OAuth/device flows are unaffected.
 */
export async function POST(request: Request) {
  const authResponse = await requireManagementAuth(request, { invalidApiKeyStatus: 401 });
  if (authResponse) return authResponse;

  return Response.json(
    { error: "Codex refresh-token import is disabled. Re-authenticate using the OAuth or device login flow." },
    { status: 409 },
  );
}
