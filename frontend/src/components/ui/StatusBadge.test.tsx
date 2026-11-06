import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar, StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it.each([
    ["ready", "Ready"],
    ["queued", "Queued"],
    ["failed", "Failed"],
  ] as const)("labels %s", (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows ingestion progress while processing", () => {
    render(<StatusBadge status="processing" progress={42.4} />);
    expect(screen.getByText("Indexing")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("exposes an accessible progressbar clamped to 0–100", () => {
    render(<ProgressBar value={140} label="Ingestion" />);
    expect(screen.getByRole("progressbar", { name: "Ingestion" })).toHaveAttribute("aria-valuenow", "100");
  });
});
