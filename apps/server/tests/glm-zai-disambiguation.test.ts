import { describe, expect, test } from "bun:test";
import { parseModel, resolveProviderAlias } from "../open-sse/services/model.ts";
import { getExecutor } from "../open-sse/executors/index.ts";
import { GlmExecutor } from "../open-sse/executors/glm.ts";
import { resolveProviderId, AI_PROVIDERS } from "../src/shared/constants/providers.ts";
import { isReservedProviderPrefix } from "../src/shared/constants/reservedProviderPrefixes.ts";
import { REGISTRY } from "../open-sse/config/providers/index.ts";
import { buildAliasMaps, prefixRoutesToProvider } from "../src/app/api/v1/models/catalogProviderMaps.ts";

describe("GLM / Z.ai runtime disambiguation", () => {
  test("zai prefix resolves to canonical provider glm at model parse and dispatch", () => {
    expect(resolveProviderAlias("zai")).toBe("glm");
    expect(resolveProviderAlias("glm")).toBe("glm");
    expect(parseModel("zai/glm-5.3")).toMatchObject({
      provider: "glm",
      model: "glm-5.3",
      providerAlias: "zai",
    });
    expect(parseModel("zai/glm-5.3-max")).toMatchObject({
      provider: "glm",
      model: "glm-5.3-max",
      providerAlias: "zai",
    });
    expect(prefixRoutesToProvider("zai", "glm")).toBe(true);
    expect(prefixRoutesToProvider("glm", "glm")).toBe(true);
  });

  test("constants resolveProviderId maps zai to glm and removes legacy standalone zai entry", () => {
    expect(resolveProviderId("zai")).toBe("glm");
    expect(resolveProviderId("glm")).toBe("glm");
    expect(AI_PROVIDERS.zai).toBeUndefined();
    expect(AI_PROVIDERS.glm?.id).toBe("glm");
    const maps = buildAliasMaps();
    expect(maps.aliasToProviderId.zai).toBe("glm");
    expect(maps.aliasToProviderId.glm).toBe("glm");
    expect(maps.providerIdToAlias.glm).toBe("glm");
  });

  test("both glm and zai resolve to GlmExecutor and are reserved provider prefixes", () => {
    expect(getExecutor("glm")).toBeInstanceOf(GlmExecutor);
    expect(getExecutor("zai")).toBeInstanceOf(GlmExecutor);
    expect(isReservedProviderPrefix("glm")).toBe(true);
    expect(isReservedProviderPrefix("zai")).toBe(true);
  });

  test("Zhipu family registry entries expose distinct displayName values", () => {
    expect(REGISTRY.glm?.displayName).toBe("GLM (Z.ai Coding / Start Plan)");
    expect(REGISTRY.glmt?.displayName).toBe("GLM (Thinking)");
    expect(REGISTRY.zcode?.displayName).toBe("ZCode CLI");
  });
});
