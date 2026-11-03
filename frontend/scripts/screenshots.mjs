// Capture screenshots of key screens from a REAL running stack (no mocked data).
//   E2E_BASE_URL=http://127.0.0.1:4173 E2E_API_URL=http://127.0.0.1:8011 CHROMIUM_PATH=/usr/bin/chromium npm run screenshots
import { chromium, request } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../../docs/screenshots");
const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const apiOrigin = process.env.E2E_API_URL ?? "http://127.0.0.1:8011";
const email = `demo-${Date.now()}@example.com`;
const password = "demo-password-123";

await mkdir(out, { recursive: true });

// Seed through the public API: account + two documents, wait for ingestion.
const api = await request.newContext({ baseURL: `${apiOrigin}/api/v1/` });
await api.post("auth/register", { data: { email, password, full_name: "Ada Lovelace" } });
const { access_token, expires_in } = await (await api.post("auth/login", { data: { email, password } })).json();
const auth = { Authorization: `Bearer ${access_token}` };
for (const [name, mime] of [["services-agreement.pdf", "application/pdf"], ["handbook.md", "text/markdown"]]) {
  const buffer = await readFile(path.resolve(here, "../e2e/fixtures", name));
  const res = await api.post("upload", { headers: auth, multipart: { file: { name, mimeType: mime, buffer } } });
  if (res.status() !== 202 && res.status() !== 200) throw new Error(`upload ${name}: ${res.status()}`);
}
for (let i = 0; i < 60; i++) {
  const docs = await (await api.get("documents", { headers: auth })).json();
  if (docs.every((d) => d.status === "ready" || d.status === "failed")) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const docs = await (await api.get("documents", { headers: auth })).json();
const pdf = docs.find((d) => d.filename.endsWith(".pdf"));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const session = JSON.stringify({ token: access_token, expiresAt: Date.now() + expires_in * 1000 });

async function newPage(theme, viewport = { width: 1440, height: 900 }, signedIn = true) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: theme });
  await ctx.addInitScript(
    ([s, t, si]) => {
      localStorage.setItem("opendoc.theme", t);
      if (si) localStorage.setItem("opendoc.session", s);
    },
    [session, theme, signedIn],
  );
  return ctx.newPage();
}
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });

{
  const p = await newPage("light", { width: 1440, height: 900 }, false);
  await p.goto(`${base}/login`);
  await p.getByRole("heading", { name: "Welcome back" }).waitFor();
  await shot(p, "01-login-light");
  await p.context().close();
}
for (const theme of ["light", "dark"]) {
  const p = await newPage(theme);
  await p.goto(`${base}/`);
  await p.getByRole("heading", { name: /Ada/ }).waitFor();
  await p.getByText("Recent documents").waitFor();
  await p.waitForTimeout(400);
  await shot(p, `02-dashboard-${theme}`);
  await p.context().close();
}
{
  const p = await newPage("light");
  await p.goto(`${base}/documents`);
  await p.getByRole("list", { name: "Documents" }).waitFor();
  await shot(p, "03-library-light");
  await p.goto(`${base}/documents/${pdf.doc_id}?page=2&q=${encodeURIComponent("Either party may terminate this Agreement for convenience")}`);
  await p.locator("mark.pdf-hl").first().waitFor();
  await p.waitForTimeout(600);
  await shot(p, "04-pdf-viewer-citation-highlight-light");
  await p.context().close();
}
{
  const p = await newPage("dark");
  await p.goto(`${base}/chat`);
  const composer = p.getByLabel("Ask a question about your documents");
  await composer.fill("Which volcano erupted in Iceland in 2010?");
  await composer.press("Enter");
  await p.getByText("Not enough evidence").waitFor({ timeout: 60000 });
  await p.waitForTimeout(400);
  await shot(p, "05-chat-insufficient-evidence-dark");
  await p.keyboard.press("Control+k");
  await p.getByRole("dialog", { name: "Command palette" }).waitFor();
  await p.waitForTimeout(300);
  await shot(p, "06-command-palette-dark");
  await p.keyboard.press("Escape");
  await p.goto(`${base}/chat`);
  await p.getByText("What do you want to know?").waitFor();
  await shot(p, "07-new-chat-dark");
  await p.goto(`${base}/settings`);
  await p.getByText("pgvector").waitFor();
  await shot(p, "08-settings-dark");
  await p.context().close();
}
{
  const p = await newPage("light", { width: 390, height: 844 });
  await p.goto(`${base}/documents`);
  await p.getByRole("list", { name: "Documents" }).waitFor();
  await shot(p, "09-mobile-library-light");
  await p.getByRole("button", { name: "Open navigation" }).click();
  await p.getByRole("dialog", { name: "Navigation" }).waitFor();
  await p.waitForTimeout(700);
  await shot(p, "10-mobile-drawer-light");
  await p.context().close();
}

await browser.close();
await api.dispose();
console.log(`Saved screenshots to ${out}`);
