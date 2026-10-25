/** Append an exact model ID; fallback chains may deliberately repeat a target. */
export function appendModelLine(current: string, model: string, unique = false): string {
  const id = model.trim();
  if (!id) return current;
  const lines = [...current.split("\n").map((line) => line.trim()).filter(Boolean), id];
  return (unique ? [...new Set(lines)] : lines).join("\n");
}
