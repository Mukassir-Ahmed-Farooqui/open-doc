import { describe, expect, it } from "vitest";
import { docKind, formatBytes, formatRelative } from "./format";
import { validateFile } from "./upload";

describe("format", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(182538)).toBe("178 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("formats relative time", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    expect(formatRelative("2026-11-03T11:59:50Z", now)).toBe("just now");
    expect(formatRelative("2026-11-03T10:00:00Z", now)).toBe("2 hours ago");
  });
  it("detects document kinds", () => {
    expect(docKind("a.PDF")).toBe("pdf");
    expect(docKind("a.docx")).toBe("docx");
    expect(docKind("notes.md")).toBe("md");
    expect(docKind("x", "text/plain")).toBe("txt");
  });
  it("validates upload files by extension and size", () => {
    expect(validateFile(new File(["x"], "a.pdf"))).toBeNull();
    expect(validateFile(new File(["x"], "a.exe"))).toMatch(/Unsupported/);
    expect(validateFile(new File([], "a.txt"))).toMatch(/empty/);
  });
});
