import { expect, test } from "bun:test";
import { addCustomModel, getCustomModels, removeCustomModel, getModelCompatOverrides, mergeModelCompatOverride } from "../src/lib/db/models.ts";
import { getModelContextOverrideRecord, setModelContextOverride } from "../src/lib/db/modelContextOverrides.ts";
import { getBooleanModelCapabilityOverrides, getModelCapabilityOverride, setModelCapabilityOverride } from "../src/lib/db/modelCapabilityOverrides.ts";

test("manual model deletion preserves independently configured model overrides", async () => {
  const provider = "openai", model = "manual-delete-fixture";
  await addCustomModel(provider, model);
  setModelContextOverride(provider, model, 123456);
  setModelCapabilityOverride(`${provider}/${model}`, "supportsTools", false);
  setModelCapabilityOverride(`${provider}/${model}`, "max_output_tokens", 1234);
  mergeModelCompatOverride(provider, model, { supportsVision: true });
  expect(await removeCustomModel(provider, model, { builtinIds: [] })).toBe(true);
  expect(getModelContextOverrideRecord(provider, model)?.realContext).toBe(123456);
  expect(getBooleanModelCapabilityOverrides(provider, model)).toEqual({ supportsTools: false });
  expect(getModelCapabilityOverride(provider, model, "max_output_tokens")).toBe(1234);
  expect(getModelCompatOverrides(provider).find(item => item.id === model)?.supportsVision).toBe(true);
  expect((await getCustomModels(provider)).some((item: any) => item.id === model)).toBe(false);
  await addCustomModel(provider, model);
  expect(getModelContextOverrideRecord(provider, model)?.realContext).toBe(123456);
  expect(getBooleanModelCapabilityOverrides(provider, model)).toEqual({ supportsTools: false });
});

test("refusing built-in deletion preserves its metadata", async () => {
  const provider = "openai", model = "builtin-fixture";
  await addCustomModel(provider, model);
  setModelContextOverride(provider, model, 456789);
  setModelCapabilityOverride(`${provider}/${model}`, "supportsVision", true);
  await expect(removeCustomModel(provider, model, { builtinIds: [model] })).rejects.toThrow();
  expect(getModelContextOverrideRecord(provider, model)?.realContext).toBe(456789);
  expect(getBooleanModelCapabilityOverrides(provider, model)).toEqual({ supportsVision: true });
});
