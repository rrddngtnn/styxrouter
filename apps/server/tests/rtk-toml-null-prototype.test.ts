import { expect, test } from "bun:test";
import {
  parseRtkTomlV1,
  RtkTomlCompatibilityError,
} from "../open-sse/services/compression/engines/rtk/tomlCompatibility.ts";

// smol-toml >= 1.9 returns null-prototype objects; the RTK TOML loader must
// still validate, enumerate filters and resolve test references.
test("RTK TOML v1 parses null-prototype documents from smol-toml", () => {
  const result = parseRtkTomlV1(`
schema_version = 1

[filters.ls]
description = "Compact ls output"
match_command = "^ls"
strip_lines_matching = ["^total \\\\d+$"]

[[tests.ls]]
name = "drops total"
input = "total 4\\nfile.txt"
expected = "file.txt"
`);
  expect(JSON.stringify(result)).toContain("ls");
});

test("RTK TOML v1 still rejects unknown test references", () => {
  let error: unknown;
  try {
    parseRtkTomlV1(`
schema_version = 1

[filters.ls]
description = "Compact ls output"
match_command = "^ls"

[[tests.missing]]
name = "orphan"
input = "x"
expected = "x"
`);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(RtkTomlCompatibilityError);
  expect((error as RtkTomlCompatibilityError).publicMessage).toBe(
    "tests reference unknown filter 'missing'"
  );
});
