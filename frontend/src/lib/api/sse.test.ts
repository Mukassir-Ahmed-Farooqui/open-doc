import { describe, expect, it } from "vitest";
import { readSSE, SSEParser } from "./sse";

describe("SSEParser", () => {
  it("parses named events with JSON data", () => {
    const p = new SSEParser();
    const evs = p.feed('event: meta\ndata: {"a":1}\n\nevent: token\ndata: {"delta":"Hi"}\n\n');
    expect(evs).toEqual([
      { event: "meta", data: '{"a":1}' },
      { event: "token", data: '{"delta":"Hi"}' },
    ]);
  });

  it("buffers events split across arbitrary chunk boundaries", () => {
    const p = new SSEParser();
    const text = 'event: token\ndata: {"delta":"Either party "}\n\nevent: done\ndata: {"id":"x"}\n\n';
    const out = [];
    for (const ch of text) out.push(...p.feed(ch));
    expect(out.map((e) => e.event)).toEqual(["token", "done"]);
    expect(JSON.parse(out[0].data).delta).toBe("Either party ");
  });

  it("handles CRLF and a CR split from its LF", () => {
    const p = new SSEParser();
    expect(p.feed("event: a\r")).toEqual([]);
    expect(p.feed("\ndata: 1\r\n\r\n")).toEqual([{ event: "a", data: "1" }]);
  });

  it("joins multi-line data, ignores comments and defaults the event name", () => {
    const p = new SSEParser();
    expect(p.feed(": keep-alive\ndata: line1\ndata: line2\n\n")).toEqual([{ event: "message", data: "line1\nline2" }]);
  });

  it("strips only one leading space and keeps the id", () => {
    const p = new SSEParser();
    expect(p.feed("id: 7\ndata:  two spaces\n\n")).toEqual([{ event: "message", data: " two spaces", id: "7" }]);
  });

  it("does not dispatch an event with no data", () => {
    const p = new SSEParser();
    expect(p.feed("event: ping\n\n")).toEqual([]);
  });

  it("flushes a trailing event without a blank line on end()", () => {
    const p = new SSEParser();
    expect(p.feed("event: done\ndata: {}")).toEqual([]);
    expect(p.end()).toEqual([{ event: "done", data: "{}" }]);
  });
});

describe("readSSE", () => {
  it("decodes a byte stream including multi-byte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode('event: token\ndata: {"delta":"café ✓"}\n\n');
    const chunks = [bytes.slice(0, 33), bytes.slice(33, 35), bytes.slice(35)];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((ch) => c.enqueue(ch));
        c.close();
      },
    });
    const events = [];
    for await (const ev of readSSE(stream)) events.push(ev);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].data).delta).toBe("café ✓");
  });
});
