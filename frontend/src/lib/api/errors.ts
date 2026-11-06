import { ErrorEnvelopeSchema } from "./schemas";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly retryAfter: number | null;
  readonly details: unknown;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    requestId?: string | null;
    retryAfter?: number | null;
    details?: unknown;
  }) {
    super(opts.message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId ?? null;
    this.retryAfter = opts.retryAfter ?? null;
    this.details = opts.details;
  }

  get isNotFound() {
    return this.status === 404;
  }
  get isUnauthorized() {
    return this.status === 401;
  }
}

const FALLBACK_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "validation_error",
  429: "rate_limited",
  500: "internal_error",
  503: "service_unavailable",
};

function detailToMessage(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : null))
      .filter(Boolean);
    if (msgs.length) return msgs.join("; ");
  }
  return null;
}

/** Build an ApiError from a non-2xx response body (already read as text). */
export function errorFromResponse(status: number, headers: Headers, bodyText: string): ApiError {
  let code = FALLBACK_CODES[status] ?? "http_error";
  let message = status >= 500 ? "The server ran into a problem. Please try again." : `Request failed (${status})`;
  let requestId = headers.get("x-request-id");
  let details: unknown;
  if (bodyText) {
    try {
      const parsed = ErrorEnvelopeSchema.safeParse(JSON.parse(bodyText));
      if (parsed.success) {
        const { error, detail } = parsed.data;
        if (error) {
          code = error.code;
          message = error.message;
          requestId = error.request_id ?? requestId;
          details = error.details;
        } else {
          message = detailToMessage(detail) ?? message;
        }
      }
    } catch {
      /* non-JSON body: keep the fallback message */
    }
  }
  if (status === 422 && Array.isArray(details) && details.length) {
    message = detailToMessage(details) ?? message;
  }
  const ra = headers.get("retry-after");
  const retryAfter = ra && /^\d+$/.test(ra) ? Number(ra) : null;
  if (status === 429 && retryAfter) message = `${message} Try again in ${retryAfter}s.`;
  return new ApiError({ status, code, message, requestId, retryAfter, details });
}

const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;

export function networkError(cause: unknown): ApiError {
  const msg = cause instanceof Error ? cause.message : String(cause);
  return new ApiError({
    status: 0,
    code: "network_error",
    message: offline()
      ? "You're offline. Reconnect and try again."
      : "The OpenDoc server didn't answer. It may still be waking up (free tier, about a minute). Try again shortly.",
    details: msg,
  });
}

export function timeoutError(): ApiError {
  return new ApiError({
    status: 0,
    code: "timeout",
    message: "The OpenDoc server is taking too long to answer. It may still be waking up. Try again shortly.",
  });
}

/** True for failures caused by the server being unreachable or asleep (worth an automatic retry). */
export function isColdStartError(err: unknown): boolean {
  return err instanceof ApiError && (err.code === "network_error" || err.code === "timeout" || [502, 503, 504].includes(err.status));
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
