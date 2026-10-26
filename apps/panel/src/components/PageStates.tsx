import { useTranslator } from "../lib/useTranslator.ts";
import type { ReactNode } from "react";
import "./catalog-controls.css";

export function LoadingState({ label = "Loading", rows = 3 }: { label?: string; rows?: number }) {
  const tr = useTranslator();
  return <div className="panel-loading-state" role="status" aria-busy="true">
    <span className="muted">{tr(label)}…</span>
    <div aria-hidden="true" className="panel-skeleton-rows">
      {Array.from({ length: rows }, (_, i) => <div className="panel-skeleton-row" key={i} />)}
    </div>
  </div>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  const tr = useTranslator();
  return <div className="panel-empty-state">
    <p className="panel-empty-title">{tr(title)}</p>
    {description && <p className="muted">{tr(description)}</p>}
    {action && <div className="row-actions">{action}</div>}
  </div>;
}
