// Unicode combining diacritical marks (U+0300–U+036F), written as escapes so
// the source file stays ASCII-safe across editors and encodings.
const COMBINING_MARKS = /[\u0300-\u036f]/g
const D_STROKE = /[đĐ]/g

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    // strip accents so "Ca phe sua da" survives as readable ASCII
    .replace(COMBINING_MARKS, "")
    // Vietnamese d-with-stroke has no decomposition, map it explicitly
    .replace(D_STROKE, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

/**
 * Appends `-2`, `-3`, … until the slug is free.
 * `isTaken` should scope its lookup to the owning store.
 */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>
): Promise<string> {
  const root = slugify(base) || "item"
  let candidate = root
  let n = 2
  while (await isTaken(candidate)) {
    candidate = `${root}-${n++}`
    if (n > 200) return `${root}-${Date.now().toString(36)}`
  }
  return candidate
}
