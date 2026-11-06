import { FolderOpen, Search, Upload } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { DocumentRow } from "@/components/documents/DocumentRow";
import { Dropzone, DropRegion } from "@/components/documents/Dropzone";
import { UploadQueue } from "@/components/documents/UploadQueue";
import { useUploads } from "@/components/documents/UploadProvider";
import { Page, PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Input";
import { Kbd } from "@/components/ui/Kbd";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { useDocuments } from "@/hooks/queries";
import type { DocumentStatus } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import { modKey } from "@/lib/platform";

const FILTERS: { value: "all" | DocumentStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready" },
  { value: "processing", label: "Indexing" },
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

  const ready = counts.ready ?? 0;
  const pending = (counts.processing ?? 0) + (counts.queued ?? 0);

  return (
    <DropRegion className="h-full">
      <Page>
        <PageHeader
          title="Library"
          description={
            docs.data?.length
              ? `${ready} of ${docs.data.length} ${docs.data.length === 1 ? "document is" : "documents are"} ready to question${pending ? `, ${pending} still indexing` : ""}.`
              : "Everything you upload lives here, with live indexing status."
          }
          actions={
            <Button variant="primary" onClick={openPicker}>
              <Upload /> Upload
            </Button>
          }
        />
        <div className="space-y-4">
          <Dropzone compact />
          <UploadQueue documents={docs.data} />
        </div>

        <div>
          <div className="flex flex-col gap-3 border-b border-line sm:flex-row sm:items-end sm:justify-between">
            <div role="tablist" aria-label="Filter by status" className="-mb-px flex gap-1 overflow-x-auto">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  role="tab"
                  aria-selected={status === f.value}
                  onClick={() => update("status", f.value)}
                  className={cn(
                    "inline-flex h-10 items-center gap-1.5 border-b-2 px-2.5 text-sm whitespace-nowrap transition-colors pointer-coarse:h-11",
                    status === f.value ? "border-accent font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg",
                  )}
                >
                  {f.label}
                  <span className="font-mono text-2xs tabular-nums text-fg-subtle">{counts[f.value] ?? 0}</span>
                </button>
              ))}
            </div>
            <label className="relative mb-2 block sm:w-72">
              <span className="sr-only">Search documents</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
              <input
                data-primary-input
                type="search"
                value={q}
                onChange={(e) => update("q", e.target.value)}
                placeholder="Search by filename"
                className={cn(inputClass, "h-9 pr-14 pl-9")}
              />
              <span className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 gap-0.5 sm:flex pointer-coarse:hidden">
                <Kbd>{modKey}</Kbd>
                <Kbd>/</Kbd>
              </span>
            </label>
          </div>

          {docs.isLoading ? (
            <ListSkeleton rows={4} className="border-t-0" />
          ) : docs.error ? (
            <ErrorState error={docs.error} title="Couldn't load your library" onRetry={() => docs.refetch()} />
          ) : !docs.data?.length ? (
            <EmptyState
              icon={<FolderOpen />}
              title="Your library is empty"
              description="Upload a contract, a paper or a handbook. It's indexed in the background, usually in under a minute, and then you can ask it anything."
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
              description={q ? `Nothing in this view matches “${q}”.` : "No documents have this status."}
              action={
                <Button variant="outline" onClick={() => setParams({}, { replace: true })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <ul aria-label="Documents" className="divide-y divide-line">
              {filtered.map((d) => (
                <DocumentRow key={d.doc_id} doc={d} />
              ))}
            </ul>
          )}
        </div>
      </Page>
    </DropRegion>
  );
}
