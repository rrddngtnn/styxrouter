import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { decryptConfigBundle, encryptConfigBundle } from "../server/configBundle";
import { createAdminApi2 } from "../server/admin2";
import { createCombo, getCombos } from "../src/lib/db/combos";
import { getSettings, updateSettings } from "../src/lib/db/settings";

test("encryptConfigBundle and decryptConfigBundle round-trip with matching passphrase and reject wrong passphrase", () => {
  const payload = {
    version: 1 as const,
    exportedAt: "2026-10-31T08:00:00.000Z",
    settings: { fallbackStrategy: "round-robin" },
    combos: [{ name: "bundle-combo", strategy: "priority", models: ["glm/glm-5.3"] }],
    providerNodes: [],
  };
  const envelope = encryptConfigBundle(payload, "correct-horse-battery-staple");
  expect(envelope.format).toBe("styx-encrypted-config-v1");
  expect(JSON.stringify(envelope)).not.toContain("bundle-combo");

  const opened = decryptConfigBundle(envelope, "correct-horse-battery-staple");
  expect(opened.combos).toHaveLength(1);
  expect(opened.combos[0]?.name).toBe("bundle-combo");
  expect(opened.settings.fallbackStrategy).toBe("round-robin");

  expect(() => decryptConfigBundle(envelope, "wrong-passphrase-1234")).toThrow();
});

test("POST /config-bundle/export and /config-bundle/import export encrypted bundle and merge settings + combos", async () => {
  const app = createAdminApi2();
  await updateSettings({ fallbackStrategy: "least-used" });
  await createCombo({
    name: "export-test-combo",
    strategy: "priority",
    models: ["glm/glm-5.3"],
  } as never);

  const exportRes = await app.request("/config-bundle/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passphrase: "strong-bundle-passphrase" }),
  });
  expect(exportRes.status).toBe(200);
  const { bundle } = (await exportRes.json()) as { bundle: unknown };

  // Mutate local state so we can verify import restores/merges it
  await updateSettings({ fallbackStrategy: "priority" });

  const badImport = await app.request("/config-bundle/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      passphrase: "wrong-bundle-passphrase",
      mode: "merge",
      bundle,
    }),
  });
  expect(badImport.status).toBe(400);

  const okImport = await app.request("/config-bundle/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      passphrase: "strong-bundle-passphrase",
      mode: "merge",
      bundle,
    }),
  });
  expect(okImport.status).toBe(200);
  const summary = (await okImport.json()) as {
    success: boolean;
    settingsUpdated: number;
    combosImported: number;
  };
  expect(summary.success).toBe(true);
  expect(summary.settingsUpdated).toBeGreaterThan(0);

  const settingsAfter = (await getSettings()) as Record<string, unknown>;
  expect(settingsAfter.fallbackStrategy).toBe("least-used");
  const combosAfter = (await getCombos()) as Array<{ name: string }>;
  expect(combosAfter.some((c) => c.name === "export-test-combo")).toBe(true);
});
