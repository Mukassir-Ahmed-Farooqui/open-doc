import * as RD from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FolderOpen, Upload } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Composer } from "@/components/chat/Composer";
import { Markdown } from "@/components/chat/Markdown";
import { AssistantMessage, QuestionHeading, StreamingAnswer, TurnError } from "@/components/chat/Messages";
import { ScopePicker } from "@/components/chat/ScopePicker";
import { SourcePanel } from "@/components/chat/SourcePanel";
import { useUploads } from "@/components/documents/UploadProvider";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { keys, useChat, useDocuments } from "@/hooks/queries";
import { useChatStream } from "@/hooks/useChatStream";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { api } from "@/lib/api/instance";
import { ApiError, errorMessage } from "@/lib/api/errors";
import type { Chat, ChatDetail, SummaryStyle } from "@/lib/api/schemas";
import { orderedCitations } from "@/lib/citations";

const STARTERS = [
  "Summarise the key points of these documents.",
  "What obligations, deadlines or dates are mentioned?",
  "List the main risks or open issues raised.",
];

/**
 * The stream and answer-style live above the per-conversation view, so a stream started from
 * "New chat" survives the navigation to its freshly created /chat/:id, and switching
 * conversations resets per-view state by remounting.
 */
export function ChatPage() {
  const { chatId } = useParams();
  const stream = useChatStream();
  const [style, setStyle] = useState<SummaryStyle>("executive");
  return <ChatView key={chatId ?? "new"} chatId={chatId} stream={stream} style={style} setStyle={setStyle} />;
}

