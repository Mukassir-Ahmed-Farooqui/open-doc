import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/instance";
import { streamChatMessage } from "@/lib/api/stream";
import type { ChatDetail, Message, StreamDone, StreamMeta, SummaryStyle } from "@/lib/api/schemas";
import { keys } from "./queries";

export interface LiveTurn {
  chatId: string;
  question: string;
  /** Show the question bubble locally (false once the server copy is in the cache). */
  showQuestion: boolean;
  answer: string;
  status: "streaming" | "stopped" | "error";
  meta?: StreamMeta;
  error?: unknown;
}

/**
 * Drives one streamed answer at a time: optimistic question, token accumulation, stop (abort),
 * and reconciliation into the TanStack Query cache once the `done` event arrives.
 */
export function useChatStream() {
  const qc = useQueryClient();
  const [turn, setTurn] = useState<LiveTurn | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const appendToCache = useCallback(
    (chatId: string, msgs: Message[]) => {
      qc.setQueryData<ChatDetail>(keys.chat(chatId), (old) =>
        old ? { ...old, messages: [...old.messages.filter((m) => !msgs.some((n) => n.id === m.id)), ...msgs] } : old,
      );
    },
    [qc],
  );

  const send = useCallback(
    async (chatId: string, question: string, summaryStyle: SummaryStyle) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let meta: StreamMeta | undefined;
      const startedAt = new Date().toISOString();
      setTurn({ chatId, question, showQuestion: true, answer: "", status: "streaming" });
      try {
        const done: StreamDone = await streamChatMessage(api, chatId, question, {
          summaryStyle,
          signal: ctrl.signal,
          onMeta: (m) => {
            meta = m;
            setTurn((t) => (t ? { ...t, meta: m } : t));
          },
          onToken: (delta) => setTurn((t) => (t ? { ...t, answer: t.answer + delta } : t)),
        });
        const userMsg: Message = {
          id: meta?.user_message_id ?? `local-${startedAt}`,
          role: "user",
          content: question,
          citations: null,
          timestamp: startedAt,
        };
        const { abstained: _a, ...assistant } = done;
        appendToCache(chatId, [userMsg, assistant]);
        setTurn(null);
        qc.invalidateQueries({ queryKey: keys.chats });
        // The first answer triggers a background title; pick it up shortly after.
        window.setTimeout(() => qc.invalidateQueries({ queryKey: keys.chats }), 2500);
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        if (aborted) {
          if (meta) {
            appendToCache(chatId, [
              { id: meta.user_message_id, role: "user", content: question, citations: null, timestamp: startedAt },
            ]);
          }
          setTurn((t) => (t ? { ...t, status: "stopped", showQuestion: !meta } : t));
        } else {
          await qc.invalidateQueries({ queryKey: keys.chat(chatId) });
          setTurn((t) => (t ? { ...t, status: "error", error: err, showQuestion: false } : t));
        }
        qc.invalidateQueries({ queryKey: keys.chats });
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
      }
    },
    [appendToCache, qc],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const clear = useCallback(() => setTurn(null), []);

  return { turn, send, stop, clear, isStreaming: turn?.status === "streaming" };
}
