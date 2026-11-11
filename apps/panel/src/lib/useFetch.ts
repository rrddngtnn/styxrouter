import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.ts";
import { applyReadResult } from "./read-state.ts";

type Observation = { stale: boolean; lastSuccessAt: string | null };
export type FetchState<T> = Observation & (
  | { status: "loading"; data: null; error: null }
  | { status: "ok"; data: T; error: ApiError | Error | null }
  | { status: "error"; data: null; error: ApiError | Error }
);
const initial = { status: "loading" as const, data: null, error: null, stale: false, lastSuccessAt: null };

/** Same-scope refresh retains data and reports its failure separately. Scope changes never reuse data. */
export function useFetch<T>(path: string | null): FetchState<T> & { reload: () => void; pending: boolean } {
  const [state, setState] = useState<FetchState<T>>(initial);
  const [tick, setTick] = useState(0);
  const [pending,setPending]=useState(false);
  const reload=useCallback(()=>setTick(t=>t+1),[]);
  const lastPath = useRef<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const owned = ++generation.current;
    const changed = lastPath.current !== path;
    lastPath.current = path;
    if (!path) { setState(initial); setPending(false); return; }
    const controller = new AbortController();
    setPending(true);
    if (changed) setState(initial);
    api.get<T>(path, controller.signal).then((data) => {
      if (!controller.signal.aborted && applyReadResult(owned,generation.current,true)) {
        setState({ status: "ok", data, error: null, stale: false, lastSuccessAt: new Date().toISOString() });
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted || !applyReadResult(owned,generation.current,true)) return;
      const failure = error instanceof Error ? error : new Error(String(error));
      // Session/permission loss must never keep private cached data visible. API decoding/redirect stays authoritative.
      setState(previous => previous.status === 'ok' && !(failure instanceof ApiError && [401,403].includes(failure.status))
        ? {...previous, stale: true, error: failure}
        : { status: "error", data: null, error: failure, stale: false, lastSuccessAt: null });
    }).finally(()=>{if(owned===generation.current)setPending(false);});
    return () => { ++generation.current; controller.abort(); };
  }, [path, tick]);
  // Avoid one render of a previous identity before effect cleanup runs.
  return { ...(lastPath.current === path ? state : initial), pending: lastPath.current === path && pending, reload };
}