function ChatView({
  chatId,
  stream,
  style,
  setStyle,
}: {
  chatId: string | undefined;
  stream: ReturnType<typeof useChatStream>;
  style: SummaryStyle;
  setStyle: (s: SummaryStyle) => void;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const docs = useDocuments();
  const chat = useChat(chatId);
  const { turn, send, stop } = stream;
  const isStreaming = stream.isStreaming;
  const { openPicker } = useUploads();
  const isWide = useMediaQuery("(min-width: 1280px)");

  const [draftScope, setDraftScope] = useState<string[] | null>(null);
  const [source, setSource] = useState<{ messageId: string; sourceId: string } | null>(null);

  const readyIds = useMemo(() => (docs.data ?? []).filter((d) => d.status === "ready").map((d) => d.doc_id), [docs.data]);

  // New-chat scope: ?docs=a,b preselect, otherwise every ready document.
  const presetDocs = params.get("docs");
  const newChatScope = useMemo(() => {
    if (draftScope) return draftScope;
    if (presetDocs) return presetDocs.split(",").filter(Boolean);
    return readyIds;
  }, [draftScope, presetDocs, readyIds]);

  const chatScope = chat.data?.selected_doc_ids;
  const scope = useMemo(() => (chatId ? (chatScope ?? []) : newChatScope), [chatId, chatScope, newChatScope]);

  const setScope = useMutation({
    mutationFn: (ids: string[]) => api.setChatDocuments(chatId!, ids),
    onMutate: (ids) => {
      const prev = qc.getQueryData<ChatDetail>(keys.chat(chatId!));
      qc.setQueryData<ChatDetail>(keys.chat(chatId!), (old) => (old ? { ...old, selected_doc_ids: ids } : old));
      return { prev };
    },
    onError: (err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.chat(chatId!), ctx.prev);
      toast.error(errorMessage(err));
    },
    onSuccess: (updated) => {
      qc.setQueryData<Chat[]>(keys.chats, (old) => old?.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
    },
  });

  const onScopeChange = (ids: string[]) => (chatId ? setScope.mutate(ids) : setDraftScope(ids));

  const createChat = useMutation({ mutationFn: (ids: string[]) => api.createChat(ids) });

  const ask = useCallback(
    async (question: string) => {
      if (chatId) {
        void send(chatId, question, style);
        return;
      }
      try {
        const created = await createChat.mutateAsync(scope);
        qc.setQueryData<ChatDetail>(keys.chat(created.id), { ...created, messages: [] });
        qc.setQueryData<Chat[]>(keys.chats, (old) => [created, ...(old ?? [])]);
        navigate(`/chat/${created.id}`, { replace: true });
        void send(created.id, question, style);
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
    [chatId, createChat, navigate, qc, scope, send, style],
  );

  const messages = useMemo(() => (chatId ? (chat.data?.messages ?? []) : []), [chatId, chat.data?.messages]);
  const liveTurn = turn && turn.chatId === chatId ? turn : null;
  const lastUserQuestion = [...messages].reverse().find((m) => m.role === "user")?.content;

  // Sources: the rail (wide screens) follows the selected chip, defaulting to the latest cited answer.
  const lastCited = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant" && (m.citations?.length ?? 0) > 0),
    [messages],
  );
  const railMessage = (source ? messages.find((m) => m.id === source.messageId) : undefined) ?? lastCited;
  const railList = useMemo(
    () => (railMessage ? orderedCitations(railMessage.content, railMessage.citations) : []),
    [railMessage],
  );
  const railActive = source && railMessage && source.messageId === railMessage.id ? source.sourceId : null;
  const sheetOpen = !isWide && !!source && railList.length > 0;

  // Auto-scroll: stick to the bottom unless the reader scrolled up.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, liveTurn?.answer, liveTurn?.status]);

  const hasDocs = (docs.data?.length ?? 0) > 0;
  const validScope = scope.filter((id) => readyIds.includes(id));
  const disabledReason = docs.isLoading
    ? "Loading documents…"
    : !hasDocs
      ? null // backend answers with an "upload first" message
      : readyIds.length === 0
        ? "Your documents are still being indexed…"
        : validScope.length === 0
          ? "Select at least one ready document to ask a question"
          : null;

  const scopeControl = (
    <ScopePicker
      documents={docs.data ?? []}
      selected={scope}
      onChange={onScopeChange}
      disabled={docs.isLoading || isStreaming}
    />
  );

  const composer = (
    <Composer
      onSend={ask}
      onStop={stop}
      streaming={isStreaming || createChat.isPending}
      disabledReason={disabledReason}
      style={style}
      onStyleChange={setStyle}
      scope={scopeControl}
      autoFocus={isWide}
    />
  );

  // ── Not found / error ──
  if (chatId && chat.error) {
    const notFound = chat.error instanceof ApiError && chat.error.isNotFound;
    return (
      <ErrorState
        className="h-full"
        title={notFound ? "Conversation not found" : "Couldn't load conversation"}
        error={notFound ? new Error("It may have been deleted, or it belongs to another account.") : chat.error}
        onRetry={notFound ? undefined : () => chat.refetch()}
      />
    );
  }

  const showEmpty = !chatId || (chat.data && messages.length === 0 && !liveTurn);
  const firstUserId = messages.find((m) => m.role === "user")?.id;
  const showRail = isWide && railList.length > 0;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 max-md:h-12 sm:px-6">
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
            {chatId ? (chat.data?.title ?? <Skeleton className="h-4 w-40" />) : "New question"}
          </h1>
          {validScope.length > 0 && (
            <span className="shrink-0 font-mono text-2xs text-fg-subtle">
              {validScope.length} {validScope.length === 1 ? "document" : "documents"} in scope
            </span>
          )}
        </header>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {chatId && chat.isLoading ? (
            <div className="mx-auto max-w-[46rem] space-y-6 px-4 py-12 sm:px-6" role="status" aria-label="Loading conversation">
              <Skeleton className="h-7 w-2/3" />
              <div className="space-y-2.5">
                <Skeleton className="h-4" />
                <Skeleton className="h-4" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ) : showEmpty ? (
            <div className="mx-auto flex min-h-full max-w-[46rem] flex-col justify-center px-4 py-10 sm:px-6">
              {!docs.isLoading && !hasDocs ? (
                <EmptyState
                  icon={<FolderOpen />}
                  title="Upload a document to start"
                  description="OpenDoc answers only from your documents, and every claim cites the page it came from."
                  action={
                    <Button variant="primary" onClick={openPicker}>
                      <Upload /> Upload documents
                    </Button>
                  }
                />
              ) : (
                <div className="animate-rise-in">
                  <h2 className="font-serif text-3xl font-semibold tracking-[-0.015em] text-fg sm:text-4xl">What do you want to find out?</h2>
                  <p className="mt-3 max-w-lg text-base text-fg-muted">
                    Answers come only from{" "}
                    {validScope.length === 1 ? "the selected document" : `the ${validScope.length} selected documents`}. Each claim carries a
                    numbered source you can open at the exact page.
                  </p>
                  <ul className="mt-8 divide-y divide-line border-y border-line" aria-label="Suggested questions">
                    {STARTERS.map((q) => (
                      <li key={q}>
                        <button
                          type="button"
                          disabled={!!disabledReason || isStreaming || createChat.isPending}
                          onClick={() => ask(q)}
                          className="group flex min-h-12 w-full items-center justify-between gap-4 py-3 text-left font-serif text-lg text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
                        >
                          {q}
                          <ArrowRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {readyIds.length === 0 && (docs.data?.length ?? 0) > 0 && (
                    <p className="mt-4 text-sm text-fg-muted">
                      Waiting for indexing to finish. Progress is in the{" "}
                      <Link to="/documents" className="font-medium text-accent-soft-fg underline">
                        library
                      </Link>
                      .
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-[46rem] px-4 pt-10 pb-12 sm:px-6" aria-live="polite">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <QuestionHeading key={m.id} content={m.content} first={m.id === firstUserId} />
                ) : (
                  <AssistantMessage
                    key={m.id}
                    message={m}
                    isLast={i === messages.length - 1 && !liveTurn}
                    activeSource={source?.messageId === m.id ? source.sourceId : null}
                    onCite={(messageId, sourceId) => setSource({ messageId, sourceId })}
                    onRegenerate={
                      i === messages.length - 1 && !isStreaming && lastUserQuestion && !disabledReason
                        ? () => ask(lastUserQuestion)
                        : undefined
                    }
                  />
                ),
              )}
              {liveTurn && (
                <>
                  {liveTurn.showQuestion && <QuestionHeading content={liveTurn.question} first={!firstUserId} />}
                  {liveTurn.status === "streaming" && (
                    <StreamingAnswer text={liveTurn.answer} meta={liveTurn.meta} scopeCount={validScope.length} />
                  )}
                  {liveTurn.status === "stopped" && (
                    <div className="mt-5 space-y-2">
                      {liveTurn.answer && <StreamingAnswerStatic text={liveTurn.answer} />}
                      <p className="text-sm text-fg-subtle">Stopped. This partial answer wasn't saved.</p>
                    </div>
                  )}
                  {liveTurn.status === "error" && <TurnError error={liveTurn.error} onRetry={() => ask(liveTurn.question)} />}
                </>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
          <div className="mx-auto max-w-[46rem]">{composer}</div>
          <p className="mx-auto mt-2 max-w-[46rem] text-center text-2xs text-fg-subtle max-sm:hidden">
            Answers come only from your documents. Open the cited page for anything that matters.
          </p>
        </div>
      </div>

      {showRail && (
        <aside className="w-[22rem] shrink-0 border-l border-line bg-surface animate-fade-in" aria-label="Sources">
          <SourcePanel
            citations={railList}
            active={railActive}
            onSelect={(id) => setSource({ messageId: railMessage!.id, sourceId: id })}
            onClose={source ? () => setSource(null) : undefined}
            closeLabel="Clear selected source"
          />
        </aside>
      )}
      {sheetOpen && (
        <RD.Root open onOpenChange={(o) => !o && setSource(null)}>
          <RD.Portal>
            <RD.Overlay className="fixed inset-0 z-40 bg-[oklch(0.15_0.02_275/0.45)] animate-fade-in" />
            <RD.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[82dvh] flex-col rounded-t-xl border-t border-line bg-surface shadow-lg animate-slide-in-up focus:outline-none md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-[min(26rem,92vw)] md:rounded-none md:border-t-0 md:border-l md:animate-slide-in-right">
              <RD.Title className="sr-only">Sources</RD.Title>
              <RD.Description className="sr-only">Cited passages for this answer</RD.Description>
              <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong md:hidden" aria-hidden />
              <div className="min-h-0 flex-1">
                <SourcePanel
                  citations={railList}
                  active={railActive}
                  onSelect={(id) => setSource({ messageId: railMessage!.id, sourceId: id })}
                  onClose={() => setSource(null)}
                />
              </div>
            </RD.Content>
          </RD.Portal>
        </RD.Root>
      )}
    </div>
  );
}

function StreamingAnswerStatic({ text }: { text: string }) {
  return (
    <div className="max-w-[68ch] opacity-80">
      <Markdown variant="note" content={text} citations={new Map()} />
    </div>
  );
}
