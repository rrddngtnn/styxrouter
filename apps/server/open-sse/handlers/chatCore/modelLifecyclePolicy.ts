import { HTTP_STATUS } from "../../config/constants.ts";
import {
  formatModelLifecycleMessage,
  getModelLifecycleDecision,
} from "../../services/modelLifecycle.ts";
import { resolveModelAlias } from "../../services/modelDeprecation.ts";
import { createErrorResult } from "../../utils/error.ts";

function resolveLifecycleModelAlias(provider: string, model: string): string {
  // Antigravity account catalogs carry the authoritative upstream IDs and may
  // legitimately retain a legacy engine after a global alias was configured.
  // Preserve that exact ID so credential selection can use its per-account
  // catalog; other providers retain the existing deprecation-alias behavior.
  if (provider === "antigravity" || provider === "agy") return model;
  return resolveModelAlias(model);
}

type LifecycleLogger = {
  info?: (tag: string, message: string) => unknown;
  warn?: (tag: string, message: string) => unknown;
} | null;

function getModelLifecycleError({
  provider,
  model,
  log,
  warnOnDeprecation = false,
}: {
  provider: string;
  model: string;
  log?: LifecycleLogger;
  warnOnDeprecation?: boolean;
}): ReturnType<typeof createErrorResult> | null {
  const decision = getModelLifecycleDecision(provider, model);
  const message = formatModelLifecycleMessage(decision);
  if (message && (decision.action === "reject" || warnOnDeprecation)) {
    log?.warn?.("MODEL_LIFECYCLE", message);
  }
  if (decision.action !== "reject" || !message) return null;
  return createErrorResult(
    HTTP_STATUS.GONE,
    message,
    null,
    "model_shutdown",
    "invalid_request_error"
  );
}

export function checkLifecycle(provider: string, model: string, log?: LifecycleLogger) {
  return getModelLifecycleError({
    provider,
    model: resolveLifecycleModelAlias(provider, model),
    log,
  });
}

export function resolveLifecycle(provider: string, model: string, log?: LifecycleLogger) {
  const resolvedModel = resolveLifecycleModelAlias(provider, model);
  if (resolvedModel !== model) {
    log?.info?.("ALIAS", `Model alias applied: ${model} → ${resolvedModel}`);
  }
  const lifecycleError = getModelLifecycleError({
    provider,
    model: resolvedModel,
    log,
    warnOnDeprecation: true,
  });
  return [resolvedModel, resolvedModel === model ? model : resolvedModel, lifecycleError] as const;
}
