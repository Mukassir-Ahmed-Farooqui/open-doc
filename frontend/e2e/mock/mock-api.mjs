// In-memory mock of the OpenDoc v1 API for Playwright (route interception, same origin).
// Mirrors backend/app/schemas/*.py closely enough for the SPA's zod schemas.
// Used by e2e/mocked.spec.ts and scripts/redesign-shots.mjs. Nothing here talks to a real backend.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../fixtures");

export const INSUFFICIENT =
  "I could not find sufficient evidence in the selected documents to answer this question.";

const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const uid = () => crypto.randomUUID();

function docRecord(filename, contentType, bytes, extra = {}) {
  return {
    doc_id: uid(),
    filename,
    content_type: contentType,
    file_size_bytes: bytes.length,
    status: "ready",
    progress: 100,
    error: null,
    num_pages: 1,
    section_count: 1,
    chunk_count: 1,
    created_at: iso(),
    updated_at: iso(),
    _bytes: bytes,
    _readyAt: 0,
    ...extra,
  };
}

const TERMINATION_ANSWER =
  "Either party may end the agreement **for convenience** by giving **ninety days' written notice** to the other party【S1】. " +
  "A separate, faster route exists for cause: a party may terminate immediately if the other commits a material breach that is not remedied within thirty days of written notice【S1】.\n\n" +
  "- The agreement started on 1 March 2026 with an initial term of twenty-four months, renewing automatically for twelve-month periods【S2】.\n" +
  "- Fees keep accruing during the notice period: the monthly service fee of EUR 18,500 is payable in advance【S3】.";

function citationsFor(pdf) {
  return [
    {
      source_id: "S1",
      doc_id: pdf.doc_id,
      document: pdf.filename,
      page: 2,
      section: "3. TERMINATION",
      snippet: "Either party may terminate this Agreement for convenience on ninety days written notice to the other party.",
      score: 0.91,
    },
    {
      source_id: "S2",
      doc_id: pdf.doc_id,
      document: pdf.filename,
      page: 1,
      section: "2. Term",
      snippet: "The Agreement starts on 1 March 2026 and continues for an initial term of twenty-four months, renewing automatically for successive twelve-month periods.",
      score: 0.74,
    },
    {
      source_id: "S3",
      doc_id: pdf.doc_id,
      document: pdf.filename,
      page: 3,
      section: "4. FEES AND PAYMENT",
      snippet: "The Customer shall pay the monthly service fee of EUR 18,500 in advance.",
      score: 0.62,
    },
  ];
}

/**
 * @param {{ seed?: "full" | "empty", ingestMs?: number, streamDelayMs?: number, failFirst?: number, user?: object }} opts
 */
