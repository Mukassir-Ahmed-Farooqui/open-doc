import { describe, expect, it } from "vitest";
import type { Citation } from "./api/schemas";
import {
  citedIds,
  isInsufficientEvidence,
  linkifyCitations,
  orderedCitations,
  parseCitationMarkers,
  viewerHref,
} from "./citations";
import { INSUFFICIENT_EVIDENCE } from "./config";

const cite = (id: string, page = 1): Citation => ({
  source_id: id,
  doc_id: "d1",
  document: "contract.pdf",
  page,
  section: "3. Termination",
  snippet: "Either party may terminate",
});

describe("parseCitationMarkers", () => {
  it("splits text and single markers", () => {
    expect(parseCitationMarkers("Ninety days [S1].")).toEqual([
      { type: "text", text: "Ninety days " },
      { type: "cite", ids: ["S1"] },
      { type: "text", text: "." },
    ]);
  });
  it("handles grouped markers with commas or semicolons", () => {
    expect(parseCitationMarkers("A [S1, S3] B [S2;S4]").filter((s) => s.type === "cite")).toEqual([
      { type: "cite", ids: ["S1", "S3"] },
      { type: "cite", ids: ["S2", "S4"] },
    ]);
  });
  it("ignores non-source brackets", () => {
    expect(parseCitationMarkers("see [note] and [1]")).toEqual([{ type: "text", text: "see [note] and [1]" }]);
  });
});

describe("citedIds / orderedCitations", () => {
  it("returns unique ids in first-mention order", () => {
    expect(citedIds("x [S2] y [S1][S2] z [S3, S1]")).toEqual(["S2", "S1", "S3"]);
  });
  it("orders citations by mention and appends unmentioned ones", () => {
    const out = orderedCitations("b [S2] a [S1]", [cite("S1"), cite("S3"), cite("S2")]);
    expect(out.map((c) => c.source_id)).toEqual(["S2", "S1", "S3"]);
  });
  it("tolerates null citations", () => {
    expect(orderedCitations("[S1]", null)).toEqual([]);
  });
});

describe("linkifyCitations", () => {
  it("turns markers into cite links, expanding groups", () => {
    expect(linkifyCitations("Yes [S1, S2].")).toBe("Yes [S1](#cite-S1)[S2](#cite-S2).");
  });
  it("leaves code spans and fences untouched", () => {
    const md = "Use `[S1]` literally\n```\n[S2]\n```\nbut cite [S3]";
    expect(linkifyCitations(md)).toBe("Use `[S1]` literally\n```\n[S2]\n```\nbut cite [S3](#cite-S3)");
  });
});

describe("isInsufficientEvidence", () => {
  it("detects the backend's abstention sentence", () => {
    expect(isInsufficientEvidence(INSUFFICIENT_EVIDENCE)).toBe(true);
    expect(isInsufficientEvidence(`  ${INSUFFICIENT_EVIDENCE}\n`)).toBe(true);
  });
  it("honours the abstained flag", () => {
    expect(isInsufficientEvidence("anything", true)).toBe(true);
  });
  it("does not flag normal answers", () => {
    expect(isInsufficientEvidence("Either party may terminate on 90 days' notice [S1].")).toBe(false);
  });
});

describe("viewerHref", () => {
  it("links to the cited page with the snippet as highlight query", () => {
    const href = viewerHref(cite("S1", 4));
    expect(href.startsWith("/documents/d1?")).toBe(true);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("page")).toBe("4");
    expect(params.get("q")).toBe("Either party may terminate");
  });
  it("clamps page to at least 1", () => {
    expect(viewerHref({ doc_id: "d", page: 0, snippet: "" })).toBe("/documents/d?page=1");
  });
});

describe("fullwidth citation markers", () => {
  it("parses 【S1】 and 【S1, S2】 like [S1]", () => {
    expect(citedIds("A 【S1】 and B 【S2, S3】.")).toEqual(["S1", "S2", "S3"]);
    expect(linkifyCitations("x 【S1】")).toBe("x [S1](#cite-S1)");
  });
});
