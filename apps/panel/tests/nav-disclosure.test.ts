import { expect, test, describe } from "bun:test";
import { initialNavState, navIsExpanded, navLabel, navReducer } from "../src/components/shell/navMachine.ts";

describe("responsive navigation", () => {
  test("desktop starts expanded, toggles to a rail, and route close leaves it unchanged", () => {
    let state = initialNavState(true);
    expect(navIsExpanded(state)).toBe(true);
    expect(navLabel(state)).toBe("Collapse sidebar");
    state = navReducer(state, { type: "toggle" });
    expect(navIsExpanded(state)).toBe(false);
    expect(navReducer(state, { type: "close" })).toEqual(state);
    expect(navIsExpanded(navReducer(state, { type: "toggle" }))).toBe(true);
  });

  test("mobile drawer closes on navigation and breakpoint while retaining desktop preference", () => {
    let state = navReducer(initialNavState(true), { type: "toggle" });
    state = navReducer(state, { type: "breakpoint", desktop: false });
    expect(navIsExpanded(state)).toBe(false);
    state = navReducer(state, { type: "toggle" });
    expect(navIsExpanded(state)).toBe(true);
    state = navReducer(state, { type: "close" });
    expect(navIsExpanded(state)).toBe(false);
    state = navReducer(state, { type: "toggle" });
    state = navReducer(state, { type: "breakpoint", desktop: true });
    expect(navIsExpanded(state)).toBe(false);
    expect(state.open).toBe(false);
    expect(navIsExpanded(navReducer(state, { type: "toggle" }))).toBe(true);
  });
});
