import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  initialNavState,
  navIsExpanded,
  navLabel,
  navReducer,
  navStateOf,
  type NavDisclosure,
} from "./navMachine.ts";

/**
 * Single owner of navigation disclosure across viewports.
 *
 * Desktop (>=861px): expanded <-> collapsed (persisted).
 * Mobile  (<=860px): closed    <-> open        (transient).
 *
 * A breakpoint change normalises state so a drawer can never be left "open"
 * after crossing into desktop, and collapsed semantics never apply on mobile.
 * The state logic lives in `navMachine.ts` and is tested without a DOM.
 */
const STORAGE_KEY = "styx-nav-collapsed";
const DESKTOP_MQ = "(min-width: 861px)";

function readPersisted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persist(value: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* Private storage can be unavailable. */
  }
}

function isDesktop(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_MQ).matches;
}

export function useNavDisclosure() {
  const [state, dispatch] = useReducer(
    navReducer,
    undefined,
    () => initialNavState(isDesktop(), readPersisted()),
  );
  const triggerRef = useRef<HTMLElement | null>(null);

  // Track the breakpoint and normalise the transient drawer state on every crossing.
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const onChange = (event: MediaQueryListEvent) => dispatch({ type: "breakpoint", desktop: event.matches });
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Scroll lock only while the mobile drawer is open, released on every exit path.
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

  const collapse = useCallback(() => {
    if (state.desktop) persist(!state.collapsed);
    dispatch({ type: "collapse" });
  }, [state.desktop, state.collapsed]);

  const close = useCallback(() => dispatch({ type: "close" }), []);

  return {
    state: navStateOf(state) as NavDisclosure,
    desktop: state.desktop,
    collapsed: state.collapsed,
    open: state.open,
    toggle,
    collapse,
    close,
    triggerRef,
    isExpanded: navIsExpanded(state),
    label: navLabel(state),
  };
}
