import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenStore } from "@/auth/tokenStore";
import { renderWithProviders } from "@/test/utils";
import { DeleteAccountForm } from "./SettingsPage";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderForm() {
  return renderWithProviders(
    <Routes>
      <Route path="/settings" element={<DeleteAccountForm />} />
      <Route path="/" element={<p>Home page</p>} />
    </Routes>,
    { route: "/settings" },
  );
}

beforeEach(() => tokenStore.set("jwt", 3600));
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("DeleteAccountForm", () => {
  it("shows a wrong password inline and keeps the session", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? json({ error: { code: "forbidden", message: "Incorrect password" } }, 403) : json({}),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    await userEvent.type(screen.getByLabelText("Confirm with your password"), "wrongpass");
    await userEvent.click(screen.getByRole("button", { name: /Delete account/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Incorrect password"));
    expect(tokenStore.get()).toBe("jwt");
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE")! as unknown as [string, RequestInit];
    expect(call[0]).toMatch(/\/auth\/me$/);
    expect(JSON.parse(call[1].body as string)).toEqual({ password: "wrongpass" });
  });

  it("clears the token and redirects to / on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ status: "deleted" })));
    renderForm();
    await userEvent.type(screen.getByLabelText("Confirm with your password"), "rightpass");
    await userEvent.click(screen.getByRole("button", { name: /Delete account/ }));
    await waitFor(() => expect(screen.getByText("Home page")).toBeInTheDocument());
    expect(tokenStore.get()).toBeNull();
  });
});
