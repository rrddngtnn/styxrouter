import { getModelEndpointDecision } from "@styxrouter/open-sse/services/modelEndpointPolicy";
import { isModelSelectable } from "@styxrouter/open-sse/services/modelLifecycle";

type CatalogModelPolicyInput = {
  id: string;
  supportedEndpoints?: readonly string[];
};

export function isUnifiedChatSourceModelSelectable(
  provider: string,
  model: CatalogModelPolicyInput
): boolean {
  return (
    isModelSelectable(provider, model.id) &&
    getModelEndpointDecision(provider, model.id, model.supportedEndpoints).reason !==
      "provider-policy"
  );
}
