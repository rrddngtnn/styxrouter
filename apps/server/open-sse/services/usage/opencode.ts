/** OpenCode observed quota presentation; missing windows and prices stay unknown. */

import { fetchOpencodeQuota, type OpencodeTripleWindowQuota } from "../opencodeQuotaFetcher.ts";
import { sanitizeErrorMessage } from "../../utils/error.ts";
import { type UsageQuota } from "./quota.ts";

export async function getOpencodeUsage(connectionId: string, apiKey: string) {
  if (!apiKey) {
    return { message: "OpenCode API key not available. Add a key to view usage." };
  }

  try {
    const quota = (await fetchOpencodeQuota(connectionId, {
      apiKey,
    })) as OpencodeTripleWindowQuota | null;

    if (!quota) {
      return { message: "OpenCode quota unknown; no supported usage endpoint configured or available.", quotaUnknown: true };
    }

    const quotas: Record<string, UsageQuota> = {};
    for (const [id, window] of Object.entries(quota.windows ?? {})) {
      quotas[id] = {
        used: window.percentUsed * 100,
        total: 100,
        remaining: (1 - window.percentUsed) * 100,
        remainingPercentage: (1 - window.percentUsed) * 100,
        resetAt: window.resetAt,
        unlimited: false,
        displayName: id,
      };
    }
    return { plan: "OpenCode", quotas, limitReached: quota.limitReached };
  } catch (error) {
    return { message: `OpenCode error: ${sanitizeErrorMessage(error)}` };
  }
}
