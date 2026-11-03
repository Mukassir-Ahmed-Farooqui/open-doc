/** Normalise text for fuzzy snippet matching: lower-case, collapse whitespace, drop punctuation. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Should a PDF text-layer item be highlighted for this cited snippet? True when the item's
 * normalised text (at least 4 chars) appears inside the snippet (snippet spans many items),
 * or a short snippet (at least 12 chars) appears inside one long item (a whole line).
 */
export function itemInSnippet(itemText: string, normalizedSnippet: string): boolean {
  const t = normalizeText(itemText);
  if (t.length < 4 || !normalizedSnippet) return false;
  if (normalizedSnippet.includes(t)) return true;
  return normalizedSnippet.length >= 12 && t.includes(normalizedSnippet);
}

/**
 * Locate a snippet in a plain-text document. Tries the whole snippet, then progressively
 * shorter leading slices so partially re-flowed text still matches. Returns [start, end) or null.
 */
export function findSnippet(text: string, snippet: string): [number, number] | null {
  const clean = snippet.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const lower = text.toLowerCase();
  for (const len of [clean.length, 160, 80, 40]) {
    if (len > clean.length) continue;
    const probe = clean.slice(0, len).toLowerCase();
    // whitespace-tolerant search
    const pattern = probe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    const m = new RegExp(pattern).exec(lower);
    if (m) return [m.index, m.index + m[0].length];
  }
  return null;
}
