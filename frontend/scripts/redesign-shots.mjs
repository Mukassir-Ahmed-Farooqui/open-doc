// Screenshot the key screens of a built SPA against the in-memory mock API (no backend, no network).
//   VITE_API_URL= npx vite build --outDir /tmp/dist
//   node scripts/redesign-shots.mjs --dist /tmp/dist --out ../docs/screenshots/redesign/after [--theme light] [--widths 1440,390]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createMockApi, serveDist } from "../e2e/mock/mock-api.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const dist = path.resolve(args.dist ?? "dist");
const out = path.resolve(args.out ?? "shots");
const theme = args.theme ?? "light";
const widths = (args.widths ?? "1440,1024,768,390").split(",").map(Number);
const only = args.only ? args.only.split(",") : null;
const ORIGIN = "http://opendoc.test";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", args: ["--no-sandbox", "--force-color-profile=srgb"] });

async function open(width, signedIn) {
  const height = width <= 480 ? 844 : width <= 800 ? 1024 : 900;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: "reduce" });
  const mock = createMockApi({ seed: "full", streamDelayMs: 0 });
  await serveDist(ctx, ORIGIN, dist);
  await mock.install(ctx, ORIGIN);
  await ctx.addInitScript(
    ([t, si]) => {
      localStorage.setItem("opendoc.theme", t);
      if (si) localStorage.setItem("opendoc.session", JSON.stringify({ token: "mock-token", expiresAt: Date.now() + 86400000 }));
    },
    [theme, signedIn],
  );
  const page = await ctx.newPage();
  return { ctx, page, ids: mock.state.ids };
}

const settle = (page, ms = 700) => page.waitForTimeout(ms);
const shots = [
  ["landing", false, async (p) => { await p.goto(`${ORIGIN}/`); await settle(p, 1200); }],
  ["login", false, async (p) => { await p.goto(`${ORIGIN}/login`); await settle(p); }],
  ["dashboard", true, async (p) => { await p.goto(`${ORIGIN}/`); await settle(p, 1200); }],
  ["library", true, async (p) => { await p.goto(`${ORIGIN}/documents`); await settle(p, 1200); }],
  ["chat", true, async (p, ids) => {
    await p.goto(`${ORIGIN}/chat/${ids.chat}`);
    await settle(p, 1200);
    const chip = p.locator('button[data-citation="S1"]').first();
    if (await chip.count()) { await chip.click(); await settle(p, 600); }
  }],
  ["chat-abstain", true, async (p, ids) => { await p.goto(`${ORIGIN}/chat/${ids.abstainChat}`); await settle(p, 1200); }],
  ["viewer", true, async (p, ids) => {
    await p.goto(`${ORIGIN}/documents/${ids.pdf}?page=2&q=${encodeURIComponent("Either party may terminate this Agreement for convenience on ninety days written notice to the other party.")}`);
    await p.locator(".react-pdf__Page canvas").first().waitFor({ timeout: 20000 }).catch(() => {});
    await settle(p, 1500);
  }],
  ["settings", true, async (p) => { await p.goto(`${ORIGIN}/settings`); await settle(p, 1000); }],
];

for (const w of widths) {
  for (const [name, signedIn, go] of shots) {
    if (only && !only.includes(name)) continue;
    const { ctx, page, ids } = await open(w, signedIn);
    try {
      await go(page, ids);
      await page.screenshot({ path: path.join(out, `${name}-${w}.png`) });
      if (name === "landing" && (w === 1440 || w === 390)) await page.screenshot({ path: path.join(out, `${name}-${w}-full.png`), fullPage: true });
      console.log("ok", name, w);
    } catch (e) {
      console.log("FAIL", name, w, String(e).slice(0, 200));
    }
    await ctx.close();
  }
}
await browser.close();
