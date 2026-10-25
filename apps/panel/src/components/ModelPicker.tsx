import { useId, type KeyboardEventHandler } from "react";
import { useFetch } from "../lib/useFetch.ts";
import "./catalog-controls.css";

export interface CatalogOption { id: string; owned_by?: string }

/** Native datalist keeps keyboard/screen-reader behavior and never restricts manual IDs. */
export function ModelPicker({ label, value, onChange, onKeyDown, catalog, disabled = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  catalog?: CatalogOption[];
  disabled?: boolean;
}) {
  const id = useId();
  const state = useFetch<{ data?: CatalogOption[] }>(catalog ? null : "/v1/models?configuredOnly=true&prefix=canonical");
  const options = catalog ?? (state.status === "ok" ? state.data.data ?? [] : []);
  const hint = !catalog && state.status === "loading" ? "Loading catalog. Manual model IDs are available."
    : !catalog && state.status === "error" ? "Catalog unavailable. Enter a model ID manually."
    : options.length === 0 ? "No configured models. Enter a model ID manually."
    : "Choose a catalog model or enter an ID manually.";
  return <div className="panel-model-picker">
    <label htmlFor={id}>{label}</label>
    <input id={id} type="text" list={`${id}-options`} aria-describedby={`${id}-hint`}
      placeholder="provider/model-id" autoComplete="off" value={value} disabled={disabled}
      onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} />
    <datalist id={`${id}-options`}>
      {options.map((model) => <option key={model.id} value={model.id}>{model.owned_by ?? model.id}</option>)}
    </datalist>
    <small className="muted" id={`${id}-hint`} role="status">{hint}</small>
  </div>;
}
