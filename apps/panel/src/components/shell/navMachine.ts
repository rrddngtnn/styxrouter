/**
 * Pure state machine for navigation disclosure. Separated from React so it can be
 * tested without a DOM; `useNavDisclosure` is a thin adapter around this.
 */

export type NavDisclosure = "expanded" | "collapsed" | "closed" | "open";
export type NavMode = "desktop" | "mobile";

export interface NavMachineState {
  desktop: boolean;
  collapsed: boolean;
  open: boolean;
}

export const initialNavState = (desktop: boolean, persistedCollapsed: boolean): NavMachineState => ({
  desktop,
  collapsed: desktop && persistedCollapsed,
  open: false,
});

export type NavMachineEvent =
  | { type: "toggle" }
  | { type: "close" }
  | { type: "collapse" }
  | { type: "breakpoint"; desktop: boolean };

export function navReducer(state: NavMachineState, event: NavMachineEvent): NavMachineState {
  switch (event.type) {
    // The drawer opens/closes identically at every viewport — one slide animation.
    case "toggle":
      return { ...state, open: !state.open };
    case "close":
      return state.open ? { ...state, open: false } : state;
    // Desktop-only: narrow the workspace without touching the drawer.
    case "collapse":
      return state.desktop ? { ...state, collapsed: !state.collapsed, open: false } : state;
    case "breakpoint":
      // Crossing a breakpoint must never strand an open drawer or apply
      // collapsed semantics on mobile.
      return { ...state, desktop: event.desktop, open: false, collapsed: event.desktop ? state.collapsed : false };
    default:
      return state;
  }
}

export const navStateOf = (s: NavMachineState): NavDisclosure => {
  if (s.open) return "open";
  return s.desktop ? (s.collapsed ? "collapsed" : "expanded") : "closed";
};

export const navIsExpanded = (s: NavMachineState): boolean => s.open;

export const navLabel = (s: NavMachineState): string => {
  return s.open ? "Close navigation" : "Open navigation";
};
