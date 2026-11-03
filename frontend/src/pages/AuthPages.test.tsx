import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { LoginPage, RegisterPage } from "./AuthPages";

afterEach(() => vi.unstubAllGlobals());

describe("LoginPage", () => {
  it("validates the email before calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<LoginPage />, { route: "/login" });
    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toHaveTextContent("valid email");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the API's error message on bad credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: "unauthorized", message: "Invalid credentials" } }), { status: 401 })),
    );
    renderWithProviders(<LoginPage />, { route: "/login" });
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "wrongpass");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid credentials"));
  });

  it("stores the session on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ access_token: "jwt", token_type: "bearer", expires_in: 3600 }), { status: 200 })),
    );
    renderWithProviders(<LoginPage />, { route: "/login" });
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "rightpass");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("opendoc.session")!).token).toBe("jwt"));
  });
});

describe("RegisterPage", () => {
  it("enforces the 8-byte minimum password", async () => {
    renderWithProviders(<RegisterPage />, { route: "/register" });
    await userEvent.type(screen.getByLabelText("Password"), "short");
    expect(screen.getByText("At least 8 characters.")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
  });
});
