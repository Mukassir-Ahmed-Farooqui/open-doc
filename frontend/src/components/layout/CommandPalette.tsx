import { Command } from "cmdk";
import * as RD from "@radix-ui/react-dialog";
import { FileText, FolderOpen, Home, LogOut, MessageSquare, Moon, Plus, Settings, Sun, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { useUploads } from "@/components/documents/UploadProvider";
import { useChats, useDocuments } from "@/hooks/queries";
import { useTheme } from "@/theme/ThemeProvider";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const { resolved, toggle } = useTheme();
  const { openPicker } = useUploads();
  const { logout } = useAuth();
  const docs = useDocuments();
  const chats = useChats();

  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-[oklch(0.15_0.02_275/0.45)] animate-fade-in" />
        <RD.Content className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg animate-pop-in focus:outline-none">
          <RD.Title className="sr-only">Command palette</RD.Title>
          <RD.Description className="sr-only">Search documents, conversations and actions</RD.Description>
          <Command label="Command palette" className="flex flex-col">
            <Command.Input
              autoFocus
              placeholder="Search documents, conversations, actions…"
              className="h-12 border-b border-line bg-transparent px-4 text-base placeholder:text-fg-subtle focus:outline-none"
            />
            <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-fg-muted">No results.</Command.Empty>
              <Group heading="Actions">
                <Item icon={<Plus />} onSelect={run(() => navigate("/chat"))} shortcut="New">
                  New question
                </Item>
                <Item icon={<Upload />} onSelect={run(openPicker)}>
                  Upload documents
                </Item>
                <Item icon={resolved === "dark" ? <Sun /> : <Moon />} onSelect={run(toggle)}>
                  {resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                </Item>
              </Group>
              <Group heading="Go to">
                <Item icon={<Home />} onSelect={run(() => navigate("/"))}>
                  Home
                </Item>
                <Item icon={<FolderOpen />} onSelect={run(() => navigate("/documents"))}>
                  Library
                </Item>
                <Item icon={<Settings />} onSelect={run(() => navigate("/settings"))}>
                  Settings
                </Item>
              </Group>
              {!!docs.data?.length && (
                <Group heading="Documents">
                  {docs.data.slice(0, 50).map((d) => (
                    <Item key={d.doc_id} value={`doc ${d.filename} ${d.doc_id}`} icon={<FileText />} onSelect={run(() => navigate(`/documents/${d.doc_id}`))}>
                      {d.filename}
                    </Item>
                  ))}
                </Group>
              )}
              {!!chats.data?.length && (
                <Group heading="Conversations">
                  {chats.data.slice(0, 50).map((c) => (
                    <Item key={c.id} value={`chat ${c.title} ${c.id}`} icon={<MessageSquare />} onSelect={run(() => navigate(`/chat/${c.id}`))}>
                      {c.title}
                    </Item>
                  ))}
                </Group>
              )}
              <Group heading="Account">
                <Item icon={<LogOut />} onSelect={run(logout)}>
                  Sign out
                </Item>
              </Group>
            </Command.List>
          </Command>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  children,
  icon,
  onSelect,
  value,
  shortcut,
}: {
  children: ReactNode;
  icon: ReactNode;
  onSelect: () => void;
  value?: string;
  shortcut?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-10 cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm pointer-coarse:h-11 text-fg select-none data-[selected=true]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-fg-muted"
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="sr-only">{shortcut}</span>}
    </Command.Item>
  );
}
