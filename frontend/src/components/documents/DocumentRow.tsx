import { Link } from "react-router-dom";
import { ProgressBar, StatusBadge } from "@/components/ui/StatusBadge";
import type { DocumentItem } from "@/lib/api/schemas";
import { formatBytes, formatRelative } from "@/lib/format";
import { DocIcon } from "./DocIcon";
import { DocumentActions } from "./DocumentActions";

export function DocumentRow({ doc }: { doc: DocumentItem }) {
  const meta = [
    formatBytes(doc.file_size_bytes),
    doc.status === "ready" && doc.num_pages ? `${doc.num_pages} ${doc.num_pages === 1 ? "page" : "pages"}` : null,
    doc.status === "ready" && doc.section_count ? `${doc.section_count} sections` : null,
  ].filter(Boolean);
  return (
    <li className="group relative flex items-center gap-4 py-3.5 transition-colors sm:px-3 sm:hover:bg-surface-2/70">
      <DocIcon filename={doc.filename} contentType={doc.content_type} />
      <div className="min-w-0 flex-1">
        <Link
          to={`/documents/${doc.doc_id}`}
          className="block truncate text-base font-medium text-fg after:absolute after:inset-0 after:content-[''] focus-visible:outline-none group-has-[a:focus-visible]:underline"
        >
          {doc.filename}
        </Link>
        <p className="mt-0.5 truncate font-mono text-2xs text-fg-subtle">
          {meta.join(" · ")}
          <span className="sm:hidden"> · {formatRelative(doc.created_at)}</span>
        </p>
        {doc.status === "processing" && <ProgressBar className="mt-2 max-w-64" value={doc.progress} label={`Indexing ${doc.filename}`} />}
        {doc.status === "failed" && doc.error && <p className="mt-1 line-clamp-2 text-xs text-danger">{doc.error}</p>}
      </div>
      <span className="hidden w-28 shrink-0 text-right text-xs text-fg-subtle sm:block">{formatRelative(doc.created_at)}</span>
      <StatusBadge status={doc.status} progress={doc.progress} className="relative w-24 shrink-0 justify-end max-sm:w-auto" />
      <div className="relative">
        <DocumentActions doc={doc} />
      </div>
    </li>
  );
}
