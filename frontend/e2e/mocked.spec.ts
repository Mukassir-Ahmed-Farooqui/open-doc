import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Plain ESM helper shared with scripts/redesign-*.mjs
import { createMockApi, serveDist } from "./mock/mock-api.mjs";

/**
 * UI flows against the in-memory mock API (no backend). Serves a production build from memory:
 *   VITE_API_URL= npx vite build --outDir /tmp/od-dist
 *   MOCK_DIST=/tmp/od-dist CHROMIUM_PATH=/path/to/chromium npx playwright test e2e/mocked.spec.ts
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = process.env.MOCK_DIST ?? path.resolve(here, "../dist");
const ORIGIN = "http://opendoc.test";
const fixture = (name: string) => path.join(here, "fixtures", name);
const docList = (p: Page) => p.getByRole("list", { name: "Documents" });

async function setup(ctx: BrowserContext, opts: Record<string, unknown> = {}) {
  const mock = createMockApi({ ingestMs: 2500, streamDelayMs: 1200, ...opts });
  await serveDist(ctx, ORIGIN, DIST);
  await mock.install(ctx, ORIGIN);
  return mock;
}

test.describe.configure({ mode: "serial" });

let ctx: BrowserContext;
let page: Page;
test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setup(ctx);
  page = await ctx.newPage();
});
test.afterAll(async () => ctx.close());

const email = `qa-${Date.now()}@example.com`;
const password = "qa-password-123";

test("signed-out visitors get the landing page; protected routes go to login", async () => {
  await page.goto(`${ORIGIN}/`);
  await expect(page.getByRole("heading", { level: 1, name: /Ask your documents/ })).toBeVisible();
  await expect(page.getByText("LLM-judged by the same model")).toBeVisible();
  await page.goto(`${ORIGIN}/documents`);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("registers, lands on the first-run dashboard, signs out and back in", async () => {
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Full name").fill("Grace Hopper");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: /, Grace$/ })).toBeVisible();
  await expect(page.getByText("No documents yet")).toBeVisible();

  await page.getByRole("button", { name: /Grace Hopper/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.goto(`${ORIGIN}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /, Grace$/ })).toBeVisible();
});

test("uploads files and shows byte progress, then indexing → ready", async () => {
  await page.getByRole("link", { name: "Library" }).first().click();
  await expect(page.getByText("Your library is empty")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles([fixture("services-agreement.pdf"), fixture("handbook.md")]);
  const uploads = page.getByRole("region", { name: "Uploads" });
  await expect(uploads.getByText("services-agreement.pdf")).toBeVisible();
  await expect(docList(page).getByText(/Queued|Indexing/).first()).toBeVisible();
  await expect(docList(page).getByText("Ready")).toHaveCount(2, { timeout: 15_000 });
});

test("rejects unsupported file types client-side", async () => {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles({ name: "malware.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await expect(page.getByText(/Unsupported file type \(\.exe\)/)).toBeVisible();
});

test("asks a question, streams the answer as a research note with citations", async () => {
  await page.goto(`${ORIGIN}/chat`);
  await expect(page.getByRole("heading", { name: "What do you want to find out?" })).toBeVisible();
  const composer = page.getByLabel("Ask a question about your documents");
  await composer.fill("How much notice is needed to terminate for convenience?");
  await composer.press("Enter");
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/Searching (2 documents|your documents)…/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "How much notice is needed to terminate for convenience?" })).toBeVisible();
  const chip = page.getByRole("button", { name: /^Source 1: services-agreement\.pdf, page 2/ }).first();
  await expect(chip).toBeVisible({ timeout: 10_000 });
  // Sources rail is visible at 1440 px for the latest cited answer.
  await expect(page.getByRole("complementary", { name: "Sources" })).toBeVisible();
});

test("citation chip → sources rail → opens the viewer at the cited page with the passage marked", async () => {
  await page.getByRole("button", { name: /^Source 1: services-agreement\.pdf, page 2/ }).first().click();
  const rail = page.getByRole("complementary", { name: "Sources" });
  await rail.getByRole("link", { name: "Open page 2 in viewer" }).click();
  await expect(page).toHaveURL(/\/documents\/[^?]+\?page=2&q=/);
  await expect(page.getByText("Cited passage · page 2")).toBeVisible();
  await expect(page.locator(".react-pdf__Page canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("mark.pdf-hl").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/page=3/);
});

test("an out-of-scope question gets the explicit 'Not enough evidence' state", async () => {
  await page.goto(`${ORIGIN}/chat`);
  const composer = page.getByLabel("Ask a question about your documents");
  await composer.fill("Which volcano erupted in Iceland in 2010?");
  await composer.press("Enter");
  await expect(page.getByText("Not enough evidence")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByText("Not enough evidence")).toBeVisible();
});

test("deletes a document after confirmation", async () => {
  await page.goto(`${ORIGIN}/documents`);
  await page.getByRole("button", { name: "Actions for handbook.md" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("dialog")).toContainText("permanently removed");
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(docList(page).getByRole("link", { name: "handbook.md" })).toHaveCount(0);
});

test("signs out from the command palette", async () => {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("sign out");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
});

test("cold start: shows 'Waking up the server…' and recovers on its own", async ({ browser }) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await setup(c, { seed: "full", failFirst: 3 });
  await c.addInitScript(() =>
    localStorage.setItem("opendoc.session", JSON.stringify({ token: "mock-token", expiresAt: Date.now() + 86400000 })),
  );
  const p = await c.newPage();
  await p.goto(`${ORIGIN}/documents`);
  await expect(p.getByRole("status").filter({ hasText: "Waking up the server… (free tier, ~1 min)" })).toBeVisible({ timeout: 10_000 });
  await expect(docList(p).getByText("services-agreement.pdf")).toBeVisible({ timeout: 30_000 });
  await expect(p.getByText("Waking up the server")).toHaveCount(0);
  await expect(p.getByText(/Could not reach/)).toHaveCount(0);
  await c.close();
});

test("mobile: bottom nav, sources open as a sheet", async ({ browser }) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mock = await setup(c, { seed: "full" });
  await c.addInitScript(() =>
    localStorage.setItem("opendoc.session", JSON.stringify({ token: "mock-token", expiresAt: Date.now() + 86400000 })),
  );
  const p = await c.newPage();
  await p.goto(`${ORIGIN}/`);
  const nav = p.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Library" }).click();
  await expect(p.getByRole("heading", { name: "Library" })).toBeVisible();
  await p.goto(`${ORIGIN}/chat/${mock.state.ids.chat}`);
  await expect(nav).toHaveCount(0);
  await p.getByRole("button", { name: /^Source 1: services-agreement\.pdf, page 2/ }).first().tap();
  await expect(p.getByRole("dialog", { name: "Sources" })).toBeVisible();
  await c.close();
});
