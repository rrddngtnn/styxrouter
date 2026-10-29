import { WEBHOOK_EVENT_VALUES, type WebhookEvent } from "../src/lib/webhooks/eventDescriptions";

export interface SubscriptionInput {
  url: string;
  events: WebhookEvent[];
  description: string;
}

/** Pure input validation; callers must provide the strict public-only URL guard. */
export function validateSubscriptionInput(
  input: unknown,
  validatePublicUrl: (url: string) => URL,
): SubscriptionInput {
  const invalid = () => new Error("Invalid subscription");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["url", "events", "description"].includes(key))) throw invalid();
  if (typeof value.url !== "string" || value.url.length === 0 || value.url.length > 2048) throw invalid();
  if (!Array.isArray(value.events) || value.events.length === 0 || value.events.length > WEBHOOK_EVENT_VALUES.length ||
      value.events.some((event) => typeof event !== "string" || !(WEBHOOK_EVENT_VALUES as readonly string[]).includes(event)) ||
      new Set(value.events).size !== value.events.length) throw invalid();
  if (value.description !== undefined && (typeof value.description !== "string" || value.description.length > 500)) throw invalid();
  try { validatePublicUrl(value.url); } catch { throw invalid(); }
  return { url: value.url, events: value.events as WebhookEvent[], description: (value.description as string | undefined) ?? "" };
}
