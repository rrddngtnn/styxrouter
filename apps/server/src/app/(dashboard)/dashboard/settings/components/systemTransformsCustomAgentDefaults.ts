/**
 * CustomAgent (NousResearch/custom-agent) system-transform anchors — client-side
 * mirror constant shared by RoutingTab.tsx and tests/unit/system-transforms.test.ts's
 * UI-parity snapshot. Extracted to a standalone module to keep RoutingTab.tsx
 * under its frozen file-size baseline (#8350).
 *
 * Server source of truth: open-sse/services/systemTransforms.ts
 * (CUSTOMAGENT_PARAGRAPH_ANCHORS / CUSTOMAGENT_IDENTITY_PREFIXES).
 */
export const CUSTOMAGENT = {
  anchors: ["custom-agent.nousresearch.com", "github.com/NousResearch/custom-agent"],
  prefixes: ["You are CustomAgent Agent"],
};
