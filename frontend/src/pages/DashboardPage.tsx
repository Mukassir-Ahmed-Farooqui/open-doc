import { ArrowRight, FileText, Plus, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { DocIcon } from "@/components/documents/DocIcon";
import { Dropzone, DropRegion } from "@/components/documents/Dropzone";
import { UploadQueue } from "@/components/documents/UploadQueue";
import { useUploads } from "@/components/documents/UploadProvider";
import { Page, PageHeader, Section } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { buttonClass } from "@/components/ui/buttonStyles";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { isPending, useChats, useDocuments } from "@/hooks/queries";
import { formatRelative } from "@/lib/format";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function DashboardPage() {
  const { user } = useAuth();
  const docs = useDocuments();
  const chats = useChats();
  const { openPicker } = useUploads();
  const firstName = user?.full_name?.split(" ")[0];

  const all = docs.data ?? [];
  const ready = all.filter((d) => d.status === "ready").length;
  const pending = all.filter(isPending).length;
  const failed = all.filter((d) => d.status === "failed").length;
  const pages = all.reduce((n, d) => n + (d.status === "ready" ? d.num_pages : 0), 0);
  const loading = docs.isLoading || chats.isLoading;
  const isNew = !docs.isLoading && !all.length;

  const summary = loading
    ? null
    : isNew
      ? "Upload a document to start. Every answer you get will point back to the page it came from."
      : [
          `${plural(all.length, "document")} in your library`,
          ready ? `${ready} ready to question` : null,
          pending ? `${pending} still indexing` : null,
          failed ? `${failed} failed` : null,
        ]
          .filter(Boolean)
          .join(", ") + ".";

  return (
    <DropRegion className="h-full">
      <Page>
        <PageHeader
          title={firstName ? `${greeting()}, ${firstName}` : greeting()}
          description={summary ?? <Skeleton className="h-4 w-72" />}
          actions={
            <>
              <Button variant="outline" onClick={openPicker} className="max-sm:hidden">
                <Upload /> Upload
              </Button>
              <Link to="/chat" className={buttonClass("primary")}>
                <Plus aria-hidden /> New question
              </Link>
            </>
          }
        />

        {isNew ? (
          <FirstRun />
        ) : (
          <>
            {!loading && (
              <dl aria-label="Library at a glance" className="flex flex-wrap gap-x-10 gap-y-4 border-y border-line py-4">
                {[
                  ["Documents", all.length],
                  ["Pages indexed", pages],
                  ["Conversations", chats.data?.length ?? 0],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <dt className="text-xs text-fg-subtle">{k}</dt>
                    <dd className="mt-0.5 font-serif text-2xl font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="space-y-4">
              <Dropzone compact />
              <UploadQueue documents={docs.data} />
            </div>
          </>
        )}

        {!isNew && (
          <div className="grid gap-10 lg:grid-cols-2">
            <Section
              id="recent-docs"
              title="Recent documents"
              action={
                <Link to="/documents" className="inline-flex min-h-8 items-center gap-1 text-sm text-fg-muted hover:text-fg pointer-coarse:min-h-11">
                  Library <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              }
            >
              {docs.isLoading ? (
                <div className="space-y-3 py-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
              ) : docs.error ? (
                <ErrorState error={docs.error} onRetry={() => docs.refetch()} className="py-8" />
              ) : (
                <ul className="divide-y divide-line">
                  {all.slice(0, 5).map((d) => (
                    <li key={d.doc_id}>
                      <Link to={`/documents/${d.doc_id}`} className="flex items-center gap-3 py-3 hover:text-accent-soft-fg">
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
            </Section>

            <Section
              id="recent-chats"
              title="Recent conversations"
              action={
                <Link to="/chat" className="inline-flex min-h-8 items-center gap-1 text-sm text-fg-muted hover:text-fg pointer-coarse:min-h-11">
                  New question <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              }
            >
              {chats.isLoading ? (
                <div className="space-y-3 py-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
              ) : chats.error ? (
                <ErrorState error={chats.error} onRetry={() => chats.refetch()} className="py-8" />
              ) : !chats.data?.length ? (
                <p className="py-6 text-sm text-fg-muted">
                  {ready ? "No questions yet. Ask one and the answer will cite its pages." : "Once a document is ready you can start asking questions."}
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {chats.data.slice(0, 5).map((c) => (
                    <li key={c.id}>
                      <Link to={`/chat/${c.id}`} className="block py-3 hover:text-accent-soft-fg">
                        <span className="block truncate font-serif text-base font-medium">{c.title}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-subtle">
                          <FileText className="size-3" aria-hidden /> {plural(c.selected_doc_ids.length, "document")} · {formatRelative(c.updated_at)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        )}
      </Page>
    </DropRegion>
  );
}

/** First-run: the three steps of the product, with the upload target as the first one. */
function FirstRun() {
  const docs = useDocuments();
  return (
    <section aria-labelledby="first-run" className="space-y-6">
      <h2 id="first-run" className="sr-only">
        Get started
      </h2>
      <p className="text-sm font-medium text-fg">No documents yet</p>
      <ol className="grid gap-x-8 gap-y-6 border-t border-line pt-6 md:grid-cols-3">
        {[
          ["Upload", "PDF, Word, Markdown or text. Indexing runs in the background."],
          ["Ask", "Plain-language questions, answered only from the documents you pick."],
          ["Check the page", "Each claim carries a numbered source that opens the exact passage."],
        ].map(([t, d], i) => (
          <li key={t} className="flex gap-3">
            <span className="font-mono text-sm text-accent-soft-fg tabular-nums">{i + 1}.</span>
            <div>
              <p className="text-sm font-semibold text-fg">{t}</p>
              <p className="mt-1 text-sm text-fg-muted">{d}</p>
            </div>
          </li>
        ))}
      </ol>
      <Dropzone />
      <UploadQueue documents={docs.data} />
    </section>
  );
}
