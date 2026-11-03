import * as Popover from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { DocumentItem } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";

/** Choose which documents a chat searches. Only `ready` documents can be selected. */
export function ScopePicker({
  documents,
  selected,
  onChange,
  disabled,
}: {
  documents: DocumentItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const ready = documents.filter((d) => d.status === "ready");
  const selectedSet = new Set(selected);
  const validSelected = documents.filter((d) => selectedSet.has(d.doc_id));
  const label =
    validSelected.length === 0
      ? "No documents"
      : validSelected.length === 1
        ? validSelected[0].filename
        : validSelected.length === ready.length && ready.length > 1
          ? `All documents (${ready.length})`
          : `${validSelected.length} documents`;

  const toggle = (id: string) => onChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <Popover.Root>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`Documents in scope: ${label}`}
          className={cn(
            "inline-flex h-7 max-w-[14rem] items-center gap-1.5 rounded-md border px-2 text-xs transition-colors disabled:opacity-50",
            validSelected.length ? "border-line bg-surface-2 text-fg hover:bg-surface-3" : "border-warning/40 bg-warning-soft text-warning",
          )}
        >
          <FileText className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="top"
          sideOffset={6}
          className="z-50 w-80 rounded-xl border border-line bg-surface p-1 shadow-lg animate-pop-in"
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-medium text-fg-muted">Search in</span>
            {ready.length > 0 && (
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                onClick={() => onChange(validSelected.length === ready.length ? [] : ready.map((d) => d.doc_id))}
              >
                {validSelected.length === ready.length ? "Clear" : "Select all"}
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {documents.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-fg-muted">
                No documents yet.{" "}
                <Link to="/documents" className="text-accent hover:underline">
                  Upload one
                </Link>
              </p>
            ) : (
              documents.map((d) => {
                const isReady = d.status === "ready";
                const checked = selectedSet.has(d.doc_id);
                return (
                  <Popover.CheckboxItem
                    key={d.doc_id}
                    checked={checked}
                    disabled={!isReady}
                    onSelect={(e) => {
                      e.preventDefault();
                      toggle(d.doc_id);
                    }}
                    className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[disabled]:opacity-60 data-[highlighted]:bg-surface-2"
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        checked ? "border-accent bg-accent text-accent-fg" : "border-line-strong",
                      )}
                      aria-hidden
                    >
                      {checked && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{d.filename}</span>
                    {!isReady && <StatusBadge status={d.status} progress={d.progress} />}
                  </Popover.CheckboxItem>
                );
              })
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
