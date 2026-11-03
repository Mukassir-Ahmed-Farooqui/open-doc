import { ArrowLeft, Download, MessageSquarePlus, PanelRightClose, PanelRightOpen, Sparkles } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Markdown } from "@/components/chat/Markdown";
import { DocIcon } from "@/components/documents/DocIcon";
import { DocumentActions } from "@/components/documents/DocumentActions";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { ProgressBar, StatusBadge } from "@/components/ui/StatusBadge";
import { downloadToDisk, keys, useDocument, useDocumentFile } from "@/hooks/queries";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/instance";
import { ApiError, errorMessage } from "@/lib/api/errors";
import type { DocumentItem } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import { docKind, formatBytes, formatDateTime } from "@/lib/format";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const PdfViewer = lazy(() => import("@/components/viewer/PdfViewer"));
const TextViewer = lazy(() => import("@/components/viewer/TextViewer"));

export function DocumentPage() {
  const { docId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const doc = useDocument(docId);
  const file = useDocumentFile(docId, !!doc.data);
  const isWide = useMediaQuery("(min-width: 1024px)");
  const [panelOpen, setPanelOpen] = useState<boolean | null>(null);
  const showPanel = panelOpen ?? isWide;

  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const highlight = params.get("q") ?? undefined;
  const setPage = (p: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(p));
    setParams(next, { replace: true });
  };

  if (doc.isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-line px-4">
          <Skeleton className="size-8" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="mx-auto h-[70vh] max-w-2xl" />
        </div>
      </div>
    );
  }
  if (doc.error) {
    const notFound = doc.error instanceof ApiError && doc.error.isNotFound;
    return (
      <ErrorState
        error={notFound ? new Error("This document doesn't exist or was deleted.") : doc.error}
        title={notFound ? "Document not found" : "Couldn't load document"}
        onRetry={notFound ? undefined : () => doc.refetch()}
        className="h-full"
      />
    );
  }
  const d = doc.data!;
  const kind = docKind(d.filename, d.content_type);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 sm:px-4">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft />
        </Button>
        <DocIcon filename={d.filename} contentType={d.content_type} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{d.filename}</h1>
          <p className="truncate text-xs text-fg-subtle">
            {formatBytes(d.file_size_bytes)}
            {d.num_pages ? ` · ${d.num_pages} ${d.num_pages === 1 ? "page" : "pages"}` : ""}
          </p>
        </div>
        <StatusBadge status={d.status} progress={d.progress} className="max-sm:hidden" />
        {d.status === "ready" && (
          <Link
            to={`/chat?docs=${d.doc_id}`}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg shadow-xs hover:bg-accent-hover max-sm:hidden"
          >
            <MessageSquarePlus className="size-4" aria-hidden /> Ask
          </Link>
        )}
        <Button variant="ghost" size="icon-sm" onClick={() => downloadToDisk(d)} aria-label="Download original">
          <Download />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setPanelOpen(!showPanel)}
          aria-label={showPanel ? "Hide details" : "Show details"}
          aria-expanded={showPanel}
        >
          {showPanel ? <PanelRightClose /> : <PanelRightOpen />}
        </Button>
        <DocumentActions doc={d} onDeleted={() => navigate("/documents", { replace: true })} />
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          {file.isLoading ? (
            <div className="p-8">
              <Skeleton className="mx-auto h-[70vh] max-w-2xl" />
            </div>
          ) : file.error ? (
            <ErrorState error={file.error} title="Couldn't load the file" onRetry={() => file.refetch()} className="h-full" />
          ) : file.data ? (
            <Suspense fallback={<div className="p-8"><Skeleton className="mx-auto h-[70vh] max-w-2xl" /></div>}>
              {kind === "pdf" ? (
                <PdfViewer file={file.data} page={page} onPageChange={setPage} highlight={highlight} />
              ) : kind === "other" ? (
                <EmptyState title="Preview not available" description="Download the file to open it." />
              ) : (
                <TextViewer docId={d.doc_id} file={file.data} kind={kind} highlight={highlight} />
              )}
            </Suspense>
          ) : null}
        </div>
        {showPanel && (
          <aside
            className={cn(
              "w-80 shrink-0 overflow-y-auto border-l border-line bg-surface",
              !isWide && "fixed inset-y-0 right-0 z-30 mt-12 shadow-lg animate-slide-in-right md:mt-0",
            )}
            aria-label="Document details"
          >
            <DetailsPanel doc={d} highlight={highlight} page={page} />
          </aside>
        )}
      </div>
    </div>
  );
}

function DetailsPanel({ doc, highlight, page }: { doc: DocumentItem; highlight?: string; page: number }) {
  const [wantSummary, setWantSummary] = useState(false);
  const summary = useQuery({
    queryKey: keys.summary(doc.doc_id),
    queryFn: ({ signal }) => api.documentSummary(doc.doc_id, signal),
    enabled: wantSummary && doc.status === "ready",
    staleTime: Infinity,
    retry: false,
  });
  const rows: [string, string][] = [
    ["Status", doc.status[0].toUpperCase() + doc.status.slice(1)],
    ["Type", doc.content_type],
    ["Size", formatBytes(doc.file_size_bytes)],
    ["Pages", doc.num_pages ? String(doc.num_pages) : "—"],
    ["Sections", doc.status === "ready" ? String(doc.section_count) : "—"],
    ["Chunks", doc.status === "ready" ? String(doc.chunk_count) : "—"],
    ["Uploaded", formatDateTime(doc.created_at)],
    ["Updated", formatDateTime(doc.updated_at)],
  ];
  return (
    <div className="space-y-6 p-4">
      {highlight && (
        <section className="rounded-lg border border-accent/30 bg-accent-soft/50 p-3">
          <p className="text-2xs font-medium tracking-wide text-accent-soft-fg uppercase">Cited passage · page {page}</p>
          <blockquote className="mt-1.5 text-sm leading-6 text-fg">“{highlight}”</blockquote>
        </section>
      )}
      {(doc.status === "queued" || doc.status === "processing") && (
        <section className="space-y-2 rounded-lg border border-line p-3">
          <StatusBadge status={doc.status} progress={doc.progress} />
          <ProgressBar value={doc.progress} label="Ingestion progress" />
          <p className="text-xs text-fg-muted">Indexing in the background. You can ask questions once it's ready.</p>
        </section>
      )}
      {doc.status === "failed" && (
        <section role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
          <p className="font-medium">Ingestion failed</p>
          {doc.error && <p className="mt-1 text-xs">{doc.error}</p>}
        </section>
      )}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Summary</h2>
        </div>
        {doc.status !== "ready" ? (
          <p className="text-xs text-fg-subtle">Available once the document is ready.</p>
        ) : !wantSummary ? (
          <Button variant="outline" size="sm" onClick={() => setWantSummary(true)}>
            <Sparkles /> Generate summary
          </Button>
        ) : summary.isLoading ? (
          <div className="space-y-2" role="status" aria-label="Generating summary">
            <Skeleton className="h-3" />
            <Skeleton className="h-3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : summary.error ? (
          <div className="space-y-2">
            <p className="text-xs text-danger">{errorMessage(summary.error)}</p>
            <Button variant="outline" size="sm" onClick={() => summary.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="text-sm">
            <Markdown content={summary.data!.summary} />
          </div>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Details</h2>
        <dl className="divide-y divide-line rounded-lg border border-line text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 px-3 py-2">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="truncate text-right" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
