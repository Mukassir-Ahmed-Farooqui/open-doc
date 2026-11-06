import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SLOW_MS, wakeStore } from "@/lib/api/wake";
import { WakeBanner } from "./WakeBanner";

describe("WakeBanner", () => {
  afterEach(() => {
    vi.useRealTimers();
    act(() => wakeStore.reset());
  });

  it("stays hidden while requests are fast", () => {
    render(<WakeBanner />);
    act(() => wakeStore.track().done(true));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the waking state for a slow request and hides once the server answers", () => {
    vi.useFakeTimers();
    render(<WakeBanner />);
    const req = wakeStore.track();
    act(() => vi.advanceTimersByTime(SLOW_MS + 10));
    expect(screen.getByRole("status")).toHaveTextContent("Waking up the server… (free tier, ~1 min)");
    act(() => req.done(true));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows while a retry is pending", () => {
    render(<WakeBanner />);
    act(() => wakeStore.retrying());
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
