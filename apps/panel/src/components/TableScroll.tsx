import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePreferences } from "../lib/preferences.tsx";
import "./table-scroll.css";

const indonesianLabels: Record<string, string> = {
  "Activity table": "Tabel aktivitas",
  "Models table": "Tabel model",
  "Audit log table": "Tabel log audit",
  "API keys table": "Tabel kunci API",
  "Routing combos table": "Tabel kombo perutean",
  "Connected accounts": "Akun terhubung",
  "Database backups table": "Tabel cadangan basis data",
  "Configuration table": "Tabel konfigurasi",
  "Usage by provider table": "Tabel penggunaan per penyedia",
  "Usage by model table": "Tabel penggunaan per model",
  "Usage by account table": "Tabel penggunaan per akun",
  "Usage by API key table": "Tabel penggunaan per kunci API",
  "Errors by status table": "Tabel kesalahan per status",
  "Monthly report table": "Tabel laporan bulanan",
};

/** Keeps dense tables semantic while exposing the scroll viewport to keyboard users. */
export function TableScroll({ label, stickyPrimary = false, stickySelection = false, compact = false, children }: { label: string; stickyPrimary?: boolean; stickySelection?: boolean; compact?: boolean; children: ReactNode }) {
  const { language } = usePreferences();
  const region = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = region.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    check();
    return () => observer.disconnect();
  }, [children]);
  return <div className={`table-scroll-container${stickyPrimary ? " table-scroll-sticky" : ""}${stickySelection ? " table-scroll-selection" : ""}${compact ? " table-scroll-compact" : ""}`}>
    {overflow && <div className="table-scroll-hint" aria-hidden="true">{language === "id" ? "Geser tabel ke samping ↔" : "Scroll table horizontally ↔"}</div>}
    <div ref={region} className="table-scroll-region" role="region" aria-label={language === "id" ? indonesianLabels[label] ?? label : label} tabIndex={0}>{children}</div>
  </div>;
}
