import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getUsageStats } from "@/lib/usageDb";

export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const stats = await getUsageStats();
    return Response.json(stats);
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    return Response.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
