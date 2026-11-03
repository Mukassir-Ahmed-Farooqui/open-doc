import { CheckCircle2, X, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { ProgressBar, StatusBadge } from "@/components/ui/StatusBadge";
import { Spinner } from "@/components/ui/Spinner";
import type { DocumentItem } from "@/lib/api/schemas";
import { formatBytes } from "@/lib/format";
import { DocIcon } from "./DocIcon";
import { useUploads, type UploadItem } from "./UploadProvider";

/**
 * Live view of uploads in this session: byte progress while sending, then the server's
 * ingestion status (queued → processing % → ready/failed) from the polled documents list.
 */
export function UploadQueue({ documents }: { documents: DocumentItem[] | undefined }) {
  const { uploads, dismiss, clearFinished } = useUploads();
  if (!uploads.length) return null;
  const byId = new Map(documents?.map((d) => [d.doc_id, d]));
  const anyFinished = uploads.some((u) => u.state !== "uploading");
  return (
    <section aria-label="Uploads" className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-medium">Uploads</h2>
        {anyFinished && (
          <Button size="sm" variant="ghost" onClick={clearFinished}>
            Clear finished
          </Button>
        )}
      </header>
      <ul className="divide-y divide-line" aria-live="polite">
        {uploads.map((u) => (
          <UploadRow key={u.id} item={u} doc={u.docId ? byId.get(u.docId) : undefined} onDismiss={() => dismiss(u.id)} />
        ))}
      </ul>
    </section>
  );
}

function UploadRow({ item, doc, onDismiss }: { item: UploadItem; doc?: DocumentItem; onDismiss: () => void }) {
  let status: React.ReactNode;
  let progress: number | null = null;
  if (item.state === "uploading") {
    progress = item.progress * 100;
    status = (
      <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
        <Spinner className="size-3" /> Uploading {Math.round(item.progress * 100)}%
      </span>
    );
  } else if (item.state === "error") {
    status = (
      <span className="inline-flex items-center gap-1.5 text-xs text-danger">
        <XCircle className="size-3.5" /> {item.error}
      </span>
    );
  } else if (doc) {
    if (doc.status === "processing") progress = doc.progress;
    status = (
      <span className="flex items-center gap-2">
        <StatusBadge status={doc.status} progress={doc.progress} />
        {doc.status === "failed" && doc.error && <span className="text-xs text-danger">{doc.error}</span>}
        {item.duplicate && <span className="text-xs text-fg-subtle">Already uploaded</span>}
      </span>
    );
  } else {
    status = (
      <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
        <CheckCircle2 className="size-3.5 text-success" /> Uploaded
      </span>
    );
  }
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <DocIcon filename={item.name} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          {doc ? (
            <Link to={`/documents/${doc.doc_id}`} className="truncate text-sm font-medium hover:underline">
              {item.name}
            </Link>
          ) : (
            <span className="truncate text-sm font-medium">{item.name}</span>
          )}
          <span className="shrink-0 text-xs text-fg-subtle">{formatBytes(item.size)}</span>
        </div>
        {status}
        {progress !== null && <ProgressBar value={progress} label={`${item.name} progress`} />}
      </div>
      {item.state !== "uploading" && (
        <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label={`Dismiss ${item.name}`}>
          <X />
        </Button>
      )}
    </li>
  );
}
