import { expect, test, describe } from "bun:test";
import {
  initialNavState,
  navIsExpanded,
  navLabel,
  navReducer,
  navStateOf,
} from "../src/components/shell/navMachine.ts";

describe("navigation disclosure state machine", () => {
  test("toggle opens/closes the same transient drawer at every viewport", () => {
    for (const desktop of [true, false]) {
      let s = initialNavState(desktop);
      expect(Object.keys(s).sort()).toEqual(["desktop", "open"]);
      expect(navStateOf(s)).toBe("closed");
      expect(navIsExpanded(s)).toBe(false);
      s = navReducer(s, { type: "toggle" });
      expect(navStateOf(s)).toBe("open");
      expect(navIsExpanded(s)).toBe(true);
      s = navReducer(s, { type: "toggle" });
      expect(navStateOf(s)).toBe("closed");
    }
  });

  test("breakpoint crossing normalises a stranded open drawer", () => {
    let s = navReducer(initialNavState(false), { type: "toggle" });
    expect(navStateOf(s)).toBe("open");
    s = navReducer(s, { type: "breakpoint", desktop: true });
    expect(s).toEqual({ desktop: true, open: false });
    s = navReducer(s, { type: "breakpoint", desktop: false });
    expect(s).toEqual({ desktop: false, open: false });
  });

  test("labels are the same disclosure wording at every viewport", () => {
    let s = initialNavState(true);
    expect(navLabel(s)).toBe("Open navigation");
    s = navReducer(s, { type: "toggle" });
    expect(navLabel(s)).toBe("Close navigation");
  });

  test("close is idempotent", () => {
    const s = initialNavState(true);
    expect(navReducer(s, { type: "close" })).toBe(s);
    expect(navReducer(navReducer(s, { type: "toggle" }), { type: "close" }).open).toBe(false);
  });
});
