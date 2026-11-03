import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { Markdown } from "@/components/chat/Markdown";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/States";
import { findSnippet } from "@/lib/highlight";
import type { DocKind } from "@/lib/format";

async function extractText(file: Blob, kind: DocKind): Promise<string> {
  if (kind === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return value;
  }
  return file.text();
}

/** Text view for TXT, Markdown and DOCX (raw text via mammoth), with the cited snippet highlighted. */
export default function TextViewer({ docId, file, kind, highlight }: { docId: string; file: Blob; kind: DocKind; highlight?: string }) {
  const { data: text, error, refetch } = useQuery({
    queryKey: ["documents", docId, "text"],
    queryFn: () => extractText(file, kind),
    staleTime: Infinity,
    retry: false,
  });
  const markRef = useRef<HTMLElement>(null);
  const range = useMemo(() => (text && highlight ? findSnippet(text, highlight) : null), [text, highlight]);

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [range]);

  if (error) return <ErrorState error={error} title="Can't display this document" onRetry={() => refetch()} />;
  if (text === undefined)
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-8" role="status" aria-label="Loading document">
        {Array.from({ length: 14 }, (_, i) => (
          <Skeleton key={i} className="h-3" />
        ))}
      </div>
    );
  if (!text.trim()) return <p className="p-8 text-center text-sm text-fg-muted">This document has no extractable text.</p>;

  // Markdown renders as markdown unless an exact highlight needs to be shown.
  if (kind === "md" && !range) {
    return (
      <article className="mx-auto max-w-3xl px-6 py-8">
        <Markdown content={text} />
      </article>
    );
  }
  return (
    <article className="mx-auto max-w-3xl px-6 py-8">
      <pre className="font-sans text-base leading-7 whitespace-pre-wrap text-fg">
        {range ? (
          <>
            {text.slice(0, range[0])}
            <mark ref={markRef} className="rounded-sm bg-accent-soft px-0.5 text-accent-soft-fg">
              {text.slice(range[0], range[1])}
            </mark>
            {text.slice(range[1])}
          </>
        ) : (
          text
        )}
      </pre>
    </article>
  );
}
