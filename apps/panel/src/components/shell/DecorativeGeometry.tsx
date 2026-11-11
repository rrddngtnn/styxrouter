import "../../styles/background-geometry.css";

/** Original ribbon lattice: fills only unused navigation space, never an overlay. */
export function DecorativeGeometry() {
  return <div className="geometry-quiet-space" aria-hidden="true" inert><span className="geometry-ribbon" /></div>;
}
