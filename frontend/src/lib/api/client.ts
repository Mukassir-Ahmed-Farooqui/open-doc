import { z } from "zod";
import { API_BASE, API_ORIGIN } from "../config";
import { ApiError, errorFromResponse, networkError, timeoutError } from "./errors";
import { COLD_START_POLICY, sleep, wakeStore, type RetryPolicy } from "./wake";
import {
  ChatDetailSchema,
  ChatSchema,
  DeleteResponseSchema,
  DocumentSchema,
  HealthSchema,
  ReadySchema,
  RegisterResponseSchema,
  StatusResponseSchema,
  SummaryResponseSchema,
  TokenResponseSchema,
  UploadResponseSchema,
  UserSchema,
  type SummaryStyle,
} from "./schemas";

export interface ApiClientOptions {
  baseUrl?: string;
  origin?: string;
  getToken?: () => string | null;
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
  /**
   * Retry policy for cold starts (network errors, timeouts, 502/503/504). `false` disables retries.
   * Defaults to ~100 s of backoff, enough for a free-tier server to wake up.
   */
  retry?: RetryPolicy | false;
}

/** Statuses a sleeping or restarting host answers with before the app is up. */
const GATEWAY_STATUSES = new Set([502, 503, 504]);
/** Per-attempt timeout for idempotent requests; a cold start can hold a request ~60 s. */
const GET_TIMEOUT_MS = 45_000;

interface RawInit extends RequestInit {
  auth?: boolean;
  allowStatus?: number[];
  /** Skip the cold-start retry loop for this call. */
  noRetry?: boolean;
  /** Don't flip the global "waking up" state (background warm-up pings). */
  silent?: boolean;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  auth?: boolean;
  /** Return 503 bodies instead of throwing (readiness probe). */
  allowStatus?: number[];
}

/**
 * Typed client for the OpenDoc v1 API. Every JSON response is validated with zod, so a
 * contract drift surfaces as a clear error rather than undefined fields deep in the UI.
 */
