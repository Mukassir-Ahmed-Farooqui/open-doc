import { Upload } from "lucide-react";
import { useState, type DragEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { UPLOAD_LIMITS } from "@/lib/config";
import { useUploads } from "./UploadProvider";

/** Drag-and-drop strip for one or many files; the button opens the file picker. */
export function Dropzone({ compact, className, children }: { compact?: boolean; className?: string; children?: ReactNode }) {
  const { uploadFiles, openPicker } = useUploads();
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={onDrop}
      data-testid="dropzone"
      className={cn(
        "relative rounded-lg border border-dashed transition-colors duration-150",
        over ? "border-accent bg-accent-soft" : "border-line-strong hover:border-fg-subtle",
        compact ? "px-4 py-3.5 sm:px-5" : "px-6 py-12",
        className,
      )}
    >
      {children ?? (
        <div className={cn("flex gap-4", compact ? "flex-col sm:flex-row sm:items-center" : "flex-col items-center text-center")}>
          <div className={cn("min-w-0", compact && "flex-1")}>
            <p className="text-base font-medium text-fg">{over ? "Drop to upload" : "Drop files here, or browse"}</p>
            <p className="mt-0.5 text-sm text-fg-muted">{UPLOAD_LIMITS}</p>
          </div>
          <Button variant="outline" onClick={openPicker} className="self-start sm:self-auto">
            <Upload aria-hidden /> Browse files
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Makes a whole region accept dropped files and shows a full-bleed "Drop to upload" overlay while
 * dragging. Keyboard and touch users keep the explicit Browse/Upload buttons.
 */
export function DropRegion({ children, className }: { children: ReactNode; className?: string }) {
  const { uploadFiles } = useUploads();
  const [over, setOver] = useState(false);
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  return (
    <div
      className={cn("relative", className)}
      onDragEnter={(e) => hasFiles(e) && setOver(true)}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        uploadFiles(e.dataTransfer.files);
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-bg/90 animate-fade-in" aria-hidden>
          <div className="rounded-xl border-2 border-dashed border-accent px-10 py-8 text-center">
            <p className="font-serif text-2xl font-semibold text-fg">Drop to upload</p>
            <p className="mt-1 text-sm text-fg-muted">{UPLOAD_LIMITS}</p>
          </div>
        </div>
      )}
    </div>
  );
}
