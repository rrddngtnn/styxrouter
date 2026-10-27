/**
 * Icon + live wordmark text. The wordmark is real text (themeable, translatable,
 * crisp at any DPI), so it follows the active light/dark palette instead of the
 * dark SVG lockup that disappeared on dark surfaces.
 */
export function BrandMark() {
  return (
    <div className="brand">
      <img
        className="brand-icon"
        src={`${import.meta.env.BASE_URL}brand/styx-icon.svg`}
        alt=""
        aria-hidden="true"
      />
      <span className="brand-wordmark">StyxRouter</span>
    </div>
  );
}

