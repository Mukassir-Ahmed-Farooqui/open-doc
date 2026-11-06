import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";
import { ApiError } from "./errors";
import { streamChatMessage } from "./stream";
import { wakeStore } from "./wake";

const doc = {
  doc_id: "11111111-1111-1111-1111-111111111111",
  filename: "contract.pdf",
  content_type: "application/pdf",
  file_size_bytes: 182538,
  status: "ready",
  progress: 100,
  error: null,
  num_pages: 15,
  section_count: 40,
  chunk_count: 43,
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T10:01:00Z",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function makeClient(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof ApiClient>[0]> = {}) {
  return new ApiClient({ baseUrl: "https://api.test/api/v1", origin: "https://api.test", fetch: fetchImpl, getToken: () => "tok", retry: false, ...extra });
}

describe("ApiClient", () => {
  it("sends the bearer token and validates the documents list", async () => {
    const f = vi.fn(async () => json([doc]));
    const docs = await makeClient(f as unknown as typeof fetch).listDocuments();
    expect(docs[0].filename).toBe("contract.pdf");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/api/v1/documents");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
  });

  it("does not send a token to login and posts JSON", async () => {
    const f = vi.fn(async () => json({ access_token: "a", token_type: "bearer", expires_in: 3600 }));
    const res = await makeClient(f as unknown as typeof fetch).login({ email: "a@b.co", password: "pw" });
    expect(res.expires_in).toBe(3600);
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const h = new Headers(init.headers);
    expect(h.get("Authorization")).toBeNull();
    expect(h.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.co", password: "pw" });
  });

  it("maps the error envelope to ApiError (404 for foreign resources)", async () => {
    const f = vi.fn(async () =>
      json({ error: { code: "not_found", message: "Document not found", details: null, request_id: "r1" }, detail: "Document not found" }, 404),
    );
    const err = await makeClient(f as unknown as typeof fetch).getDocument("x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("not_found");
    expect(err.message).toBe("Document not found");
    expect(err.requestId).toBe("r1");
    expect(err.isNotFound).toBe(true);
  });

  it("falls back to legacy {detail} bodies and reports Retry-After on 429", async () => {
    const f = vi.fn(async () => json({ detail: "Too many requests" }, 429, { "Retry-After": "12" }));
    const err = await makeClient(f as unknown as typeof fetch).listChats().catch((e) => e);
    expect(err.code).toBe("rate_limited");
    expect(err.retryAfter).toBe(12);
    expect(err.message).toContain("12s");
  });

  it("calls onUnauthorized on 401", async () => {
    const onUnauthorized = vi.fn();
    const f = vi.fn(async () => json({ detail: "Not authenticated" }, 401));
    await makeClient(f as unknown as typeof fetch, { onUnauthorized }).me().catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("rejects responses that do not match the schema", async () => {
    const f = vi.fn(async () => json([{ doc_id: 1 }]));
    const err = await makeClient(f as unknown as typeof fetch).listDocuments().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("invalid_response");
  });

  it("treats 503 from /ready as data, at the API origin", async () => {
    const f = vi.fn(async () => json({ status: "not_ready", checks: { database: "error: OSError" } }, 503));
    const r = await makeClient(f as unknown as typeof fetch).ready();
    expect(r.status).toBe("not_ready");
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://api.test/ready");
  });

  it("wraps network failures", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await makeClient(f as unknown as typeof fetch).listChats().catch((e) => e);
    expect(err.code).toBe("network_error");
  });

  it("retries a cold start (network error, then 503) and recovers", async () => {
    wakeStore.reset();
    let n = 0;
    const f = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new TypeError("Failed to fetch");
      if (n === 2) return json({ detail: "Service Unavailable" }, 503);
      return json([doc]);
    });
    const states: boolean[] = [];
    const off = wakeStore.subscribe((s) => states.push(s.waking));
    const docs = await makeClient(f as unknown as typeof fetch, {
      retry: { attempts: 5, delay: () => 1, budgetMs: 5000 },
    }).listDocuments();
    off();
    expect(docs).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(3);
    expect(states).toContain(true);
    expect(wakeStore.get().waking).toBe(false);
  });

  it("gives up after the retry budget with a friendly cold-start message", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await makeClient(f as unknown as typeof fetch, { retry: { attempts: 3, delay: () => 1, budgetMs: 5000 } })
      .listChats()
      .catch((e) => e);
    expect(f).toHaveBeenCalledTimes(3);
    expect(err.code).toBe("network_error");
    expect(err.message).toMatch(/waking up/);
    wakeStore.reset();
  });

  it("does not retry a POST that may have reached the server (no gateway status)", async () => {
    const f = vi.fn(async () => json({ detail: "boom" }, 500));
    const err = await makeClient(f as unknown as typeof fetch, { retry: { attempts: 4, delay: () => 1, budgetMs: 5000 } })
      .createChat([])
      .catch((e) => e);
    expect(f).toHaveBeenCalledTimes(1);
    expect(err.status).toBe(500);
  });

  it("does not retry the /ready probe's intentional 503", async () => {
    const f = vi.fn(async () => json({ status: "not_ready", checks: {} }, 503));
    await makeClient(f as unknown as typeof fetch, { retry: { attempts: 4, delay: () => 1, budgetMs: 5000 } }).ready();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("stops retrying when the caller aborts", async () => {
    const ctrl = new AbortController();
    const f = vi.fn(async () => {
      ctrl.abort();
      throw new TypeError("Failed to fetch");
    });
    const err = await makeClient(f as unknown as typeof fetch, { retry: { attempts: 5, delay: () => 50, budgetMs: 5000 } })
      .listChats(ctrl.signal)
      .catch((e) => e);
    expect(err.name).toBe("AbortError");
    expect(f).toHaveBeenCalledTimes(1);
    wakeStore.reset();
  });

  it("creates chats with the selected documents", async () => {
    const chat = { id: "c1", title: "New Chat", selected_doc_ids: [doc.doc_id], created_at: "t", updated_at: "t" };
    const f = vi.fn(async () => json(chat, 201));
    const res = await makeClient(f as unknown as typeof fetch).createChat([doc.doc_id]);
    expect(res.id).toBe("c1");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/api/v1/chats");
    expect(JSON.parse(init.body as string)).toEqual({ selected_doc_ids: [doc.doc_id] });
  });
});

function sseResponse(chunks: string[], status = 200) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        chunks.forEach((ch) => c.enqueue(enc.encode(ch)));
        c.close();
      },
    }),
    { status, headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("streamChatMessage", () => {
  const done = {
    id: "m2",
    role: "assistant",
    content: "Ninety days [S1].",
    citations: [{ source_id: "S1", doc_id: "d", document: "c.pdf", page: 2, section: "3", snippet: "s", preview: "s", score: 4.2 }],
    latency_ms: 1830,
    timestamp: "t",
    model: "llama",
    abstained: false,
  };

  it("emits meta, tokens and resolves with the saved message", async () => {
    const f = vi.fn(async () =>
      sseResponse([
        'event: meta\ndata: {"user_message_id":"m1","query_type":"fact","abstained":false,"sources":4}\n\n',
        'event: token\ndata: {"delta":"Ninety "}\n\nevent: tok',
        'en\ndata: {"delta":"days [S1]."}\n\n',
        `event: done\ndata: ${JSON.stringify(done)}\n\n`,
      ]),
    );
    const tokens: string[] = [];
    const onMeta = vi.fn();
    const res = await streamChatMessage(makeClient(f as unknown as typeof fetch), "c1", "How long?", {
      onMeta,
      onToken: (d) => tokens.push(d),
    });
    expect(onMeta).toHaveBeenCalledWith(expect.objectContaining({ user_message_id: "m1" }));
    expect(tokens.join("")).toBe("Ninety days [S1].");
    expect(res.citations?.[0].page).toBe(2);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/api/v1/chats/c1/messages/stream");
    expect(JSON.parse(init.body as string)).toEqual({ question: "How long?", summary_style: "executive" });
  });

  it("throws on an error event", async () => {
    const f = vi.fn(async () => sseResponse(['event: meta\ndata: {"user_message_id":"m1"}\n\n', 'event: error\ndata: {"message":"LLM down"}\n\n']));
    const err = await streamChatMessage(makeClient(f as unknown as typeof fetch), "c1", "q").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("LLM down");
  });

  it("throws the HTTP error returned before the stream starts", async () => {
    const f = vi.fn(async () => json({ error: { code: "conflict", message: "The selected documents are still processing or failed to process." } }, 409));
    const err = await streamChatMessage(makeClient(f as unknown as typeof fetch), "c1", "q").catch((e) => e);
    expect(err.status).toBe(409);
  });

  it("reports an incomplete stream", async () => {
    const f = vi.fn(async () => sseResponse(['event: token\ndata: {"delta":"x"}\n\n']));
    const err = await streamChatMessage(makeClient(f as unknown as typeof fetch), "c1", "q").catch((e) => e);
    expect(err.code).toBe("stream_incomplete");
  });
});
