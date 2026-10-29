export type NavDisclosure = "closed" | "open";
export interface NavMachineState { desktop: boolean; open: boolean; desktopExpanded: boolean }
export const initialNavState = (desktop: boolean): NavMachineState => ({ desktop, open: false, desktopExpanded: true });
export type NavMachineEvent =
  | { type: "toggle" }
  | { type: "close" }
  | { type: "breakpoint"; desktop: boolean };
export function navReducer(state: NavMachineState, event: NavMachineEvent): NavMachineState {
  switch (event.type) {
    case "toggle": return state.desktop ? { ...state, desktopExpanded: !state.desktopExpanded } : { ...state, open: !state.open };
    case "close": return state.open ? { ...state, open: false } : state;
    case "breakpoint": return { ...state, desktop: event.desktop, open: false };
  }
}
export const navIsExpanded = (state: NavMachineState): boolean => state.desktop ? state.desktopExpanded : state.open;
export const navStateOf = (state: NavMachineState): NavDisclosure => navIsExpanded(state) ? "open" : "closed";
export const navLabel = (state: NavMachineState): string => state.desktop
  ? (state.desktopExpanded ? "Collapse sidebar" : "Expand sidebar")
  : (state.open ? "Close navigation" : "Open navigation");
