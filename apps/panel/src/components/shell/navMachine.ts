/** Transient drawer disclosure, identical at every viewport. */
export type NavDisclosure = "closed" | "open";
export interface NavMachineState { desktop: boolean; open: boolean }
export const initialNavState = (desktop: boolean): NavMachineState => ({ desktop, open: false });
export type NavMachineEvent =
  | { type: "toggle" }
  | { type: "close" }
  | { type: "breakpoint"; desktop: boolean };
export function navReducer(state: NavMachineState, event: NavMachineEvent): NavMachineState {
  switch (event.type) {
    case "toggle": return { ...state, open: !state.open };
    case "close": return state.open ? { ...state, open: false } : state;
    case "breakpoint": return { desktop: event.desktop, open: false };
  }
}
export const navStateOf = (state: NavMachineState): NavDisclosure => state.open ? "open" : "closed";
export const navIsExpanded = (state: NavMachineState): boolean => state.open;
export const navLabel = (state: NavMachineState): string => state.open ? "Close navigation" : "Open navigation";
