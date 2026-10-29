// Bun loads this only for `bun test`, never for normal server startup.
if (process.env.STYX_ISOLATED_TEST !== "1") {
  throw new Error("Refusing direct bun test: use the isolated test runner (bun scripts/test-isolated.ts).");
}
