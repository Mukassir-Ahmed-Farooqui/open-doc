import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/States";
import { itemInSnippet, normalizeText } from "@/lib/highlight";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export default function PdfViewer({
  file,
  page,
  onPageChange,
  highlight,
}: {
  file: Blob;
  page: number;
  onPageChange: (p: number) => void;
  highlight?: string;
}) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [zoomIdx, setZoomIdx] = useState(2);
  const [width, setWidth] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const normSnippet = useMemo(() => (highlight ? normalizeText(highlight) : ""), [highlight]);
  const textRenderer = useCallback(
    ({ str }: { str: string }) =>
      normSnippet && itemInSnippet(str, normSnippet) ? `<mark class="pdf-hl">${escapeHtml(str)}</mark>` : escapeHtml(str),
    [normSnippet],
  );

  const clamp = (p: number) => Math.min(Math.max(1, p), numPages ?? Math.max(1, p));
  const go = (p: number) => onPageChange(clamp(p));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(page + 1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") go(page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Scroll the first highlight into view once the text layer renders.
  const onTextLayer = useCallback(() => {
    if (!normSnippet) return;
    requestAnimationFrame(() => wrapRef.current?.querySelector(".pdf-hl")?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [normSnippet]);

  const pageWidth = width ? Math.min(width - (width < 640 ? 24 : 48), 880) * ZOOMS[zoomIdx] : undefined;
  const fileProp = useMemo(() => file, [file]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-2 px-2 sm:px-4">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <PageInput key={page} page={page} numPages={numPages} onGo={go} />
          <Button variant="ghost" size="icon-sm" onClick={() => go(page + 1)} disabled={!!numPages && page >= numPages} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => setZoomIdx((z) => Math.max(0, z - 1))} disabled={zoomIdx === 0} aria-label="Zoom out">
            <Minus />
          </Button>
          <span className="w-12 text-center font-mono text-2xs tabular-nums text-fg-muted" aria-live="polite">
            {Math.round(ZOOMS[zoomIdx] * 100)}%
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => setZoomIdx((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoomIdx === ZOOMS.length - 1} aria-label="Zoom in">
            <Plus />
          </Button>
        </div>
      </div>
      <div ref={wrapRef} className="min-h-0 flex-1 overflow-auto bg-surface-3">
        <Document
          file={fileProp}
          onLoadSuccess={(pdf) => {
            setNumPages(pdf.numPages);
            if (page > pdf.numPages) onPageChange(pdf.numPages);
          }}
          loading={<PageSkeleton />}
          error={<ErrorState error={new Error("This PDF could not be rendered. You can still download it.")} title="Can't display PDF" />}
          className="flex justify-center p-3 sm:p-6"
        >
          {pageWidth && (
            <Page
              key={page}
              pageNumber={page}
              width={pageWidth}
              customTextRenderer={textRenderer}
              onRenderTextLayerSuccess={onTextLayer}
              loading={<PageSkeleton />}
              className="overflow-hidden rounded-xs bg-white shadow-sm"
            />
          )}
        </Document>
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[700px] space-y-3 rounded-sm bg-surface p-10 shadow-sm" role="status" aria-label="Loading page">
      <Skeleton className="h-6 w-1/2" />
      {Array.from({ length: 12 }, (_, i) => (
        <Skeleton key={i} className="h-3" />
      ))}
    </div>
  );
}

function PageInput({ page, numPages, onGo }: { page: number; numPages: number | null; onGo: (p: number) => void }) {
  const [value, setValue] = useState(String(page));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = parseInt(value, 10);
        if (Number.isFinite(n)) onGo(n);
      }}
      className="flex items-center gap-1.5 text-sm text-fg-muted"
    >
      <label htmlFor="pdf-page" className="sr-only">
        Page
      </label>
      <input
        id="pdf-page"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
        onBlur={() => setValue(String(page))}
        className="h-8 w-12 rounded-md border border-line-strong bg-surface text-center font-mono text-sm tabular-nums focus-visible:border-accent focus-visible:outline-none pointer-coarse:h-11"
      />
      <span className="font-mono text-sm tabular-nums">/ {numPages ?? "–"}</span>
    </form>
  );
}
