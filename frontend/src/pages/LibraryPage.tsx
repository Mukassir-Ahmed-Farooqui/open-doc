import { FolderOpen, Search, Upload } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { DocumentRow } from "@/components/documents/DocumentRow";
import { Dropzone } from "@/components/documents/Dropzone";
import { UploadQueue } from "@/components/documents/UploadQueue";
import { useUploads } from "@/components/documents/UploadProvider";
import { Page, PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { modKey } from "@/lib/platform";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { useDocuments } from "@/hooks/queries";
import type { DocumentStatus } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";

const FILTERS: { value: "all" | DocumentStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready" },
  { value: "processing", label: "Processing" },
  { value: "queued", label: "Queued" },
  { value: "failed", label: "Failed" },
];

export function LibraryPage() {
  const docs = useDocuments();
  const { openPicker } = useUploads();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const status = (params.get("status") ?? "all") as "all" | DocumentStatus;

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: docs.data?.length ?? 0 };
    for (const d of docs.data ?? []) c[d.status] = (c[d.status] ?? 0) + 1;
    return c;
  }, [docs.data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (docs.data ?? []).filter(
      (d) => (status === "all" || d.status === status) && (!needle || d.filename.toLowerCase().includes(needle)),
    );
  }, [docs.data, q, status]);

  return (
    <Page>
      <PageHeader
        title="Library"
        description="Every document you've uploaded, with live ingestion status."
        actions={
          <Button variant="primary" onClick={openPicker}>
            <Upload /> Upload
          </Button>
        }
      />
      <Dropzone compact />
      <UploadQueue documents={docs.data} />

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative flex-1">
            <span className="sr-only">Search documents</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
            <input
              data-primary-input
              type="search"
              value={q}
              onChange={(e) => update("q", e.target.value)}
              placeholder="Search by filename"
              className="h-9 w-full rounded-md border border-line bg-surface pr-16 pl-9 text-base shadow-xs placeholder:text-fg-subtle focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
            />
            <span className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 gap-0.5 sm:flex">
              <Kbd>{modKey}</Kbd>
              <Kbd>/</Kbd>
            </span>
          </label>
          <div role="tablist" aria-label="Filter by status" className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-surface-2 p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                role="tab"
                aria-selected={status === f.value}
                onClick={() => update("status", f.value)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm whitespace-nowrap transition-colors",
                  status === f.value ? "bg-surface font-medium text-fg shadow-xs" : "text-fg-muted hover:text-fg",
                )}
              >
                {f.label}
                <span className="text-xs tabular-nums text-fg-subtle">{counts[f.value] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        {docs.isLoading ? (
          <ListSkeleton rows={5} />
        ) : docs.error ? (
          <ErrorState error={docs.error} title="Couldn't load documents" onRetry={() => docs.refetch()} />
        ) : !docs.data?.length ? (
          <EmptyState
            icon={<FolderOpen />}
            title="Your library is empty"
            description="Upload PDFs, Word documents, text or Markdown files. They're indexed in the background and ready to question in moments."
            action={
              <Button variant="primary" onClick={openPicker}>
                <Upload /> Upload documents
              </Button>
            }
          />
        ) : !filtered.length ? (
          <EmptyState
            icon={<Search />}
            title="No matching documents"
            description="Try a different search or status filter."
            action={
              <Button variant="outline" onClick={() => setParams({}, { replace: true })}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <ul aria-label="Documents" className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
            {filtered.map((d) => (
              <DocumentRow key={d.doc_id} doc={d} />
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}
