/* The supplied lockup is decorative; the container supplies its accessible name. */
export function BrandMark() {
  return (
    <div className="brand" role="img" aria-label="StyxRouter">
      <img className="brand-lockup brand-lockup-light" src={`${import.meta.env.BASE_URL}brand/styx-lockup.svg`} alt="" />
      <img className="brand-lockup brand-lockup-dark" src={`${import.meta.env.BASE_URL}brand/styx-lockup-dark.svg`} alt="" />
    </div>
  );
}
