import { getProxyLogs, clearProxyLogs } from "@/lib/proxyLogger";
import { sanitizeErrorMessage } from "@styxrouter/open-sse/utils/error";

function serverErrorResponse(error: unknown): Response {
  return Response.json(
    {
      error: {
        message: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
        type: "server_error",
      },
    },
    { status: 500 }
  );
}

/**
 * GET /api/usage/proxy-logs — get proxy usage logs
 * Query params: ?status=ok|error|timeout&type=http|socks5&provider=xxx&level=global|provider|combo|key&search=xxx&limit=300
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const filters: Record<string, any> = {};
    if (searchParams.get("status")) filters.status = searchParams.get("status");
    if (searchParams.get("type")) filters.type = searchParams.get("type");
    if (searchParams.get("provider")) filters.provider = searchParams.get("provider");
    if (searchParams.get("level")) filters.level = searchParams.get("level");
    if (searchParams.get("search")) filters.search = searchParams.get("search");
    if (searchParams.has("limit")) {
      const limit = Number(searchParams.get("limit"));
      if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
        return Response.json(
          {
            error: {
              message: "limit must be an integer between 1 and 10000",
              type: "invalid_request_error",
            },
          },
          { status: 400 }
        );
      }
      filters.limit = limit;
    }

    const logs = getProxyLogs(filters);
    return Response.json(logs);
  } catch (error) {
    return serverErrorResponse(error);
  }
}

/**
 * DELETE /api/usage/proxy-logs — clear all proxy logs
 */
export async function DELETE() {
  try {
    clearProxyLogs();
    return Response.json({ cleared: true });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
