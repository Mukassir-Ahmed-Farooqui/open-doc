export interface SSEEvent {
  event: string;
  data: string;
  id?: string;
}

/**
 * Incremental Server-Sent Events parser (WHATWG event-stream format).
 * Feed it arbitrary text chunks; it returns every event completed by that chunk.
 * Handles CRLF/CR/LF line endings, multi-line data, comments and events split across chunks.
 */
export class SSEParser {
  private buffer = "";
  private eventType = "";
  private dataLines: string[] = [];
  private lastId: string | undefined;
  private sawData = false;

  feed(chunk: string): SSEEvent[] {
    this.buffer += chunk;
    const out: SSEEvent[] = [];
    // A trailing lone CR may be the first half of CRLF: keep it for the next chunk.
    let lineEnd: RegExpExecArray | null;
    const re = /\r\n|\r|\n/g;
    let start = 0;
    while ((lineEnd = re.exec(this.buffer)) !== null) {
      if (lineEnd[0] === "\r" && lineEnd.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(start, lineEnd.index);
      start = lineEnd.index + lineEnd[0].length;
      const ev = this.processLine(line);
      if (ev) out.push(ev);
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  /** Flush at end of stream: a final event without a trailing blank line is dispatched. */
  end(): SSEEvent[] {
    const out: SSEEvent[] = [];
    if (this.buffer) {
      const ev = this.processLine(this.buffer);
      this.buffer = "";
      if (ev) out.push(ev);
    }
    const ev = this.processLine("");
    if (ev) out.push(ev);
    return out;
  }

  private processLine(line: string): SSEEvent | null {
    if (line === "") {
      if (!this.sawData) {
        this.eventType = "";
        return null;
      }
      const ev: SSEEvent = { event: this.eventType || "message", data: this.dataLines.join("\n") };
      if (this.lastId !== undefined) ev.id = this.lastId;
      this.eventType = "";
      this.dataLines = [];
      this.sawData = false;
      return ev;
    }
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        this.eventType = value;
        break;
      case "data":
        this.dataLines.push(value);
        this.sawData = true;
        break;
      case "id":
        if (!value.includes("\0")) this.lastId = value;
        break;
      default:
        break; // "retry" and unknown fields are ignored
    }
    return null;
  }
}

/** Read a fetch Response body as a stream of SSE events. */
export async function* readSSE(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SSEParser();
  const onAbort = () => reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const ev of parser.feed(decoder.decode(value, { stream: true }))) yield ev;
    }
    for (const ev of parser.feed(decoder.decode())) yield ev;
    for (const ev of parser.end()) yield ev;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock?.();
  }
}
