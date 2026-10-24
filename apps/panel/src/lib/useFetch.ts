import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.ts";

export type FetchState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ok"; data: T; error: null }
  | { status: "error"; data: null; error: ApiError | Error };

/** `reload()` refetches without flashing back to "loading", so a table stays on screen while it updates. */
export function useFetch<T>(path: string | null): FetchState<T> & { reload: () => void } {
  const [state, setState] = useState<FetchState<T>>({
    status: "loading",
    data: null,
    error: null,
  });
  const [tick, setTick] = useState(0);
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    if (lastPath.current !== path) {
      lastPath.current = path;
      setState({ status: "loading", data: null, error: null });
    }
    api
      .get<T>(path, controller.signal)
      .then((data) => setState({ status: "ok", data, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          data: null,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
    return () => controller.abort();
  }, [path, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
