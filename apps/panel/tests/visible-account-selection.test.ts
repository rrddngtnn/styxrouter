import { expect, test } from "bun:test";
import { updateVisibleAccountSelection } from "../src/lib/account-management.ts";

test("selecting and clearing visible accounts preserves selections hidden by a search", () => {
  const selected = new Set(["hidden", "visible-a"]);
  const visible = [{ id: "visible-a" }, { id: "visible-b" }];
  const all = updateVisibleAccountSelection(selected, visible, true);
  expect([...all].sort()).toEqual(["hidden", "visible-a", "visible-b"]);
  expect([...selected].sort()).toEqual(["hidden", "visible-a"]);
  expect([...updateVisibleAccountSelection(all, visible, false)]).toEqual(["hidden"]);
});
