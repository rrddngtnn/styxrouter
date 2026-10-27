import { expect, test, describe } from "bun:test";
import {
  initialNavState,
  navIsExpanded,
  navLabel,
  navReducer,
  navStateOf,
} from "../src/components/shell/navMachine.ts";

describe("navigation disclosure state machine", () => {
  test("toggle opens/closes the drawer identically at every viewport", () => {
    for (const desktop of [true, false]) {
      let s = initialNavState(desktop, false);
      expect(navStateOf(s)).toBe(desktop ? "expanded" : "closed");
      expect(navIsExpanded(s)).toBe(false);
      s = navReducer(s, { type: "toggle" });
      expect(navStateOf(s)).toBe("open");
      expect(navIsExpanded(s)).toBe(true);
      s = navReducer(s, { type: "toggle" });
      expect(navIsExpanded(s)).toBe(false);
    }
  });

  test("collapse narrows desktop workspace only, never opens the drawer", () => {
    let s = initialNavState(true, false);
    s = navReducer(s, { type: "collapse" });
    expect(navStateOf(s)).toBe("collapsed");
    expect(navIsExpanded(s)).toBe(false);
    s = navReducer(s, { type: "collapse" });
    expect(navStateOf(s)).toBe("expanded");

    // mobile collapse is a no-op
    let m = initialNavState(false, false);
    m = navReducer(m, { type: "collapse" });
    expect(m.collapsed).toBe(false);
  });

  test("desktop honours the persisted collapsed choice on boot", () => {
    const s = initialNavState(true, true);
    expect(navStateOf(s)).toBe("collapsed");
  });

  test("breakpoint crossing normalises a stranded open drawer", () => {
    let s = initialNavState(false, false);
    s = navReducer(s, { type: "toggle" });
    expect(navStateOf(s)).toBe("open");
    s = navReducer(s, { type: "breakpoint", desktop: true });
    expect(navStateOf(s)).toBe("expanded");
    expect(s.open).toBe(false);
    s = navReducer(s, { type: "breakpoint", desktop: false });
    expect(s.open).toBe(false);
    expect(s.collapsed).toBe(false);
  });

  test("labels are the same disclosure wording at every viewport", () => {
    let s = initialNavState(true, false);
    expect(navLabel(s)).toBe("Open navigation");
    s = navReducer(s, { type: "toggle" });
    expect(navLabel(s)).toBe("Close navigation");
  });

  test("close is idempotent", () => {
    let s = initialNavState(true, false);
    s = navReducer(s, { type: "close" });
    expect(navIsExpanded(s)).toBe(false);
  });
});
