import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/api/schemas";
import { INSUFFICIENT_EVIDENCE } from "@/lib/config";
import { AssistantMessage } from "./Messages";
import { SourcePanel } from "./SourcePanel";

const base: Message = {
  id: "m1",
  role: "assistant",
  content: "Either party may terminate on 90 days' notice [S1]. Fees are due monthly [S2].",
  citations: [
    { source_id: "S1", doc_id: "d1", document: "contract.pdf", page: 2, section: "3. Termination", snippet: "Either party may terminate" },
    { source_id: "S2", doc_id: "d1", document: "contract.pdf", page: 5, section: "5. Fees", snippet: "Fees are payable monthly" },
  ],
  latency_ms: 1830,
  timestamp: "2026-11-01T10:00:00Z",
  model: "llama-3.3-70b-versatile",
};

describe("AssistantMessage", () => {
  it("shows inline chips and a source strip that select a citation", () => {
    const onCite = vi.fn();
    render(<AssistantMessage message={base} activeSource={null} onCite={onCite} isLast />);
    fireEvent.click(screen.getByRole("button", { name: /Source 2: contract.pdf, page 5/ }));
    expect(onCite).toHaveBeenCalledWith("m1", "S2");
    expect(screen.getByLabelText("Sources").querySelectorAll("button")).toHaveLength(2);
    expect(screen.getByText(/1.8s/)).toBeInTheDocument();
  });

  it("renders an explicit insufficient-evidence state", () => {
    render(
      <MemoryRouter>
        <AssistantMessage message={{ ...base, content: INSUFFICIENT_EVIDENCE, citations: [] }} activeSource={null} onCite={vi.fn()} isLast />
      </MemoryRouter>,
    );
    expect(screen.getByText("Not enough evidence")).toBeInTheDocument();
    expect(screen.queryByLabelText("Sources")).toBeNull();
  });

  it("offers regenerate when provided", () => {
    const onRegenerate = vi.fn();
    render(<AssistantMessage message={base} activeSource={null} onCite={vi.fn()} onRegenerate={onRegenerate} isLast />);
    fireEvent.click(screen.getByRole("button", { name: "Regenerate answer" }));
    expect(onRegenerate).toHaveBeenCalled();
  });
});

describe("SourcePanel", () => {
  it("shows snippet, page and a viewer link that jumps to the cited page", () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <MemoryRouter>
        <SourcePanel citations={base.citations!} active="S2" onSelect={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Fees are payable monthly")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Open page 5 in viewer/ });
    expect(link.getAttribute("href")).toMatch(/^\/documents\/d1\?page=5&q=Fees/);
  });
});
