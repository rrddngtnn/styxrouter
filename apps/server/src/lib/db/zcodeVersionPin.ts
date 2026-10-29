import { getDbInstance } from "./core";

const namespace = "versionPins";
const key = "zcode";
const validVersion = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

export function getZcodeVersionPin(): string | null {
  const row = getDbInstance().prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?").get(namespace, key) as { value?: unknown } | undefined;
  return typeof row?.value === "string" && validVersion.test(row.value) ? row.value : null;
}

export function setZcodeVersionPin(version: string | null): void {
  if (version !== null && !validVersion.test(version)) throw new Error("Invalid version");
  const db = getDbInstance();
  if (version === null) db.prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?").run(namespace, key);
  else db.prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(namespace, key, version);
}
