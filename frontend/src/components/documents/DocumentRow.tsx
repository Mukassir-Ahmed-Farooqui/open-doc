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
    formatRelative(doc.created_at),
  ].filter(Boolean);
  return (
    <li className="group relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60">
      <DocIcon filename={doc.filename} contentType={doc.content_type} />
      <div className="min-w-0 flex-1">
        <Link
          to={`/documents/${doc.doc_id}`}
          className="block truncate text-base font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
        >
          {doc.filename}
        </Link>
        <p className="truncate text-xs text-fg-subtle">{meta.join(" · ")}</p>
        {doc.status === "processing" && <ProgressBar className="mt-1.5 max-w-60" value={doc.progress} label="Ingestion progress" />}
        {doc.status === "failed" && doc.error && <p className="mt-0.5 truncate text-xs text-danger">{doc.error}</p>}
      </div>
      <StatusBadge status={doc.status} progress={doc.progress} className="relative" />
      <div className="relative">
        <DocumentActions doc={doc} />
      </div>
    </li>
  );
}
