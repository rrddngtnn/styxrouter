import { useCallback, useEffect, useReducer } from "react";
import {
  initialNavState,
  navIsExpanded,
  navLabel,
  navReducer,
  navStateOf,
  type NavDisclosure,
} from "./navMachine.ts";

/** Desktop sidebar preference and transient mobile drawer share one disclosure. */
const DESKTOP_MQ = "(min-width: 861px)";

function isDesktop(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_MQ).matches;
}

export function useNavDisclosure() {
  const [state, dispatch] = useReducer(
    navReducer,
    undefined,
    () => initialNavState(isDesktop()),
  );

  // Track the breakpoint and normalise the transient drawer state on every crossing.
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const onChange = (event: MediaQueryListEvent) => dispatch({ type: "breakpoint", desktop: event.matches });
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Scroll lock while the drawer is open, released on every exit path.
  useEffect(() => {
    if (!state.open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [state.open]);

  const toggle = useCallback(() => {
    dispatch({ type: "toggle" });
  }, []);

  const close = useCallback(() => dispatch({ type: "close" }), []);

  return {
    state: navStateOf(state) as NavDisclosure,
    desktop: state.desktop,
    open: state.open,
    toggle,
    close,
    isExpanded: navIsExpanded(state),
    label: navLabel(state),
  };
}
