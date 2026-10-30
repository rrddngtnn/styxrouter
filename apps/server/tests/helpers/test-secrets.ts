// Side-effect module: seed the crypto/auth secrets a test needs into the
// current process environment.
//
// The isolated runner (scripts/test-isolated.ts) deliberately DROPS inherited
// secrets so every test starts from a clean environment — this is an explicit
// contract asserted by runner-clean-env-regression.test.ts. Tests that exercise
// API-key CRC, JWT sessions, encrypted storage, or the management login must
// therefore supply their own deterministic secrets.
//
// Import this FIRST, before any module that reads these at import time:
//
//   import "./helpers/test-secrets";
//   import { createApiKey } from "../src/lib/db/apiKeys";
//
// Values are only set when absent, so a test may still override any of them by
// assigning process.env.X before importing this module.

function seed(name: string, value: string): void {
  if (!process.env[name] || process.env[name]!.trim() === "") {
    process.env[name] = value;
  }
}

seed("JWT_SECRET", "fixture-jwt-secret-0123456789abcdef-0123456789abcdef");
seed("API_KEY_SECRET", "fixture-api-key-secret-0123456789abcdef");
seed(
  "STORAGE_ENCRYPTION_KEY",
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);

export {};