export function createMockApi(opts = {}) {
  const ingestMs = opts.ingestMs ?? 4000;
  const state = { users: new Map(), tokens: new Map(), docs: [], chats: [], failLeft: opts.failFirst ?? 0, streamDelayMs: opts.streamDelayMs ?? 300 };
  const pdfBytes = readFileSync(path.join(fixtures, "services-agreement.pdf"));
  const mdBytes = readFileSync(path.join(fixtures, "handbook.md"));

  const seedUser = opts.user ?? { id: uid(), email: "ada@example.com", full_name: "Ada Lovelace", created_at: iso(86400000 * 12), password: "demo-password-123" };
  state.users.set(seedUser.email, seedUser);
  state.tokens.set("mock-token", seedUser.email);

  if (opts.seed === "full") {
    const pdf = docRecord("services-agreement.pdf", "application/pdf", pdfBytes, { num_pages: 3, section_count: 5, chunk_count: 9, created_at: iso(3600_000 * 26) });
    const md = docRecord("handbook.md", "text/markdown", mdBytes, { num_pages: 1, section_count: 3, chunk_count: 4, created_at: iso(3600_000 * 5) });
    const big = docRecord("Q3-board-report.pdf", "application/pdf", pdfBytes, { status: "processing", progress: 42, num_pages: 0, section_count: 0, chunk_count: 0, created_at: iso(40_000), _readyAt: Number.MAX_SAFE_INTEGER, file_size_bytes: 2_480_000 });
    state.docs.push(big, md, pdf);
    const c1 = { id: uid(), title: "Termination notice period", selected_doc_ids: [pdf.doc_id, md.doc_id], created_at: iso(3600_000), updated_at: iso(3600_000), messages: [] };
    c1.messages.push(
      { id: uid(), role: "user", content: "How much notice is needed to terminate the services agreement for convenience?", citations: null, timestamp: iso(3600_000) },
      { id: uid(), role: "assistant", content: TERMINATION_ANSWER, citations: citationsFor(pdf), latency_ms: 2140, model: "openai/gpt-oss-120b", timestamp: iso(3590_000) },
    );
    const c2 = { id: uid(), title: "Remote work policy", selected_doc_ids: [md.doc_id], created_at: iso(86400000 * 2), updated_at: iso(86400000 * 2), messages: [] };
    c2.messages.push(
      { id: uid(), role: "user", content: "Which volcano erupted in Iceland in 2010?", citations: null, timestamp: iso(86400000 * 2) },
      { id: uid(), role: "assistant", content: INSUFFICIENT, citations: [], latency_ms: 880, model: "openai/gpt-oss-120b", timestamp: iso(86400000 * 2) },
    );
    state.chats.push(c1, c2);
    state.ids = { pdf: pdf.doc_id, md: md.doc_id, chat: c1.id, abstainChat: c2.id };
  }

  const pub = (d) => {
    const out = { ...d };
    delete out._bytes;
    delete out._readyAt;
    return out;
  };
  const tick = (d) => {
    if (d.status === "ready" || d.status === "failed" || !d._readyAt || d._readyAt === Number.MAX_SAFE_INTEGER) return d;
    const left = d._readyAt - Date.now();
    if (left <= 0) Object.assign(d, { status: "ready", progress: 100, num_pages: d.content_type === "application/pdf" ? 3 : 1, section_count: 3, chunk_count: 6, updated_at: iso() });
    else if (left < ingestMs * 0.75) Object.assign(d, { status: "processing", progress: Math.round((1 - left / ingestMs) * 100) });
    return d;
  };
  const chatPub = (c) => ({ id: c.id, title: c.title, selected_doc_ids: c.selected_doc_ids, created_at: c.created_at, updated_at: c.updated_at });

  const json = (route, status, body, headers = {}) =>
    route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
  const err = (route, status, code, message) => json(route, status, { error: { code, message, request_id: "mock" } });

  function userOf(req) {
    const h = req.headers()["authorization"] ?? "";
    const t = h.replace(/^Bearer\s+/i, "");
    const email = state.tokens.get(t);
    return email ? state.users.get(email) : null;
  }

  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const m = req.method();

    if (state.failLeft > 0) {
      state.failLeft -= 1;
      return route.abort("connectionrefused");
    }

    if (p === "/health") return json(route, 200, { status: "ok", version: "2.0.0-mock" });
    if (p === "/ready") return json(route, 200, { status: "ready", checks: { database: "ok", pgvector: "ok", storage: "ok" } });

    const api = p.replace(/^\/api\/v1/, "");
    let body = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = null;
    }

    if (api === "/auth/register" && m === "POST") {
      if (state.users.has(body.email)) return err(route, 409, "conflict", "Email already registered");
      const u = { id: uid(), email: body.email, full_name: body.full_name ?? null, created_at: iso(), password: body.password };
      state.users.set(u.email, u);
      return json(route, 201, { message: "User registered", user_id: u.id });
    }
    if (api === "/auth/login" && m === "POST") {
      const u = state.users.get(body.email);
      if (!u || u.password !== body.password) return err(route, 401, "unauthorized", "Incorrect email or password");
      const t = `tok-${uid()}`;
      state.tokens.set(t, u.email);
      return json(route, 200, { access_token: t, token_type: "bearer", expires_in: 3600 * 24 });
    }

    const user = userOf(req);
    if (!user) return err(route, 401, "unauthorized", "Not authenticated");
    const pubUser = { id: user.id, email: user.email, full_name: user.full_name, created_at: user.created_at };

    if (api === "/auth/me" && m === "GET") return json(route, 200, pubUser);
    if (api === "/auth/me" && m === "PATCH") {
      user.full_name = body.full_name;
      return json(route, 200, { ...pubUser, full_name: user.full_name });
    }

    if (api === "/documents" && m === "GET") return json(route, 200, state.docs.map(tick).map(pub));
    if (api === "/upload" && m === "POST") {
      const raw = req.postDataBuffer() ?? Buffer.alloc(0);
      const head = raw.subarray(0, 2000).toString("latin1");
      const filename = /filename="([^"]+)"/.exec(head)?.[1] ?? "upload.bin";
      const type = /Content-Type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim() ?? "application/octet-stream";
      const dup = state.docs.find((d) => d.filename === filename);
      if (dup) return json(route, 200, { ...pub(tick(dup)), duplicate: true });
      const d = docRecord(filename, type, filename.endsWith(".pdf") ? pdfBytes : mdBytes, {
        status: "queued", progress: 0, num_pages: 0, section_count: 0, chunk_count: 0, _readyAt: Date.now() + ingestMs, file_size_bytes: raw.length,
      });
      state.docs.unshift(d);
      return json(route, 202, { ...pub(d), duplicate: false });
    }
    let mm;
    if ((mm = /^\/documents\/([^/]+)(\/.*)?$/.exec(api))) {
      const d = state.docs.find((x) => x.doc_id === decodeURIComponent(mm[1]));
      if (!d) return err(route, 404, "not_found", "Document not found");
      const sub = mm[2] ?? "";
      if (!sub && m === "GET") return json(route, 200, pub(tick(d)));
      if (!sub && m === "DELETE") {
        state.docs = state.docs.filter((x) => x !== d);
        for (const c of state.chats) c.selected_doc_ids = c.selected_doc_ids.filter((x) => x !== d.doc_id);
        return json(route, 200, { status: "deleted", doc_id: d.doc_id });
      }
      if (sub === "/file-url") return json(route, 200, { url: null });
      if (sub === "/download") return route.fulfill({ status: 200, contentType: d.content_type, body: d._bytes });
      if (sub === "/summary")
        return json(route, 200, {
          doc_id: d.doc_id,
          summary: "A master services agreement between Northwind Analytics (supplier) and Contoso Retail (customer): a 24-month term from 1 March 2026, termination for convenience on 90 days' notice, and a monthly fee of EUR 18,500 payable in advance.",
          model: "openai/gpt-oss-120b",
        });
    }

    if (api === "/chats" && m === "GET") return json(route, 200, [...state.chats].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(chatPub));
    if (api === "/chats" && m === "POST") {
      const c = { id: uid(), title: "New chat", selected_doc_ids: body.selected_doc_ids ?? [], created_at: iso(), updated_at: iso(), messages: [] };
      state.chats.unshift(c);
      return json(route, 201, chatPub(c));
    }
    if ((mm = /^\/chats\/([^/]+)(\/.*)?$/.exec(api))) {
      const c = state.chats.find((x) => x.id === decodeURIComponent(mm[1]));
      if (!c) return err(route, 404, "not_found", "Chat not found");
      const sub = mm[2] ?? "";
      if (!sub && m === "GET") return json(route, 200, { ...chatPub(c), messages: c.messages });
      if (!sub && m === "PATCH") {
        c.title = body.title;
        return json(route, 200, chatPub(c));
      }
      if (!sub && m === "DELETE") {
        state.chats = state.chats.filter((x) => x !== c);
        return json(route, 200, { status: "deleted" });
      }
      if (sub === "/documents" && m === "PATCH") {
        c.selected_doc_ids = body.selected_doc_ids;
        return json(route, 200, chatPub(c));
      }
      if (sub === "/messages/stream" && m === "POST") {
        const q = String(body.question ?? "");
        const userMsg = { id: uid(), role: "user", content: q, citations: null, timestamp: iso() };
        const scoped = state.docs.filter((d) => c.selected_doc_ids.includes(d.doc_id));
        const pdf = scoped.find((d) => d.filename.endsWith(".pdf"));
        const abstain = !pdf || /volcano|iceland|weather|football/i.test(q);
        const content = abstain ? INSUFFICIENT : TERMINATION_ANSWER;
        const citations = abstain ? [] : citationsFor(pdf);
        const asst = { id: uid(), role: "assistant", content, citations, latency_ms: 1940, model: "openai/gpt-oss-120b", timestamp: iso() };
        c.messages.push(userMsg, asst);
        if (c.title === "New chat") c.title = abstain ? "Out-of-scope question" : "Termination notice period";
        c.updated_at = iso();
        const tokens = content.match(/.{1,12}/gs) ?? [];
        const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
        const sse =
          ev("meta", { user_message_id: userMsg.id, query_type: "factual", abstained: abstain, sources: citations.length, retrieval_ms: 212 }) +
          tokens.map((t) => ev("token", { delta: t })).join("") +
          ev("done", { ...asst, abstained: abstain });
        if (state.streamDelayMs) await new Promise((r) => setTimeout(r, state.streamDelayMs));
        return route.fulfill({ status: 200, contentType: "text/event-stream", body: sse });
      }
    }
    return err(route, 404, "not_found", `No mock for ${m} ${api}`);
  }

  return {
    state,
    /** Install on a BrowserContext or Page. API origin must be the app origin (VITE_API_URL empty). */
    async install(target, origin) {
      await target.route(`${origin}/api/v1/**`, handle);
      await target.route(`${origin}/health`, handle);
      await target.route(`${origin}/ready`, handle);
    },
  };
}

/** Serve a built dist/ folder from memory at `origin` with SPA fallback (no server needed). */
export async function serveDist(target, origin, distDir) {
  const types = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".webmanifest": "application/manifest+json", ".map": "application/json" };
  await target.route(`${origin}/**`, async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/api/") || u.pathname === "/health" || u.pathname === "/ready") return route.fallback();
    let file = path.join(distDir, decodeURIComponent(u.pathname));
    let body;
    try {
      body = readFileSync(file);
    } catch {
      file = path.join(distDir, "index.html");
      body = readFileSync(file);
    }
    if (u.pathname === "/sw.js") return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: types[path.extname(file)] ?? "application/octet-stream", body });
  });
}
