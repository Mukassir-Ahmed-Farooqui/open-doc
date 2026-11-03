import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { modKey } from "@/lib/platform";
import type { SummaryStyle } from "@/lib/api/schemas";

const STYLES: { value: SummaryStyle; label: string }[] = [
  { value: "executive", label: "Concise" },
  { value: "detailed", label: "Detailed" },
  { value: "highlights", label: "Highlights" },
];

export interface ComposerProps {
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabledReason?: string | null;
  style: SummaryStyle;
  onStyleChange: (s: SummaryStyle) => void;
  scope: ReactNode;
  autoFocus?: boolean;
}

export function Composer({ onSend, onStop, streaming, disabledReason, style, onStyleChange, scope, autoFocus }: ComposerProps) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const canSend = !!text.trim() && !streaming && !disabledReason && text.length <= 4000;
  const submit = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-sm transition-shadow focus-within:border-line-strong focus-within:shadow-lg">
      <label htmlFor="composer" className="sr-only">
        Ask a question about your documents
      </label>
      <textarea
        id="composer"
        ref={ref}
        data-primary-input
        rows={1}
        autoFocus={autoFocus}
        value={text}
        maxLength={4000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={disabledReason ?? "Ask a question about your documents…"}
        aria-describedby="composer-help"
        className="block max-h-60 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-base leading-6 placeholder:text-fg-subtle focus:outline-none"
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {scope}
          <label className="sr-only" htmlFor="answer-style">Answer style</label>
          <select
            id="answer-style"
            value={style}
            onChange={(e) => onStyleChange(e.target.value as SummaryStyle)}
            className="h-7 rounded-md border border-transparent bg-transparent px-1.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:border-line-strong focus-visible:outline-none"
          >
            {STYLES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <span id="composer-help" className="hidden items-center gap-1 text-2xs text-fg-subtle lg:flex">
          <Kbd>↵</Kbd> send · <Kbd>⇧↵</Kbd> newline · <Kbd>{modKey}/</Kbd> focus
        </span>
        {streaming ? (
          <Button variant="secondary" size="icon" onClick={onStop} aria-label="Stop generating" className="rounded-full">
            <Square className="!size-3 fill-current" />
          </Button>
        ) : (
          <Button variant="primary" size="icon" onClick={submit} disabled={!canSend} aria-label="Send" className="rounded-full">
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  );
}
