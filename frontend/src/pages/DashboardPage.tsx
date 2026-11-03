import { ArrowRight, FileText, FolderOpen, MessageSquare, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { DocIcon } from "@/components/documents/DocIcon";
import { Dropzone } from "@/components/documents/Dropzone";
import { UploadQueue } from "@/components/documents/UploadQueue";
import { Page, PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { isPending, useChats, useDocuments } from "@/hooks/queries";
import { formatBytes, formatRelative } from "@/lib/format";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function DashboardPage() {
  const { user } = useAuth();
  const docs = useDocuments();
  const chats = useChats();
  const firstName = user?.full_name?.split(" ")[0];

  const all = docs.data ?? [];
  const stats = [
    { label: "Documents", value: all.length, sub: `${all.filter((d) => d.status === "ready").length} ready` },
    { label: "Processing", value: all.filter(isPending).length, sub: `${all.filter((d) => d.status === "failed").length} failed` },
    { label: "Conversations", value: chats.data?.length ?? 0, sub: chats.data?.[0] ? `last ${formatRelative(chats.data[0].updated_at)}` : "none yet" },
    { label: "Indexed pages", value: all.reduce((n, d) => n + (d.status === "ready" ? d.num_pages : 0), 0), sub: formatBytes(all.reduce((n, d) => n + d.file_size_bytes, 0)) + " stored" },
  ];

  return (
    <Page>
      <PageHeader
        title={firstName ? `${greeting()}, ${firstName}` : greeting()}
        description="Ask questions across your documents and get answers grounded in cited pages."
        actions={
          <Link
            to="/chat"
            className="inline-flex h-8 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg shadow-xs hover:bg-accent-hover"
          >
            <Plus className="size-4" aria-hidden /> New chat
          </Link>
        }
      />

      <section aria-label="Statistics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-line bg-surface p-4 shadow-xs">
            <p className="text-xs font-medium text-fg-muted">{s.label}</p>
            {docs.isLoading || chats.isLoading ? (
              <Skeleton className="mt-2 h-7 w-12" />
            ) : (
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{s.value}</p>
            )}
            <p className="mt-0.5 truncate text-xs text-fg-subtle">{docs.isLoading ? "\u00a0" : s.sub}</p>
          </div>
        ))}
      </section>

      <Dropzone compact />
      <UploadQueue documents={docs.data} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="recent-docs" className="rounded-xl border border-line bg-surface shadow-xs">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 id="recent-docs" className="text-sm font-semibold">Recent documents</h2>
            <Link to="/documents" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg">
              Library <ArrowRight className="size-3" />
            </Link>
          </header>
          {docs.isLoading ? (
            <div className="space-y-3 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : docs.error ? (
            <ErrorState error={docs.error} onRetry={() => docs.refetch()} className="py-8" />
          ) : !all.length ? (
            <EmptyState icon={<FolderOpen />} title="No documents yet" description="Upload a PDF, DOCX, TXT or Markdown file to get started." className="py-10" />
          ) : (
            <ul className="divide-y divide-line">
              {all.slice(0, 5).map((d) => (
                <li key={d.doc_id}>
                  <Link to={`/documents/${d.doc_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                    <DocIcon filename={d.filename} contentType={d.content_type} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{d.filename}</span>
                      <span className="block text-xs text-fg-subtle">{formatRelative(d.created_at)}</span>
                    </span>
                    <StatusBadge status={d.status} progress={d.progress} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="recent-chats" className="rounded-xl border border-line bg-surface shadow-xs">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 id="recent-chats" className="text-sm font-semibold">Recent conversations</h2>
            <Link to="/chat" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg">
              New chat <ArrowRight className="size-3" />
            </Link>
          </header>
          {chats.isLoading ? (
            <div className="space-y-3 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : chats.error ? (
            <ErrorState error={chats.error} onRetry={() => chats.refetch()} className="py-8" />
          ) : !chats.data?.length ? (
            <EmptyState
              icon={<MessageSquare />}
              title="No conversations yet"
              description={all.some((d) => d.status === "ready") ? "Start a chat to ask about your documents." : "Once a document is ready you can start asking questions."}
              className="py-10"
            />
          ) : (
            <ul className="divide-y divide-line">
              {chats.data.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link to={`/chat/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-fg-muted">
                      <MessageSquare className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.title}</span>
                      <span className="flex items-center gap-1 text-xs text-fg-subtle">
                        <FileText className="size-3" aria-hidden /> {c.selected_doc_ids.length} {c.selected_doc_ids.length === 1 ? "document" : "documents"} · {formatRelative(c.updated_at)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Page>
  );
}
