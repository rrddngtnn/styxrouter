import { useEffect, useState } from "react";
import { api, ApiError } from "./api.ts";

export type FetchState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ok"; data: T; error: null }
  | { status: "error"; data: null; error: ApiError | Error };

export function useFetch<T>(path: string | null): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({
    status: "loading",
    data: null,
    error: null,
  });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState({ status: "loading", data: null, error: null });
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
  }, [path]);
  return state;
}
