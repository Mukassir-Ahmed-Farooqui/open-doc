import type { ApiClient } from "./client";
import { ApiError } from "./errors";
import {
  StreamDoneSchema,
  StreamErrorSchema,
  StreamMetaSchema,
  StreamTokenSchema,
  type StreamDone,
  type StreamMeta,
  type SummaryStyle,
} from "./schemas";
import { readSSE } from "./sse";

export interface StreamHandlers {
  onMeta?: (meta: StreamMeta) => void;
  onToken?: (delta: string) => void;
  onDone?: (message: StreamDone) => void;
}

/**
 * Ask a question in a chat and stream the answer. Resolves with the saved assistant message.
 * Throws ApiError for HTTP errors before the stream and for `event: error`; rethrows AbortError on stop.
 */
export async function streamChatMessage(
  client: ApiClient,
  chatId: string,
  question: string,
  opts: StreamHandlers & { summaryStyle?: SummaryStyle; signal?: AbortSignal } = {},
): Promise<StreamDone> {
  const res = await client.openMessageStream(chatId, question, opts.summaryStyle ?? "executive", opts.signal);
  if (!res.body) throw new ApiError({ status: res.status, code: "invalid_response", message: "Empty stream." });
  let done: StreamDone | null = null;
  for await (const ev of readSSE(res.body, opts.signal)) {
    let payload: unknown;
    try {
      payload = JSON.parse(ev.data);
    } catch {
      continue;
    }
    if (ev.event === "meta") {
      const p = StreamMetaSchema.safeParse(payload);
      if (p.success) opts.onMeta?.(p.data);
    } else if (ev.event === "token") {
      const p = StreamTokenSchema.safeParse(payload);
      if (p.success) opts.onToken?.(p.data.delta);
    } else if (ev.event === "done") {
      const p = StreamDoneSchema.safeParse(payload);
      if (!p.success) throw new ApiError({ status: 200, code: "invalid_response", message: "Malformed final message." });
      done = p.data;
      opts.onDone?.(done);
    } else if (ev.event === "error") {
      const p = StreamErrorSchema.safeParse(payload);
      throw new ApiError({
        status: 200,
        code: "stream_error",
        message: p.success ? p.data.message : "The answer stream failed.",
      });
    }
  }
  if (opts.signal?.aborted) throw new DOMException("Stopped", "AbortError");
  if (!done) throw new ApiError({ status: 200, code: "stream_incomplete", message: "The answer stream ended early." });
  return done;
}
