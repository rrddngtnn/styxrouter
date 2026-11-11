import "./ribbon-motif.css";
/** Original rounded interweave. Decorative only; never use as a brand mark. */
export function RibbonMotif({ className = "" }: { className?: string }) {
  return <svg className={`styx-ribbon-motif ${className}`} viewBox="0 0 320 200" fill="none" aria-hidden="true" focusable="false">
    <path className="ribbon-base" d="M-16 64H68Q100 64 100 96V128Q100 160 132 160H188Q220 160 220 128V72Q220 40 252 40H336" />
    <path className="ribbon-cross" d="M-16 136H28Q60 136 60 104V72Q60 40 92 40H148Q180 40 180 72V128Q180 160 212 160H336" />
    <path className="ribbon-over" d="M100 96V128Q100 160 132 160H148" />
  </svg>;
}
