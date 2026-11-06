// Run the Impeccable detector against rendered app routes (mock API, no backend) through CDP.
//   node scripts/redesign-detect.mjs --dist /tmp/dist --out findings.json --impeccable <path to impeccable launcher>
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createMockApi, serveDist } from "../e2e/mock/mock-api.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const dist = path.resolve(args.dist ?? "dist");
const bin = args.impeccable;
const port = 9333;
const ORIGIN = "http://opendoc.test";
const viewports = (args.viewports ?? "1280x800,390x844").split(",").map((v) => v.split("x").map(Number));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox", `--remote-debugging-port=${port}`],
});
const routes = [
  ["landing", false, () => "/"],
  ["login", false, () => "/login"],
  ["dashboard", true, () => "/"],
  ["library", true, () => "/documents"],
  ["chat", true, (ids) => `/chat/${ids.chat}`],
  ["viewer", true, (ids) => `/documents/${ids.pdf}?page=2&q=${encodeURIComponent("Either party may terminate this Agreement for convenience")}`],
  ["settings", true, () => "/settings"],
];
const results = {};
for (const [w, h] of viewports) {
  for (const [name, signedIn, to] of routes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const mock = createMockApi({ seed: "full", streamDelayMs: 0 });
    await serveDist(ctx, ORIGIN, dist);
    await mock.install(ctx, ORIGIN);
    await ctx.addInitScript((si) => {
      localStorage.setItem("opendoc.theme", "light");
      if (si) localStorage.setItem("opendoc.session", JSON.stringify({ token: "mock-token", expiresAt: Date.now() + 86400000 }));
    }, signedIn);
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}${to(mock.state.ids)}`);
    await page.waitForTimeout(1500);
    let out = "[]";
    try {
      out = execFileSync(bin, ["detect", "--json", "--cdp", String(port), "--target", "opendoc.test"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    } catch (e) {
      out = e.stdout || "[]"; // exit code 2 = findings present
    }
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch {
      parsed = { raw: out.slice(0, 500) };
    }
    results[`${name}@${w}`] = parsed;
    console.log(name, w, Array.isArray(parsed) ? parsed.length : "?");
    await ctx.close();
  }
}
writeFileSync(path.resolve(args.out ?? "detect.json"), JSON.stringify(results, null, 1));
await browser.close();
