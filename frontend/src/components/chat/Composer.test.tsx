import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer, type ComposerProps } from "./Composer";

function setup(props: Partial<ComposerProps> = {}) {
  const onSend = vi.fn();
  const onStop = vi.fn();
  render(
    <Composer onSend={onSend} onStop={onStop} streaming={false} style="executive" onStyleChange={vi.fn()} scope={null} {...props} />,
  );
  return { onSend, onStop, input: screen.getByLabelText(/Ask a question/) };
}

describe("Composer", () => {
  it("sends trimmed text on Enter and clears the input", async () => {
    const { onSend, input } = setup();
    await userEvent.type(input, "  What is the notice period?  {Enter}");
    expect(onSend).toHaveBeenCalledWith("What is the notice period?");
    expect(input).toHaveValue("");
  });

  it("inserts a newline with Shift+Enter instead of sending", async () => {
    const { onSend, input } = setup();
    await userEvent.type(input, "line1{Shift>}{Enter}{/Shift}line2");
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("line1\nline2");
  });

  it("disables sending with a reason", () => {
    const { input } = setup({ disabledReason: "Select at least one ready document to ask a question" });
    expect(input).toHaveAttribute("placeholder", "Select at least one ready document to ask a question");
    fireEvent.change(input, { target: { value: "hi" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("shows a stop button while streaming", () => {
    const { onStop } = setup({ streaming: true });
    fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(onStop).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("is the primary input for the ⌘/ shortcut", () => {
    const { input } = setup();
    expect(input).toHaveAttribute("data-primary-input");
  });
});
