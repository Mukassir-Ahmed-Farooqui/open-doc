import type { Citation } from "./api/schemas";
import { INSUFFICIENT_EVIDENCE } from "./config";

/** Matches a citation group like [S1], [S1, S3] or [S2;S4]. */
const GROUP_RE = /\[(S\d+(?:\s*[,;]\s*S\d+)*)\]/g;

export type Segment = { type: "text"; text: string } | { type: "cite"; ids: string[] };

/** Split answer text into plain text and citation-marker segments. */
export function parseCitationMarkers(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(GROUP_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", text: text.slice(last, idx) });
    out.push({ type: "cite", ids: m[1].split(/\s*[,;]\s*/) });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/** Unique marker ids in order of first appearance. */
export function citedIds(text: string): string[] {
  const seen = new Set<string>();
  for (const seg of parseCitationMarkers(text)) if (seg.type === "cite") seg.ids.forEach((id) => seen.add(id));
  return [...seen];
}

export const CITE_HREF_PREFIX = "#cite-";

/**
 * Rewrite [S#] markers into markdown links (`[S1](#cite-S1)`) so the markdown renderer can
 * turn them into interactive chips. Markers inside inline/fenced code are left alone.
 */
export function linkifyCitations(markdown: string): string {
  const parts = markdown.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(GROUP_RE, (_m, group: string) =>
            group
              .split(/\s*[,;]\s*/)
              .map((id) => `[${id}](${CITE_HREF_PREFIX}${id})`)
              .join(""),
          ),
    )
    .join("");
}

export function citationMap(citations: Citation[] | null | undefined): Map<string, Citation> {
  const map = new Map<string, Citation>();
  for (const c of citations ?? []) map.set(c.source_id, c);
  return map;
}

/** Order citations by first mention in the answer; uncited extras go last. */
export function orderedCitations(text: string, citations: Citation[] | null | undefined): Citation[] {
  const map = citationMap(citations);
  const ordered: Citation[] = [];
  for (const id of citedIds(text)) {
    const c = map.get(id);
    if (c) {
      ordered.push(c);
      map.delete(id);
    }
  }
  return [...ordered, ...map.values()];
}

export function isInsufficientEvidence(content: string, abstained?: boolean): boolean {
  if (abstained) return true;
  const norm = content.trim().replace(/\s+/g, " ");
  return norm.startsWith(INSUFFICIENT_EVIDENCE.slice(0, 60));
}

/** Link to the in-app viewer at the cited page, carrying the snippet for highlighting. */
export function viewerHref(c: Pick<Citation, "doc_id" | "page" | "snippet">): string {
  const params = new URLSearchParams({ page: String(Math.max(1, c.page)) });
  if (c.snippet) params.set("q", c.snippet.slice(0, 240));
  return `/documents/${encodeURIComponent(c.doc_id)}?${params.toString()}`;
}
