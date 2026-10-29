import { getDbInstance } from "./core";

export type AntigravityPinProduct = "ide" | "cli";
const namespace = "versionPins";
const validVersion = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

export function getAntigravityVersionPin(product: AntigravityPinProduct): string | null {
  const row = getDbInstance().prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?").get(namespace, `antigravity:${product}`) as { value?: unknown } | undefined;
  return typeof row?.value === "string" && validVersion.test(row.value) ? row.value : null;
}

export function setAntigravityVersionPin(product: AntigravityPinProduct, version: string | null): void {
  if (version !== null && (typeof version !== "string" || !validVersion.test(version))) throw new Error("Invalid version");
  const db = getDbInstance();
  if (version === null) db.prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?").run(namespace, `antigravity:${product}`);
  else db.prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(namespace, `antigravity:${product}`, version);
}
