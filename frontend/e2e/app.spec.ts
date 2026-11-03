import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(here, "fixtures", name);
const docList = (p: Page) => p.getByRole("list", { name: "Documents" });
const email = `e2e-${Date.now()}@example.com`;
const password = "e2e-password-123";

test.describe.configure({ mode: "serial" });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});
test.afterAll(async () => {
  await page.close();
});

test("redirects to login when signed out", async () => {
  await page.goto("/documents");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("registers a new account and lands on the dashboard", async () => {
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Full name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: /, Ada$/ })).toBeVisible();
  await expect(page.getByText("No documents yet")).toBeVisible();
});

test("rejects a duplicate registration with the API's message", async ({ browser }) => {
  const p = await browser.newPage();
  await p.goto("/register");
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill(password);
  await p.getByRole("button", { name: "Create account" }).click();
  await expect(p.getByRole("alert")).toContainText("Email already registered");
  await p.close();
});

test("uploads several files and shows live ingestion until ready", async () => {
  await page.getByRole("link", { name: "Library" }).first().click();
  await expect(page.getByText("Your library is empty")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles([fixture("services-agreement.pdf"), fixture("handbook.md")]);
  const uploads = page.getByRole("region", { name: "Uploads" });
  await expect(uploads.getByText("services-agreement.pdf")).toBeVisible();
  await expect(docList(page).getByText("Ready")).toHaveCount(2, { timeout: 120_000 });
});

test("rejects unsupported file types client-side", async () => {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles({ name: "malware.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await expect(page.getByText(/Unsupported file type \(\.exe\)/)).toBeVisible();
});

test("filters and searches the library", async () => {
  await page.getByRole("searchbox", { name: "Search documents" }).fill("handbook");
  await expect(docList(page).getByRole("link", { name: "handbook.md" })).toBeVisible();
  await expect(docList(page).getByRole("link", { name: "services-agreement.pdf" })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search documents" }).fill("");
  await page.getByRole("tab", { name: /Failed/ }).click();
  await expect(page.getByText("No matching documents")).toBeVisible();
  await page.getByRole("tab", { name: /All/ }).click();
});

test("renders the PDF with pdf.js and jumps to a page", async () => {
  await docList(page).getByRole("link", { name: "services-agreement.pdf" }).click();
  await expect(page.locator(".react-pdf__Page canvas")).toBeVisible();
  await expect(page.getByText("/ 3")).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator(".react-pdf__Page__textContent")).toContainText("TERMINATION");
  // Citation-style deep link: page + snippet highlight.
  const url = new URL(page.url());
  await page.goto(`${url.pathname}?page=3&q=${encodeURIComponent("The Customer shall pay the monthly service fee")}`);
  await expect(page.locator(".react-pdf__Page__textContent")).toContainText("FEES AND PAYMENT");
  await expect(page.locator("mark.pdf-hl").first()).toBeVisible();
  await expect(page.getByText("Cited passage · page 3")).toBeVisible();
});

test("shows text documents with the cited snippet highlighted", async () => {
  await page.goto("/documents");
  await docList(page).getByRole("link", { name: "handbook.md" }).click();
  await expect(page.getByRole("heading", { name: "Employee Handbook" })).toBeVisible();
  const url = new URL(page.url());
  await page.goto(`${url.pathname}?page=1&q=${encodeURIComponent("work remotely up to three days")}`);
  await expect(page.locator("article mark")).toContainText("work remotely up to three days");
});

test("asks an out-of-scope question and gets an explicit insufficient-evidence answer (streamed)", async () => {
  await page.goto("/chat");
  await expect(page.getByRole("button", { name: /Documents in scope: All documents \(2\)/ })).toBeVisible();
  const composer = page.getByLabel("Ask a question about your documents");
  await composer.fill("Which volcano erupted in Iceland in 2010?");
  await composer.press("Enter");
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Not enough evidence")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Which volcano erupted in Iceland in 2010?")).toBeVisible();
  // Persisted: reload shows the same turn from GET /chats/{id}.
  await page.reload();
  await expect(page.getByText("Not enough evidence")).toBeVisible();
});

test("narrows the document scope of a chat", async () => {
  await page.getByRole("button", { name: /Documents in scope/ }).click();
  await page.getByRole("menuitemcheckbox", { name: /handbook\.md/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Documents in scope: services-agreement\.pdf/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /Documents in scope: services-agreement\.pdf/ })).toBeVisible();
});

test("renames and deletes a conversation from the history sidebar", async () => {
  const history = page.getByRole("navigation", { name: "Conversation history" });
  const item = history.getByRole("link").first();
  await item.hover();
  await history.getByRole("button", { name: /^Options for / }).first().click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const input = page.getByLabel("Conversation title");
  await input.fill("Volcano check");
  await input.press("Enter");
  await expect(history.getByRole("link", { name: "Volcano check" })).toBeVisible();
  await page.getByPlaceholder("Search conversations").fill("volcano");
  await expect(history.getByRole("link", { name: "Volcano check" })).toBeVisible();
  await page.getByPlaceholder("Search conversations").fill("");
  await history.getByRole("link", { name: "Volcano check" }).hover();
  await history.getByRole("button", { name: "Options for Volcano check" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(history.getByRole("link", { name: "Volcano check" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/chat$/);
});

test("opens the command palette with the keyboard and navigates", async () => {
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("settings");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("pgvector")).toBeVisible();
});

test("updates the profile name", async () => {
  await page.getByLabel("Full name").fill("Ada King");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile updated")).toBeVisible();
});

test("treats another user's document as not found (API answers 404)", async ({ playwright }) => {
  const api = process.env.E2E_API_URL ?? "http://127.0.0.1:8011";
  const ctx = await playwright.request.newContext({ baseURL: `${api}/api/v1/` });
  const other = `e2e-other-${Date.now()}@example.com`;
  expect((await ctx.post("auth/register", { data: { email: other, password } })).status()).toBe(201);
  const { access_token } = await (await ctx.post("auth/login", { data: { email: other, password } })).json();
  const up = await ctx.post("upload", {
    headers: { Authorization: `Bearer ${access_token}` },
    multipart: { file: { name: "private.txt", mimeType: "text/plain", buffer: Buffer.from("Private notes of another user.") } },
  });
  expect(up.status()).toBe(202);
  const { doc_id } = await up.json();
  await ctx.dispose();
  await page.goto(`/documents/${doc_id}`);
  await expect(page.getByRole("heading", { name: "Document not found" })).toBeVisible();
});

test("deletes a document after confirmation", async () => {
  await page.goto("/documents");
  await page.getByRole("button", { name: "Actions for handbook.md" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("dialog")).toContainText("permanently removed");
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(docList(page).getByRole("link", { name: "handbook.md" })).toHaveCount(0);
});

test("signs out", async () => {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("sign out");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
});
