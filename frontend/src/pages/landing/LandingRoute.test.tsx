import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { App } from "@/App";
import { renderWithProviders } from "@/test/utils";

describe("root route", () => {
  beforeEach(() => localStorage.clear());

  it("shows the landing page to signed-out visitors at /", async () => {
    renderWithProviders(<App />, { route: "/" });
    expect(await screen.findByRole("heading", { level: 1, name: /ask your documents/i })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /sign in/i })[0]).toHaveAttribute("href", "/login");
    expect(screen.getAllByRole("link", { name: /start for free|get started|create free account/i })[0]).toHaveAttribute("href", "/register");
  });

  it("still redirects other protected routes to /login", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/*" element={<App />} />
      </Routes>,
      { route: "/documents" },
    );
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });
});
