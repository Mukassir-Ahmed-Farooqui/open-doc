import { describe, expect, it } from "vitest";
import { findSnippet, itemInSnippet, normalizeText } from "./highlight";

describe("highlight helpers", () => {
  it("normalizes punctuation, quotes and whitespace", () => {
    expect(normalizeText("Either  party’s\nright—to terminate.")).toBe("either party s right to terminate");
  });
  it("matches PDF text items contained in the snippet", () => {
    const n = normalizeText("Either party may terminate this Agreement on ninety days notice.");
    expect(itemInSnippet("may terminate this", n)).toBe(true);
    expect(itemInSnippet("governing law", n)).toBe(false);
    expect(itemInSnippet("on", n)).toBe(false); // too short to be meaningful
  });
  it("finds a snippet in text despite re-flowed whitespace", () => {
    const text = "Intro.\n\nEither party may\nterminate on 90 days' notice.";
    const r = findSnippet(text, "Either party may terminate on 90 days' notice.");
    expect(r).not.toBeNull();
    expect(text.slice(r![0], r![1])).toContain("terminate");
  });
  it("returns null when nothing matches", () => {
    expect(findSnippet("abc", "zzz")).toBeNull();
  });
});
