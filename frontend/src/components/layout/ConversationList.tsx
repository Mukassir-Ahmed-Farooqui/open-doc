import { MessageSquare, MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/Menu";
import { Skeleton } from "@/components/ui/Skeleton";
import { useChats, useDeleteChat, useRenameChat } from "@/hooks/queries";
import type { Chat } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/api/errors";

function groupLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= start) return "Today";
  if (t >= start - 86400000) return "Yesterday";
  if (t >= start - 6 * 86400000) return "Previous 7 days";
  if (t >= start - 29 * 86400000) return "Previous 30 days";
  return "Older";
}

export function ConversationList({ onNavigate }: { onNavigate?: () => void }) {
  const { data, isLoading, error, refetch } = useChats();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((c) => !q || c.title.toLowerCase().includes(q));
  }, [data, query]);
  const groups = useMemo(() => {
    const map = new Map<string, Chat[]>();
    for (const c of filtered) {
      const g = groupLabel(c.updated_at);
      map.set(g, [...(map.get(g) ?? []), c]);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2">
        <label className="relative block">
          <span className="sr-only">Search conversations</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            className="h-8 w-full rounded-md border border-transparent bg-surface-3/60 pr-2 pl-8 text-sm placeholder:text-fg-subtle focus-visible:border-line-strong focus-visible:bg-surface focus-visible:outline-none"
          />
        </label>
      </div>
      <nav aria-label="Conversation history" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isLoading ? (
          <div className="space-y-1.5 px-1 pt-1" role="status" aria-label="Loading conversations">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-7" />
            ))}
          </div>
        ) : error ? (
          <div className="px-2 py-3 text-xs text-fg-muted">
            <p className="text-danger">{errorMessage(error)}</p>
            <button className="mt-1 underline" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        ) : !data?.length ? (
          <p className="px-2 py-3 text-xs text-fg-subtle">No conversations yet. Start one with New chat.</p>
        ) : !filtered.length ? (
          <p className="px-2 py-3 text-xs text-fg-subtle">No conversations match “{query}”.</p>
        ) : (
          groups.map(([label, chats]) => (
            <div key={label} className="mb-2">
              <p className="px-2 pt-2 pb-1 text-2xs font-medium tracking-wide text-fg-subtle uppercase">{label}</p>
              <ul className="space-y-px">
                {chats.map((c) => (
                  <ConversationItem key={c.id} chat={c} onNavigate={onNavigate} />
                ))}
              </ul>
            </div>
          ))
        )}
      </nav>
    </div>
  );
}

function ConversationItem({ chat, onNavigate }: { chat: Chat; onNavigate?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const [confirm, setConfirm] = useState(false);
  const rename = useRenameChat();
  const del = useDeleteChat();
  const navigate = useNavigate();
  const { chatId } = useParams();

  const commit = () => {
    const t = title.trim();
    setEditing(false);
    if (t && t !== chat.title) rename.mutate({ id: chat.id, title: t });
    else setTitle(chat.title);
  };

  if (editing) {
    return (
      <li>
        <input
          autoFocus
          aria-label="Conversation title"
          value={title}
          maxLength={512}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setTitle(chat.title);
              setEditing(false);
            }
          }}
          className="h-8 w-full rounded-md border border-accent bg-surface px-2 text-sm focus-visible:outline-none"
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <NavLink
        to={`/chat/${chat.id}`}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            "flex h-8 items-center gap-2 rounded-md pr-8 pl-2 text-sm transition-colors",
            isActive ? "bg-surface-3 text-fg font-medium" : "text-fg-muted hover:bg-surface-3/60 hover:text-fg",
          )
        }
        title={chat.title}
      >
        <MessageSquare className="size-3.5 shrink-0 opacity-60" aria-hidden />
        <span className="truncate">{chat.title}</span>
      </NavLink>
      <div className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-6" aria-label={`Options for ${chat.title}`}>
              <MoreHorizontal />
            </Button>
          </MenuTrigger>
          <MenuContent align="start">
            <MenuItem
              icon={<Pencil />}
              onSelect={() => {
                setTitle(chat.title);
                setEditing(true);
              }}
            >
              Rename
            </MenuItem>
            <MenuItem icon={<Trash2 />} destructive onSelect={() => setConfirm(true)}>
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete conversation?"
        description={
          <>
            “<span className="font-medium text-fg">{chat.title}</span>” and all its messages will be deleted.
          </>
        }
        confirmLabel="Delete"
        destructive
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(chat.id, {
            onSuccess: () => {
              setConfirm(false);
              if (chatId === chat.id) navigate("/chat");
            },
          })
        }
      />
    </li>
  );
}
