import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Citation } from "@/lib/api/schemas";
import { Markdown } from "./Markdown";

const c1: Citation = { source_id: "S1", doc_id: "d", document: "contract.pdf", page: 2, section: "3", snippet: "Either party" };

describe("Markdown with citations", () => {
  it("renders [S#] markers as clickable chips that report their source id", () => {
    const onCite = vi.fn();
    render(<Markdown content={"**Ninety** days [S1]."} citations={new Map([["S1", c1]])} onCite={onCite} />);
    expect(screen.getByText("Ninety").tagName).toBe("STRONG");
    const chip = screen.getByRole("button", { name: /Source 1: contract.pdf, page 2/ });
    fireEvent.click(chip);
    expect(onCite).toHaveBeenCalledWith("S1");
  });

  it("renders markers without metadata as inert labels (while streaming)", () => {
    render(<Markdown content={"Partial [S2]"} citations={new Map()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByLabelText("Source 2")).toBeInTheDocument();
  });

  it("leaves markers as text when citations are not enabled", () => {
    render(<Markdown content={"Literal [S1]"} />);
    expect(screen.getByText("Literal [S1]")).toBeInTheDocument();
  });

  it("opens external links in a new tab safely", () => {
    render(<Markdown content={"[docs](https://example.com)"} citations={new Map()} />);
    const a = screen.getByRole("link", { name: "docs" });
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
  });
});