export class ApiClient {
  readonly baseUrl: string;
  readonly origin: string;
  private readonly getToken: () => string | null;
  private readonly onUnauthorized?: () => void;
  private readonly fetchImpl: typeof fetch;
  private readonly retry: RetryPolicy | false;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? API_BASE;
    this.origin = opts.origin ?? API_ORIGIN;
    this.getToken = opts.getToken ?? (() => null);
    this.onUnauthorized = opts.onUnauthorized;
    this.fetchImpl = opts.fetch ?? ((...args) => globalThis.fetch(...args));
    this.retry = opts.retry ?? COLD_START_POLICY;
  }

  authHeaders(): Record<string, string> {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * Low-level fetch that throws ApiError for non-2xx and handles 401.
   *
   * Cold starts: a network failure, a per-attempt timeout (idempotent methods only) or a gateway
   * status (502/503/504) is retried with backoff while the UI shows "Waking up the server". POSTs are
   * retried only when the server cannot have processed them (no response, or a gateway status).
   */
  async raw(url: string, init: RawInit = {}): Promise<Response> {
    const { auth = true, allowStatus = [], noRetry, silent, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (auth) for (const [k, v] of Object.entries(this.authHeaders())) headers.set(k, v);
    const method = (rest.method ?? "GET").toUpperCase();
    const idempotent = method === "GET" || method === "HEAD";
    const policy = noRetry ? false : this.retry;
    const started = Date.now();
    const callerSignal = rest.signal ?? undefined;

    for (let attempt = 1; ; attempt++) {
      const tracker = silent ? null : wakeStore.track();
      const timeout = idempotent && policy ? new AbortController() : null;
      const timer = timeout ? setTimeout(() => timeout.abort(), GET_TIMEOUT_MS) : null;
      const signal = timeout ? anySignal([callerSignal, timeout.signal]) : callerSignal;
      let res: Response | null = null;
      let failure: ApiError | null = null;
      try {
        res = await this.fetchImpl(url, { ...rest, headers, signal });
      } catch (err) {
        if (callerSignal?.aborted) {
          tracker?.done(false);
          throw err instanceof DOMException ? err : new DOMException("Aborted", "AbortError");
        }
        failure = timeout?.signal.aborted ? timeoutError() : err instanceof DOMException && err.name === "AbortError" ? null : networkError(err);
        if (!failure) {
          tracker?.done(false);
          throw err;
        }
      } finally {
        if (timer) clearTimeout(timer);
      }

      const gateway = res !== null && GATEWAY_STATUSES.has(res.status) && !allowStatus.includes(res.status);
      if (res && !gateway) tracker?.done(true);
      else tracker?.done(false);

      const retriable = failure ? failure.code === "network_error" || idempotent : gateway;
      const canRetry =
        !!policy && retriable && attempt < policy.attempts && Date.now() - started + policy.delay(attempt) < policy.budgetMs;
      if ((failure || gateway) && canRetry) {
        if (!silent) wakeStore.retrying();
        await sleep(policy.delay(attempt), callerSignal);
        continue;
      }
      if (failure) throw failure;
      const r = res!;
      if (!r.ok && !allowStatus.includes(r.status)) {
        const text = await r.text().catch(() => "");
        const error = errorFromResponse(r.status, r.headers, text);
        if (r.status === 401 && auth) this.onUnauthorized?.();
        throw error;
      }
      return r;
    }
  }

  /** Background warm-up ping so a sleeping free-tier server starts booting early. Never throws. */
  warmUp() {
    void this.raw(`${this.origin}/health`, { auth: false, silent: true }).then(
      () => wakeStore.awake(),
      () => undefined,
    );
  }

  private async json<S extends z.ZodType>(
    method: Method,
    path: string,
    schema: S,
    opts: RequestOptions = {},
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    let body: BodyInit | undefined;
    if (opts.body instanceof FormData) body = opts.body;
    else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const url = path.startsWith("http") || path.startsWith("/health") || path.startsWith("/ready")
      ? (path.startsWith("http") ? path : `${this.origin}${path}`)
      : `${this.baseUrl}${path}`;
    const res = await this.raw(url, {
      method,
      headers,
      body,
      signal: opts.signal,
      auth: opts.auth,
      allowStatus: opts.allowStatus,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError({ status: res.status, code: "invalid_response", message: "The API returned invalid JSON." });
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new ApiError({
        status: res.status,
        code: "invalid_response",
        message: `Unexpected response from ${method} ${path}`,
        details: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  /* ── probes ── */
  health(signal?: AbortSignal) {
    return this.json("GET", "/health", HealthSchema, { auth: false, signal });
  }
  ready(signal?: AbortSignal) {
    return this.json("GET", "/ready", ReadySchema, { auth: false, signal, allowStatus: [503] });
  }

  /* ── auth ── */
  register(body: { email: string; password: string; full_name?: string }) {
    return this.json("POST", "/auth/register", RegisterResponseSchema, { body, auth: false });
  }
  login(body: { email: string; password: string }) {
    return this.json("POST", "/auth/login", TokenResponseSchema, { body, auth: false });
  }
  me(signal?: AbortSignal) {
    return this.json("GET", "/auth/me", UserSchema, { signal });
  }
  updateMe(body: { full_name: string | null }) {
    return this.json("PATCH", "/auth/me", UserSchema, { body });
  }

  /* ── documents ── */
  listDocuments(signal?: AbortSignal) {
    return this.json("GET", "/documents", z.array(DocumentSchema), { signal });
  }
  getDocument(docId: string, signal?: AbortSignal) {
    return this.json("GET", `/documents/${encodeURIComponent(docId)}`, DocumentSchema, { signal });
  }
  deleteDocument(docId: string) {
    return this.json("DELETE", `/documents/${encodeURIComponent(docId)}`, DeleteResponseSchema);
  }
  documentSummary(docId: string, signal?: AbortSignal) {
    return this.json("GET", `/documents/${encodeURIComponent(docId)}/summary`, SummaryResponseSchema, { signal });
  }
  /**
   * Original file bytes. Prefers a short-lived direct storage URL (big files skip the API host,
   * which is faster and saves its bandwidth); falls back to the authenticated /download route.
   */
  async downloadDocument(docId: string, signal?: AbortSignal): Promise<Blob> {
    const id = encodeURIComponent(docId);
    try {
      const res = await this.raw(`${this.baseUrl}/documents/${id}/file-url`, { signal });
      const { url } = (await res.json()) as { url?: string | null };
      if (url) {
        const direct = await this.fetchImpl(url, { signal });
        if (direct.ok) return await direct.blob();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      // Older API without /file-url, bucket CORS, or a dropped transfer: use the proxy route.
    }
    const res = await this.raw(`${this.baseUrl}/documents/${id}/download`, { signal });
    try {
      return await res.blob();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw networkError(err);
    }
  }
  uploadUrl() {
    return `${this.baseUrl}/upload`;
  }
  /**
   * Upload one file. Uses XHR so the caller gets byte-level upload progress (fetch has none).
   * Resolves with the document (202 queued, or 200 + duplicate).
   */
  uploadDocument(
    file: File,
    opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<z.infer<typeof UploadResponseSchema>> {
    const policy = this.retry;
    const started = Date.now();
    const attemptOnce = () =>
      new Promise<z.infer<typeof UploadResponseSchema>>((resolve, reject) => {
        const tracker = wakeStore.track();
        const xhr = new XMLHttpRequest();
        xhr.open("POST", this.uploadUrl());
        for (const [k, v] of Object.entries(this.authHeaders())) xhr.setRequestHeader(k, v);
        xhr.setRequestHeader("Accept", "application/json");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
        };
        xhr.onerror = () => {
          tracker.done(false);
          reject(networkError(new Error("upload failed")));
        };
        xhr.onabort = () => {
          tracker.done(false);
          reject(new DOMException("Upload cancelled", "AbortError"));
        };
        xhr.onload = () => {
          const headers = new Headers();
          for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
            const idx = line.indexOf(":");
            if (idx > 0) headers.append(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
          }
          tracker.done(!GATEWAY_STATUSES.has(xhr.status));
          if (xhr.status < 200 || xhr.status >= 300) {
            if (xhr.status === 401) this.onUnauthorized?.();
            reject(errorFromResponse(xhr.status, headers, xhr.responseText));
            return;
          }
          try {
            const parsed = UploadResponseSchema.safeParse(JSON.parse(xhr.responseText));
            if (!parsed.success) throw new Error("invalid");
            resolve(parsed.data);
          } catch {
            reject(new ApiError({ status: xhr.status, code: "invalid_response", message: "Unexpected upload response." }));
          }
        };
        opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
        const form = new FormData();
        form.append("file", file, file.name);
        xhr.send(form);
      });

    // The API de-duplicates by content hash, so re-sending after a failed attempt is safe.
    const run = async (attempt: number): Promise<z.infer<typeof UploadResponseSchema>> => {
      try {
        return await attemptOnce();
      } catch (err) {
        const retriable = err instanceof ApiError && (err.code === "network_error" || GATEWAY_STATUSES.has(err.status));
        if (
          !policy ||
          !retriable ||
          attempt >= policy.attempts ||
          Date.now() - started + policy.delay(attempt) >= policy.budgetMs
        )
          throw err;
        wakeStore.retrying();
        opts.onProgress?.(0);
        await sleep(policy.delay(attempt), opts.signal);
        return run(attempt + 1);
      }
    };
    return run(1);
  }

  /* ── chats ── */
  listChats(signal?: AbortSignal) {
    return this.json("GET", "/chats", z.array(ChatSchema), { signal });
  }
  createChat(selectedDocIds: string[]) {
    return this.json("POST", "/chats", ChatSchema, { body: { selected_doc_ids: selectedDocIds } });
  }
  getChat(chatId: string, signal?: AbortSignal) {
    return this.json("GET", `/chats/${encodeURIComponent(chatId)}`, ChatDetailSchema, { signal });
  }
  renameChat(chatId: string, title: string) {
    return this.json("PATCH", `/chats/${encodeURIComponent(chatId)}`, ChatSchema, { body: { title } });
  }
  setChatDocuments(chatId: string, selectedDocIds: string[]) {
    return this.json("PATCH", `/chats/${encodeURIComponent(chatId)}/documents`, ChatSchema, {
      body: { selected_doc_ids: selectedDocIds },
    });
  }
  deleteChat(chatId: string) {
    return this.json("DELETE", `/chats/${encodeURIComponent(chatId)}`, StatusResponseSchema);
  }
  /** Opens the SSE stream; the caller parses the body with readSSE(). */
  openMessageStream(chatId: string, question: string, summaryStyle: SummaryStyle, signal?: AbortSignal) {
    return this.raw(`${this.baseUrl}/chats/${encodeURIComponent(chatId)}/messages/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ question, summary_style: summaryStyle }),
      signal,
    });
  }
}

/** AbortSignal that aborts when any input aborts (AbortSignal.any is not in every target browser). */
function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}
