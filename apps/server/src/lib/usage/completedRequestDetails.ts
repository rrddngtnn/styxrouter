import { getDbInstance } from "../db/core";
import type { PendingRequestDetail } from "./usageHistory";
import { protectPayloadForLog } from "../logPayloads";
import { truncatePendingPreview } from "./usageHistory/helpers";

const COMPLETED_DETAIL_TTL_MS = 120_000;
const MAX_COMPLETED_DETAILS = 256;
const MAX_COMPLETED_BYTES = 8 * 1024 * 1024;
const MAX_DETAIL_BYTES = 128 * 1024;
const completedSizes = new Map<string, number>();
let retainedBytes = 0;

const completedDetails = new Map<string, PendingRequestDetail>();
const completedDetailTimers = new Map<string, ReturnType<typeof setTimeout>>();

function deleteCompletedDetail(id: string) {
  retainedBytes -= completedSizes.get(id) ?? 0;
  completedSizes.delete(id);
  completedDetails.delete(id);
  const existingTimer = completedDetailTimers.get(id);
  if (existingTimer) {
    clearTimeout(existingTimer);
    completedDetailTimers.delete(id);
  }
}

function trimCompletedDetails() {
  while (completedDetails.size > MAX_COMPLETED_DETAILS || retainedBytes > MAX_COMPLETED_BYTES) {
    const oldestId = completedDetails.keys().next().value;
    if (!oldestId) break;
    deleteCompletedDetail(oldestId);
  }
}

export function getCompletedDetails(): Map<string, PendingRequestDetail> {
  return completedDetails;
}

export function storeCompletedDetail(detail: PendingRequestDetail) {
  const preview = { ...detail };
  for (const key of ["clientRequest", "providerRequest", "providerResponse", "clientResponse"] as const) {
    if (preview[key] !== undefined) preview[key] = truncatePendingPreview(protectPayloadForLog(preview[key]));
  }
  // Completed stream payloads remain on disk; do not retain chunk arrays here.
  delete preview.streamChunks;
  let body: string;
  try { body = JSON.stringify(preview); } catch { return; }
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_DETAIL_BYTES) {
    deleteCompletedDetail(detail.id);
    return;
  }
  retainedBytes -= completedSizes.get(detail.id) ?? 0;
  completedDetails.set(detail.id, JSON.parse(body));
  completedSizes.set(detail.id, bytes);
  retainedBytes += bytes;
  trimCompletedDetails();
}

export function scheduleCompletedDetailCleanup(id: string) {
  if (!completedDetails.has(id)) return;
  const existingTimer = completedDetailTimers.get(id);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    deleteCompletedDetail(id);
  }, COMPLETED_DETAIL_TTL_MS);
  timer.unref?.();
  completedDetailTimers.set(id, timer);
}

export function clearCompletedDetails() {
  for (const timer of completedDetailTimers.values()) clearTimeout(timer);
  completedDetailTimers.clear();
  completedDetails.clear();
  completedSizes.clear();
  retainedBytes = 0;
}

export function maybeEnrichCompletedDetail(updated: PendingRequestDetail, connectionId: string) {
  void (async () => {
    try {
      const missingProvider =
        updated.providerResponse === undefined || updated.providerResponse === null;
      const missingClient = updated.clientResponse === undefined || updated.clientResponse === null;
      if (!missingProvider && !missingClient) return;

      const db = getDbInstance();
      const sinceIso = new Date(Date.now() - 30_000).toISOString();
      const rows = db
        .prepare(
          `SELECT artifact_relpath FROM call_logs WHERE connection_id = ? AND model = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT 5`
        )
        .all(connectionId, updated.model, sinceIso) as Array<{ artifact_relpath: string | null }>;
      for (const row of rows) {
        if (!row.artifact_relpath) continue;
        const { readCallArtifact } = await import("./callLogArtifacts");
        const art = readCallArtifact(row.artifact_relpath);
        if (art.state !== "ready" || !art.artifact) continue;
        const pipeline = art.artifact.pipeline as
          | { providerResponse?: unknown; clientResponse?: unknown }
          | undefined;
        if (missingProvider && pipeline?.providerResponse) {
          updated.providerResponse = pipeline.providerResponse;
        }
        if (missingClient && pipeline?.clientResponse) {
          updated.clientResponse = pipeline.clientResponse;
        }
        if (
          (missingProvider && art.artifact.responseBody) ||
          (missingClient && art.artifact.responseBody)
        ) {
          if (missingProvider) updated.providerResponse = art.artifact.responseBody;
          if (missingClient) updated.clientResponse = art.artifact.responseBody;
        }
        if (updated.providerResponse || updated.clientResponse) {
          if (completedDetails.has(updated.id)) storeCompletedDetail(updated);
          break;
        }
      }
    } catch (e) {
      try {
        console.warn(
          "[usageHistory] failed to enrich completed detail from artifacts:",
          e && (e.message || e)
        );
      } catch {}
    }
  })();
}
