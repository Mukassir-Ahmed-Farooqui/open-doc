/* global document, getComputedStyle, innerHeight, matchMedia */
// Touch-target audit: lists visible interactive elements smaller than 44x44 CSS px on a 390 px touch
// viewport (pointer: coarse), against the mock API. Inline citation chips are reported separately
// because they rely on an invisible ::after hit area (.hit) that getBoundingClientRect can't see.
//   node scripts/redesign-touch.mjs --dist /tmp/dist
import { chromium } from "@playwright/test";
import path from "node:path";
import { createMockApi, serveDist } from "../e2e/mock/mock-api.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const dist = path.resolve(args.dist ?? "dist");
const ORIGIN = "http://opendoc.test";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
const routes = [
  ["landing", false, () => "/"],
  ["login", false, () => "/login"],
  ["dashboard", true, () => "/"],
  ["library", true, () => "/documents"],
  ["chat", true, (ids) => `/chat/${ids.chat}`],
  ["viewer", true, (ids) => `/documents/${ids.pdf}?page=2`],
  ["settings", true, () => "/settings"],
];
let total = 0;
for (const [name, signedIn, to] of routes) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const mock = createMockApi({ seed: "full", streamDelayMs: 0 });
  await serveDist(ctx, ORIGIN, dist);
  await mock.install(ctx, ORIGIN);
  await ctx.addInitScript((si) => {
    if (si) localStorage.setItem("opendoc.session", JSON.stringify({ token: "mock-token", expiresAt: Date.now() + 86400000 }));
  }, signedIn);
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}${to(mock.state.ids)}`);
  await page.waitForTimeout(1500);
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role="tab"], [role="menuitem"]')) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (!r.width || !r.height || st.visibility === "hidden" || r.bottom < 0 || r.top > innerHeight * 3) continue;
      if (el.closest("[inert],[aria-hidden=true]")) continue;
      if (r.width <= 2 && r.height <= 2) continue; // sr-only skip link
      const stretched = getComputedStyle(el, "::after");
      if (stretched.content !== "none" && stretched.position === "absolute" && stretched.inset === "0px") {
        const p = el.closest("li, tr, div")?.getBoundingClientRect();
        if (p && p.height >= 44) continue; // stretched link: the whole row is the target
      }
      if (r.width < 44 || r.height < 44) {
        const chip = el.matches("[data-citation]") || el.classList.contains("hit");
        out.push({ chip, w: Math.round(r.width), h: Math.round(r.height), label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40), tag: el.tagName.toLowerCase() });
      }
    }
    return out;
  });
  const real = small.filter((s) => !s.chip);
  total += real.length;
  console.log(`${name}: coarse=${coarse} under44=${real.length} (chips with ::after hit area: ${small.length - real.length})`);
  for (const s of real) console.log(`   ${s.tag} ${s.w}x${s.h} ${s.label}`);
  await ctx.close();
}
console.log("TOTAL under 44px (excluding .hit chips):", total);
await browser.close();
