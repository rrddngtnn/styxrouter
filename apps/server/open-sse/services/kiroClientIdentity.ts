import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { hostname, platform, release } from "node:os";

// Released IDE 0.11.133 / @aws/codewhisperer-streaming-client 1.0.34.
// See docs/kiro-client-contract.md for artifact hashes and support boundary.
export const KIRO_IDE_VERSION = "0.11.133";
export const KIRO_STREAMING_SDK_VERSION = "1.0.34";
let machineId: string | undefined;
function getMachineId(): string {
  if (machineId) return machineId;
  try {
    let raw: string;
    if (platform() === "linux") {
      raw = "";
      for (const path of ["/var/lib/dbus/machine-id", "/etc/machine-id"]) {
        try { raw = readFileSync(path, "utf8").split("\n")[0]; if (raw.trim()) break; } catch { /* next OS source */ }
      }
      raw ||= hostname();
    } else if (platform() === "darwin") {
      raw = execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8", timeout: 5000 }).split("IOPlatformUUID")[1].split("\n")[0].replace(/[=\s"]/g, "");
    } else if (platform() === "win32") {
      raw = execFileSync("reg.exe", ["QUERY", "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", timeout: 5000 }).split("REG_SZ")[1];
    } else {
      return machineId = "UNDETERMINED_MACHINE_ID";
    }
    return machineId = createHash("sha256").update(raw.replace(/\s+/g, "").toLowerCase()).digest("hex");
  } catch {
    return machineId = "UNDETERMINED_MACHINE_ID";
  }
}

export function getKiroClientIdentityHeaders(): Record<string, string> {
  // Smithy treats the complete customUserAgent string as ONE tuple and escapes
  // its spaces to hyphens; it is not a slash-delimited KiroIDE/version tuple.
  const custom = `KiroIDE-${KIRO_IDE_VERSION}-${getMachineId()}`;
  const sdk = `aws-sdk-js/${KIRO_STREAMING_SDK_VERSION}`;
  const osRelease = release().replace(/[^!$%&'*+\-.^_`|~\w#]/g, "-");
  return {
    "User-Agent": `${sdk} ua/2.1 os/${platform()}#${osRelease} lang/js md/nodejs#${process.versions.node} api/codewhispererstreaming#${KIRO_STREAMING_SDK_VERSION} m/E ${custom}`,
    "X-Amz-User-Agent": `${sdk} ${custom}`,
  };
}
