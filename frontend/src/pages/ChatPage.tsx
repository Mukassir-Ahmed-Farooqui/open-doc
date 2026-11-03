import * as RD from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, MessageSquare, Upload } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Composer } from "@/components/chat/Composer";
import { Markdown } from "@/components/chat/Markdown";
import { AssistantMessage, StreamingAnswer, TurnError, UserBubble } from "@/components/chat/Messages";
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
  "Summarize the key points of these documents.",
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

  // Sources panel follows the selected chip.
  const sourceMessage = source ? messages.find((m) => m.id === source.messageId) : undefined;
  const sourceList = sourceMessage ? orderedCitations(sourceMessage.content, sourceMessage.citations) : [];

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

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 max-md:hidden">
          <MessageSquare className="size-4 text-fg-subtle" aria-hidden />
          <h1 className="truncate text-sm font-medium">
            {chatId ? (chat.data?.title ?? <Skeleton className="h-4 w-40" />) : "New chat"}
          </h1>
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
            <div className="mx-auto max-w-3xl space-y-8 px-4 py-10" role="status" aria-label="Loading conversation">
              <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
              <div className="space-y-2">
                <Skeleton className="h-3.5" />
                <Skeleton className="h-3.5" />
                <Skeleton className="h-3.5 w-3/4" />
              </div>
            </div>
          ) : showEmpty ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col justify-center px-4 py-10">
              {!docs.isLoading && !hasDocs ? (
                <EmptyState
                  icon={<FolderOpen />}
                  title="Upload a document to start"
                  description="OpenDoc answers only from your documents, with citations to the exact page."
                  action={
                    <Button variant="primary" onClick={openPicker}>
                      <Upload /> Upload documents
                    </Button>
                  }
                />
              ) : (
                <div className="animate-fade-in space-y-6">
                  <div className="text-center">
                    <h2 className="text-2xl font-semibold tracking-tight">What do you want to know?</h2>
                    <p className="mt-1.5 text-sm text-fg-muted">
                      Answers are grounded in{" "}
                      {validScope.length === 1 ? "the selected document" : `${validScope.length} selected documents`} and cite their sources.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={!!disabledReason || isStreaming || createChat.isPending}
                        onClick={() => ask(s)}
                        className="rounded-xl border border-line bg-surface p-3 text-left text-sm text-fg-muted shadow-xs transition-colors hover:border-line-strong hover:text-fg disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  {readyIds.length === 0 && (docs.data?.length ?? 0) > 0 && (
                    <p className="text-center text-xs text-fg-subtle">
                      Waiting for indexing to finish — check progress in the{" "}
                      <Link to="/documents" className="text-accent hover:underline">library</Link>.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-8 px-4 py-8" aria-live="polite">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <UserBubble key={m.id} content={m.content} />
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
                  {liveTurn.showQuestion && <UserBubble content={liveTurn.question} />}
                  {liveTurn.status === "streaming" && (
                    <StreamingAnswer text={liveTurn.answer} phase={liveTurn.meta ? "writing" : "retrieving"} />
                  )}
                  {liveTurn.status === "stopped" && (
                    <div className="space-y-2">
                      {liveTurn.answer && <StreamingAnswerStatic text={liveTurn.answer} />}
                      <p className="text-xs text-fg-subtle">Stopped. This partial answer wasn't saved.</p>
                    </div>
                  )}
                  {liveTurn.status === "error" && <TurnError error={liveTurn.error} onRetry={() => ask(liveTurn.question)} />}
                </>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 px-3 pb-3 sm:px-4 sm:pb-4">
          <div className="mx-auto max-w-3xl">{composer}</div>
          <p className="mx-auto mt-1.5 max-w-3xl text-center text-2xs text-fg-subtle">
            Answers come only from your documents. Check citations for anything important.
          </p>
        </div>
      </div>

      {source && sourceList.length > 0 &&
        (isWide ? (
          <aside className="w-96 shrink-0 border-l border-line bg-surface animate-fade-in" aria-label="Sources">
            <SourcePanel
              citations={sourceList}
              active={source.sourceId}
              onSelect={(id) => setSource({ ...source, sourceId: id })}
              onClose={() => setSource(null)}
            />
          </aside>
        ) : (
          <RD.Root open onOpenChange={(o) => !o && setSource(null)}>
            <RD.Portal>
              <RD.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
              <RD.Content className="fixed inset-y-0 right-0 z-50 w-[min(26rem,92vw)] border-l border-line bg-surface shadow-lg animate-slide-in-right focus:outline-none">
                <RD.Title className="sr-only">Sources</RD.Title>
                <RD.Description className="sr-only">Cited passages for this answer</RD.Description>
                <SourcePanel
                  citations={sourceList}
                  active={source.sourceId}
                  onSelect={(id) => setSource({ ...source, sourceId: id })}
                  onClose={() => setSource(null)}
                />
              </RD.Content>
            </RD.Portal>
          </RD.Root>
        ))}
    </div>
  );
}

function StreamingAnswerStatic({ text }: { text: string }) {
  return (
    <div className="opacity-80">
      <Markdown content={text} citations={new Map()} />
    </div>
  );
}
